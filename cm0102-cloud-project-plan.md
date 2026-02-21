# CM 01/02 Cloud Gaming Platform - Project Plan

## Overview

Build a web application that lets users create accounts, log in, and play Championship Manager 01/02 in their browser. Each user gets their own isolated game instance with persistent save files. The game runs on a Hetzner server using Kubernetes for orchestration.

## Architecture

```
Browser → Traefik Ingress (HTTPS) → Web App (auth + dashboard)
                                   → Per-user CM Pods (dynamically created)
                                   → noVNC streamed back through Ingress
```

Each active game session runs as its own Kubernetes Pod containing Wine, CM 01/02, a virtual framebuffer, and a noVNC server. The web app orchestrates Pod lifecycle (create, monitor, destroy) via the Kubernetes API.

## Reference: Existing Infrastructure

Before starting, review the `live-agent` repo on this server for existing patterns:
- Traefik ingress controller configuration
- cert-manager and Let's Encrypt setup
- GitHub Actions CI/CD workflow
- Docker Hub image push pipeline
- Kubernetes Deployment, Service, and Ingress manifests

Copy and adapt these patterns rather than building from scratch.

## Game Source Files

- **Base game**: Free legal download from https://www.fmscout.com/a-championship-manager-0102-free-download.html (277MB disc image, made free by Eidos in 2009)
- **Patch v3.9.68**: Download from https://champman0102.net/viewforum.php?f=72 (required for stability on modern systems and Wine compatibility)
- **Wine compatibility**: CM 01/02 has Gold/Platinum rating on WineHQ. Check WineHQ AppDB for any specific Wine prefix configuration needed.

---

## Repo Structure

```
cm0102-cloud/
├── docker/
│   ├── game/
│   │   ├── Dockerfile              # Wine + CM 01/02 + Xvfb + x11vnc + noVNC
│   │   └── entrypoint.sh           # Starts virtual display, VNC, noVNC, and game
│   └── web-app/
│       └── Dockerfile              # Web application image
├── k8s/
│   ├── namespace.yaml              # cm-games namespace
│   ├── rbac.yaml                   # ServiceAccount + Role + RoleBinding for orchestrator
│   ├── web-app-deployment.yaml     # Web app Deployment + Service
│   ├── web-app-ingress.yaml        # Traefik Ingress for web app
│   └── idle-cleanup-cronjob.yaml   # CronJob to stop idle game pods
├── web-app/
│   ├── package.json
│   ├── src/
│   │   ├── index.js                # Express app entry point
│   │   ├── auth.js                 # Registration, login, session management
│   │   ├── k8s.js                  # Kubernetes API client (Pod/Service/Ingress CRUD)
│   │   ├── routes/
│   │   │   ├── auth.js             # Auth routes (register, login, logout)
│   │   │   ├── game.js             # Game routes (start, stop, status)
│   │   │   └── dashboard.js        # Dashboard route
│   │   └── db.js                   # SQLite database setup
│   └── views/                      # EJS or similar templates
│       ├── login.html
│       ├── register.html
│       └── dashboard.html          # Game launcher + embedded noVNC iframe
├── .github/
│   └── workflows/
│       └── build.yaml              # CI/CD: build both Docker images, push to Docker Hub
└── README.md
```

---

## Phase 1: Docker Game Image

### Goal
Build a Docker image that runs CM 01/02 headlessly and exposes it via noVNC on port 6080.

### Steps

1. Create base image from Ubuntu 24.04
2. Install Wine, Xvfb, x11vnc, noVNC, websockify
3. Install CM 01/02 into a template Wine prefix:
   - Download the disc image from fmscout
   - Mount the disc image
   - Run the installer via Wine
   - Apply the v3.9.68 patch
   - This step is done manually once, then the resulting Wine prefix is copied into the image
4. Write entrypoint.sh that:
   - Checks if user save directory exists; if not, copies template Wine prefix
   - Sets WINEPREFIX to /saves/.wine
   - Starts Xvfb on display :1 (1024x768x24)
   - Starts x11vnc on display :1 with a password from environment variable
   - Starts noVNC proxy on port 6080 pointing to VNC on localhost:5900
   - Launches CM 01/02 via Wine
5. Test manually: `docker run -p 6080:6080 -v /tmp/test-saves:/saves cm0102-server:latest`
6. Verify game loads and is playable at http://localhost:6080/vnc.html

### Dockerfile

```dockerfile
FROM ubuntu:24.04

RUN apt update && apt install -y \
    wine xvfb x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built template Wine prefix with CM 01/02 installed and patched
COPY cm0102-wineprefix/ /opt/cm0102-wineprefix/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 6080

ENTRYPOINT ["/entrypoint.sh"]
```

### entrypoint.sh

```bash
#!/bin/bash
set -e

# Copy template Wine prefix if this is a new user
if [ ! -d "/saves/.wine" ]; then
    cp -r /opt/cm0102-wineprefix /saves/.wine
fi

export WINEPREFIX=/saves/.wine
export DISPLAY=:1

# Start virtual framebuffer
Xvfb :1 -screen 0 1024x768x24 &
sleep 1

# Start VNC server
x11vnc -display :1 -passwd "${VNC_PASSWORD:-changeme}" -forever -listen 0.0.0.0 -rfbport 5900 &
sleep 1

# Start noVNC (WebSocket to VNC bridge)
/usr/share/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
sleep 1

# Launch Championship Manager
wine "/saves/.wine/drive_c/Program Files/Championship Manager 01-02/cm0102.exe"
```

---

## Phase 2: Kubernetes Manifests

### Namespace

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cm-games
```

### RBAC (allow web app to manage game Pods)

```yaml
# k8s/rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cm-orchestrator
  namespace: cm-games
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cm-pod-manager
  namespace: cm-games
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "create", "delete", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "create", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cm-orchestrator-binding
  namespace: cm-games
subjects:
  - kind: ServiceAccount
    name: cm-orchestrator
    namespace: cm-games
roleRef:
  kind: Role
  name: cm-pod-manager
  apiGroup: rbac.authorization.k8s.io
```

### Web App Deployment

```yaml
# k8s/web-app-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cm-web-app
  namespace: cm-games
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cm-web-app
  template:
    metadata:
      labels:
        app: cm-web-app
    spec:
      serviceAccountName: cm-orchestrator
      containers:
        - name: web-app
          image: YOUR_DOCKERHUB/cm-web-app:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_PATH
              value: "/data/cm-app.db"
            - name: GAME_IMAGE
              value: "YOUR_DOCKERHUB/cm0102-server:latest"
            - name: GAME_DOMAIN
              value: "game.yourdomain.com"
          volumeMounts:
            - name: app-data
              mountPath: /data
      volumes:
        - name: app-data
          hostPath:
            path: /data/cm-app
            type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: cm-web-app
  namespace: cm-games
spec:
  selector:
    app: cm-web-app
  ports:
    - port: 3000
      targetPort: 3000
```

### Web App Ingress (adapt from live-agent repo's Traefik ingress pattern)

```yaml
# k8s/web-app-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cm-web-app-ingress
  namespace: cm-games
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - game.yourdomain.com
      secretName: cm-game-tls
  rules:
    - host: game.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: cm-web-app
                port:
                  number: 3000
```

### Idle Cleanup CronJob

```yaml
# k8s/idle-cleanup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cm-idle-cleanup
  namespace: cm-games
spec:
  schedule: "*/10 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: cm-orchestrator
          containers:
            - name: cleanup
              image: YOUR_DOCKERHUB/cm-web-app:latest
              command: ["node", "src/cleanup.js"]
              env:
                - name: DATABASE_PATH
                  value: "/data/cm-app.db"
                - name: IDLE_TIMEOUT_MINUTES
                  value: "30"
              volumeMounts:
                - name: app-data
                  mountPath: /data
          volumes:
            - name: app-data
              hostPath:
                path: /data/cm-app
                type: DirectoryOrCreate
          restartPolicy: OnFailure
```

---

## Phase 3: Web Application

### Tech stack
- Node.js with Express
- SQLite for user accounts and session tracking
- @kubernetes/client-node for K8s API
- bcrypt for password hashing
- express-session for session management
- EJS for templates (or serve a simple static frontend)

### Database schema

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- UUID
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  pod_name TEXT NOT NULL,
  vnc_password TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'running'  -- running, stopped
);
```

### Core orchestration logic (src/k8s.js)

The web app needs to:

1. **startGameForUser(userId)**: 
   - Generate a VNC password
   - Create a Pod with the game image, mounting /data/cm-saves/{userId} as /saves
   - Create a Service pointing to the Pod
   - Create an Ingress routing game.yourdomain.com/play/{userId}/* to the Service on port 6080
   - Record the session in the database
   - Return the noVNC URL

2. **stopGameForUser(userId)**:
   - Delete the Pod, Service, and Ingress
   - Update the session status in the database
   - Save files persist on the host volume

3. **getGameStatus(userId)**:
   - Check if a Pod exists and is running
   - Return status and noVNC URL if active

### Pod resource limits

Each game Pod should have:
```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

### User-facing routes

- `GET /` - redirect to dashboard or login
- `GET /register` - registration form
- `POST /register` - create account
- `GET /login` - login form
- `POST /login` - authenticate
- `POST /logout` - end session
- `GET /dashboard` - show game status, start/stop buttons
- `POST /game/start` - spin up game Pod, redirect to play page
- `POST /game/stop` - stop game Pod
- `GET /play` - page with embedded noVNC iframe pointing to user's game instance

### Dashboard page behaviour

- If no game running: show "Start New Game" or "Resume Game" button
- If game running: show embedded noVNC iframe with the game, plus a "Stop Game" button
- Show last played timestamp

### Idle cleanup logic (src/cleanup.js)

- Query game_sessions where status = 'running' and last_activity < now - IDLE_TIMEOUT_MINUTES
- For each: call stopGameForUser()
- This runs as a CronJob every 10 minutes

### Tracking activity

The web app should update last_activity in the database. Options:
- Heartbeat endpoint called by the frontend every few minutes via JavaScript
- Or: check the noVNC WebSocket connection status

A simple frontend heartbeat is the most reliable approach:
```javascript
// In the play page
setInterval(() => fetch('/api/heartbeat', { method: 'POST' }), 60000);
```

---

## Phase 4: CI/CD

### GitHub Actions workflow (adapt from live-agent repo)

```yaml
# .github/workflows/build.yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build-game-image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}
      - uses: docker/build-push-action@v5
        with:
          context: ./docker/game
          push: true
          tags: YOUR_DOCKERHUB/cm0102-server:latest

  build-web-app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}
      - uses: docker/build-push-action@v5
        with:
          context: ./web-app
          push: true
          tags: YOUR_DOCKERHUB/cm-web-app:latest
```

Note: The game image will be large (the Wine prefix + CM files). Consider using GitHub Actions cache for Docker layers. The game files themselves won't change often, so the cache will be effective.

---

## Phase 5: Server Setup and Deployment

### Prerequisites on Hetzner server
- Kubernetes cluster running (already in place)
- Traefik ingress controller (already in place)
- cert-manager with Let's Encrypt (already in place)
- Domain pointed to server (e.g. game.yourdomain.com)
- Docker installed (for initial Wine prefix build)

### One-time manual step: build the template Wine prefix

This must be done interactively because the CM installer needs user interaction:

```bash
# On the Hetzner server
mkdir -p /tmp/cm-build && cd /tmp/cm-build

# Download the game (from fmscout link)
# Download the 3.9.68 patch (from champman0102.net)

# Run a temporary container with Wine and a display
docker run -it --rm \
  -v /tmp/cm-build:/build \
  -e DISPLAY=:1 \
  ubuntu:24.04 bash

# Inside the container:
apt update && apt install -y wine xvfb x11vnc
Xvfb :1 -screen 0 1024x768x24 &
# Mount the disc image and run the installer
# Apply the patch
# Test that the game launches
# Copy the Wine prefix out to /build/cm0102-wineprefix
```

Then copy the resulting Wine prefix into docker/game/cm0102-wineprefix/ in the repo.

Note: the Wine prefix will be several hundred MB. Consider using .gitignore and storing it separately (e.g. download it during the Docker build from a file host, or use Git LFS).

### Deploy to cluster

```bash
git clone https://github.com/YOUR_USER/cm0102-cloud.git
cd cm0102-cloud
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/web-app-deployment.yaml
kubectl apply -f k8s/web-app-ingress.yaml
kubectl apply -f k8s/idle-cleanup-cronjob.yaml
```

---

## Resource Planning

### Per-user Pod cost
- CM 01/02: ~50-100MB RAM
- Wine overhead: ~100-150MB
- Xvfb + x11vnc + noVNC: ~50MB
- Total: ~250-350MB RAM per active session
- CPU: negligible (turn-based game designed for Pentium III)

### Server capacity estimates

| Hetzner plan | RAM   | Price     | Concurrent users |
|-------------|-------|-----------|-----------------|
| CX22        | 4GB   | ~€4/month | 8-10            |
| CX32        | 8GB   | ~€7/month | 18-20           |
| CX42        | 16GB  | ~€14/month| 35-40           |

### Capacity optimisations
- Aggressive idle timeout (30 min default, consider 15-20 min)
- Add swap space (4GB) as overflow buffer - acceptable for a turn-based game
- Encourage users to load fewer leagues (reduces per-instance RAM)

---

## Security Checklist

- [ ] All traffic over HTTPS via Traefik + cert-manager
- [ ] VNC passwords generated per-session, never exposed to client (web app proxies connection)
- [ ] User passwords hashed with bcrypt
- [ ] Pod resource limits enforced (prevent one user starving others)
- [ ] Rate-limit game start requests (prevent abuse)
- [ ] Container runs as non-root user where possible
- [ ] noVNC only accessible through authenticated web app routes (not directly exposed)
- [ ] Idle cleanup prevents resource exhaustion
- [ ] Input validation on all web app routes

---

## Build Order (recommended sequence)

1. **Docker game image** - get CM 01/02 running in a container with noVNC, test manually
2. **K8s namespace + RBAC** - set up the namespace and permissions
3. **Test game as standalone Pod** - deploy manually with kubectl, verify it works
4. **Web app scaffolding** - Express app with auth (register/login/logout)
5. **K8s orchestration** - web app creates/deletes Pods, Services, Ingresses
6. **Dashboard + noVNC embedding** - frontend that launches and displays the game
7. **Idle cleanup** - CronJob to stop inactive sessions
8. **CI/CD** - GitHub Actions to build and push both images
9. **Polish** - error handling, loading states, mobile-friendly layout, monitoring

---

## Known Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Wine compatibility issues with CM | Game won't run | Check WineHQ AppDB, use known-good Wine version, test early |
| noVNC latency | Poor play experience | Acceptable for turn-based game; ensure server is geographically close |
| Large Docker image (Wine prefix) | Slow builds, slow Pod startup | Use layer caching, pre-pull image on node, consider image streaming |
| Pod startup time | User waits to play | Pre-pull the game image; display a loading screen while Pod starts |
| Resource exhaustion | Server crashes | Pod limits + idle cleanup + swap + monitoring |
| Save file corruption | User loses progress | Could add periodic backup of save directories |
| Disc image licensing | Legal issues | None - Eidos officially released as freeware in 2009 |
