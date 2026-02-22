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

async function startGameForUser(userId) {
  const existing = stmts.getRunningSession.get(userId);
  if (existing) {
    return { url: `https://${GAME_DOMAIN}/play/${userId}/vnc.html`, sessionId: existing.id };
  }

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
      containers: [{
        name: 'game',
        image: GAME_IMAGE,
        ports: [{ containerPort: 6080 }],
        env: [{ name: 'VNC_PASSWORD', value: vncPassword }],
        resources: {
          requests: { memory: '256Mi', cpu: '250m' },
          limits: { memory: '512Mi', cpu: '500m' },
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

  // Create Ingress
  await networkingApi.createNamespacedIngress({ namespace: NAMESPACE, body: {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: ing,
      namespace: NAMESPACE,
      annotations: {
        'traefik.ingress.kubernetes.io/router.entrypoints': 'websecure',
      },
    },
    spec: {
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

  return { url: `https://${GAME_DOMAIN}/play/${userId}/vnc.html`, sessionId };
}

async function stopGameForUser(userId) {
  const session = stmts.getRunningSession.get(userId);
  if (!session) return;

  const pod = podName(userId);
  const svc = serviceName(userId);
  const ing = ingressName(userId);

  const ignoreNotFound = (err) => {
    if (err.statusCode === 404) return;
    throw err;
  };

  await coreApi.deleteNamespacedPod({ namespace: NAMESPACE, name: pod }).catch(ignoreNotFound);
  await coreApi.deleteNamespacedService({ namespace: NAMESPACE, name: svc }).catch(ignoreNotFound);
  await networkingApi.deleteNamespacedIngress({ namespace: NAMESPACE, name: ing }).catch(ignoreNotFound);

  stmts.stopSession.run(userId);
}

async function getGameStatus(userId) {
  const session = stmts.getRunningSession.get(userId);
  if (!session) return { running: false };

  try {
    const pod = await coreApi.readNamespacedPod({ namespace: NAMESPACE, name: session.pod_name });
    const phase = pod.status?.phase;
    return {
      running: phase === 'Running',
      pending: phase === 'Pending',
      url: `https://${GAME_DOMAIN}/play/${userId}/vnc.html`,
      startedAt: session.started_at,
      lastActivity: session.last_activity,
    };
  } catch (err) {
    if (err.statusCode === 404) {
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
