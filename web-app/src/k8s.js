const k8s = require('@kubernetes/client-node');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const NAMESPACE = 'cm-games';
const GAME_IMAGE = process.env.GAME_IMAGE || 'cm0102-server:latest';
const GAME_DOMAIN = process.env.GAME_DOMAIN || 'game.localhost';
const SAVES_HOST_PATH = process.env.SAVES_HOST_PATH || '/data/cm-saves';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

const stmts = {
  insertSession: db.prepare(
    'INSERT INTO game_sessions (id, user_id, pod_name, vnc_password, status) VALUES (?, ?, ?, ?, ?)'
  ),
  getRunningSession: db.prepare(
    "SELECT * FROM game_sessions WHERE user_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
  ),
  stopSession: db.prepare(
    "UPDATE game_sessions SET status = 'stopped' WHERE user_id = ? AND status = 'running'"
  ),
  updateActivity: db.prepare(
    "UPDATE game_sessions SET last_activity = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'running'"
  ),
  getIdleSessions: db.prepare(
    "SELECT * FROM game_sessions WHERE status = 'running' AND last_activity < datetime('now', '-' || ? || ' minutes')"
  ),
};

function podName(userId) {
  return `cm-game-${userId.slice(0, 8)}`;
}

function serviceName(userId) {
  return `cm-game-svc-${userId.slice(0, 8)}`;
}

function ingressName(userId) {
  return `cm-game-ing-${userId.slice(0, 8)}`;
}

function middlewareName(userId) {
  return `cm-game-mw-${userId.slice(0, 8)}`;
}

async function cleanupGameResources(userId) {
  const pod = podName(userId);
  const svc = serviceName(userId);
  const ing = ingressName(userId);
  const mw = middlewareName(userId);

  const ignoreNotFound = (err) => {
    if (err.statusCode === 404 || err.code === 404) return;
    throw err;
  };

  await coreApi.deleteNamespacedPod({ namespace: NAMESPACE, name: pod }).catch(ignoreNotFound);
  await coreApi.deleteNamespacedService({ namespace: NAMESPACE, name: svc }).catch(ignoreNotFound);
  await networkingApi.deleteNamespacedIngress({ namespace: NAMESPACE, name: ing }).catch(ignoreNotFound);
  await customApi.deleteNamespacedCustomObject({
    group: 'traefik.io', version: 'v1alpha1', namespace: NAMESPACE, plural: 'middlewares', name: mw,
  }).catch(ignoreNotFound);

  // Wait for pod to actually be gone
  for (let i = 0; i < 30; i++) {
    try {
      await coreApi.readNamespacedPod({ namespace: NAMESPACE, name: pod });
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      if (err.statusCode === 404 || err.code === 404) break;
      throw err;
    }
  }
}

async function startGameForUser(userId) {
  const existing = stmts.getRunningSession.get(userId);
  if (existing) {
    const vncParams = `autoconnect=true&scale=true&path=play/${userId}/websockify`;
    return { url: `https://${GAME_DOMAIN}/play/${userId}/vnc_lite.html?${vncParams}`, sessionId: existing.id };
  }

  // Clean up any leftover resources from a previous failed start
  await cleanupGameResources(userId);

  const vncPassword = crypto.randomBytes(8).toString('hex');
  const pod = podName(userId);
  const svc = serviceName(userId);
  const ing = ingressName(userId);

  // Create Pod
  await coreApi.createNamespacedPod({ namespace: NAMESPACE, body: {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: pod,
      namespace: NAMESPACE,
      labels: { app: 'cm-game', user: userId.slice(0, 8) },
    },
    spec: {
      tolerations: [{
        key: 'node.kubernetes.io/disk-pressure',
        operator: 'Exists',
        effect: 'NoSchedule',
      }],
      containers: [{
        name: 'game',
        image: GAME_IMAGE,
        imagePullPolicy: 'Always',
        ports: [{ containerPort: 6080 }],
        env: [{ name: 'VNC_PASSWORD', value: vncPassword }],
        resources: {
          requests: { memory: '512Mi', cpu: '500m' },
          limits: { memory: '1Gi', cpu: '1000m' },
        },
        volumeMounts: [{ name: 'saves', mountPath: '/saves' }],
      }],
      volumes: [{
        name: 'saves',
        hostPath: { path: `${SAVES_HOST_PATH}/${userId}`, type: 'DirectoryOrCreate' },
      }],
    },
  }});

  // Create Service
  await coreApi.createNamespacedService({ namespace: NAMESPACE, body: {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: svc,
      namespace: NAMESPACE,
    },
    spec: {
      selector: { app: 'cm-game', user: userId.slice(0, 8) },
      ports: [{ port: 6080, targetPort: 6080 }],
    },
  }});

  // Create Traefik StripPrefix middleware
  const mw = middlewareName(userId);
  await customApi.createNamespacedCustomObject({
    group: 'traefik.io',
    version: 'v1alpha1',
    namespace: NAMESPACE,
    plural: 'middlewares',
    body: {
      apiVersion: 'traefik.io/v1alpha1',
      kind: 'Middleware',
      metadata: { name: mw, namespace: NAMESPACE },
      spec: {
        stripPrefix: { prefixes: [`/play/${userId}`] },
      },
    },
  });

  // Create Ingress
  await networkingApi.createNamespacedIngress({ namespace: NAMESPACE, body: {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: ing,
      namespace: NAMESPACE,
      annotations: {
        'traefik.ingress.kubernetes.io/router.entrypoints': 'websecure',
        'traefik.ingress.kubernetes.io/router.middlewares': `${NAMESPACE}-${mw}@kubernetescrd`,
      },
    },
    spec: {
      tls: [{ hosts: [GAME_DOMAIN], secretName: 'cm-game-tls' }],
      rules: [{
        host: GAME_DOMAIN,
        http: {
          paths: [{
            path: `/play/${userId}`,
            pathType: 'Prefix',
            backend: {
              service: { name: svc, port: { number: 6080 } },
            },
          }],
        },
      }],
    },
  }});

  const sessionId = uuidv4();
  stmts.insertSession.run(sessionId, userId, pod, vncPassword, 'running');

  const vncParams = `autoconnect=true&scale=true&path=play/${userId}/websockify`;
  return { url: `https://${GAME_DOMAIN}/play/${userId}/vnc_lite.html?${vncParams}`, sessionId };
}

async function stopGameForUser(userId) {
  const session = stmts.getRunningSession.get(userId);
  if (!session) return;

  await cleanupGameResources(userId);
  stmts.stopSession.run(userId);
}

async function getGameStatus(userId) {
  const session = stmts.getRunningSession.get(userId);
  if (!session) return { running: false };

  try {
    const pod = await coreApi.readNamespacedPod({ namespace: NAMESPACE, name: session.pod_name });
    const phase = pod.status?.phase;

    // If pod is in a terminal state (Failed, Evicted, Succeeded), clean up
    if (phase !== 'Running' && phase !== 'Pending') {
      await cleanupGameResources(userId);
      stmts.stopSession.run(userId);
      return { running: false };
    }

    return {
      running: phase === 'Running',
      pending: phase === 'Pending',
      url: `https://${GAME_DOMAIN}/play/${userId}/vnc_lite.html?autoconnect=true&scale=true&path=play/${userId}/websockify`,
      startedAt: session.started_at,
      lastActivity: session.last_activity,
    };
  } catch (err) {
    if (err.statusCode === 404 || err.code === 404) {
      stmts.stopSession.run(userId);
      return { running: false };
    }
    throw err;
  }
}

function updateActivity(userId) {
  stmts.updateActivity.run(userId);
}

function getIdleSessions(timeoutMinutes) {
  return stmts.getIdleSessions.all(String(timeoutMinutes));
}

module.exports = {
  startGameForUser,
  stopGameForUser,
  getGameStatus,
  updateActivity,
  getIdleSessions,
};
