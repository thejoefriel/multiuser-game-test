# AI Log

## 2026-02-21

### Goal
Initial repository setup — config files, agent rules, documentation structure.

### Plan
- Clone empty repo
- Copy agent workflow config from habits-builder (.claude, .cursor, CLAUDE.md, AGENTS.md)
- Adapt AGENTS.md for this project (Node.js/K8s/Docker conventions instead of Python)
- Create docs directory with AI_LOG.md
- Move project plan into the repo

### Decisions
- Kept the same workflow rules (Read → Plan → Wait → Execute → Commit → PR → Stop) from habits-builder
- Removed Python-specific conventions, added Node.js, Kubernetes, and Docker sections
- Removed the "verify rules setup" self-check step (unnecessary for a new project)

### Files changed
- `CLAUDE.md` — points to AGENTS.md
- `AGENTS.md` — agent rules adapted for this project
- `.claude/settings.local.json` — basic git permissions
- `.cursor/rules/load-agents-md.mdc` — Cursor rule pointing to AGENTS.md
- `docs/AI_LOG.md` — this file

### Follow-ups
- ~~Move `cm0102-cloud-project-plan.md` into the repo~~ Done
- ~~Begin Phase 1: Docker game image~~ Done (see below)

---

## 2026-02-21 — Phase 1: Docker Game Image

### Goal
Create the Docker image files for running CM 01/02 headlessly with noVNC access.

### Plan
- Create `docker/game/Dockerfile` (Ubuntu 24.04 + Wine + Xvfb + x11vnc + noVNC)
- Create `docker/game/entrypoint.sh` (starts display, VNC, noVNC, launches game)
- Create `docker/game/.dockerignore`
- Create `docker/game/README.md` (manual Wine prefix build instructions)

### Decisions
- Added `dpkg --add-architecture i386` to Dockerfile — required for Wine on 64-bit Ubuntu
- Used `--no-install-recommends` to keep image smaller
- Used `exec wine ...` in entrypoint so SIGTERM propagates for clean Pod shutdown
- Documented the manual Wine prefix build in a README rather than trying to automate the interactive installer

### Files changed
- `docker/game/Dockerfile` — new
- `docker/game/entrypoint.sh` — new
- `docker/game/.dockerignore` — new
- `docker/game/README.md` — new
- `docs/AI_LOG.md` — updated

### Follow-ups
- Manually build the Wine prefix on the Hetzner server (Phase 5 prerequisite)
- ~~Phase 2: Kubernetes manifests~~ Done (see below)

---

## 2026-02-21 — Phase 2: Kubernetes Manifests

### Goal
Create all Kubernetes manifests for the cm-games namespace.

### Plan
- Namespace, RBAC, web app Deployment + Service, Ingress, idle cleanup CronJob

### Decisions
- Followed the project plan exactly for all manifests
- Left `YOUR_DOCKERHUB` and `game.yourdomain.com` as placeholders — to be replaced during deployment
- All resources in `cm-games` namespace per AGENTS.md conventions

### Files changed
- `k8s/namespace.yaml` — new
- `k8s/rbac.yaml` — new (ServiceAccount + Role + RoleBinding)
- `k8s/web-app-deployment.yaml` — new (Deployment + Service)
- `k8s/web-app-ingress.yaml` — new (Traefik Ingress with TLS)
- `k8s/idle-cleanup-cronjob.yaml` — new (CronJob every 10 min)
- `docs/AI_LOG.md` — updated

### Follow-ups
- Replace placeholder values with real Docker Hub username and domain
- ~~Phase 3: Web application~~ Done (see below)

---

## 2026-02-21 — Phase 3: Web Application

### Goal
Build the full Express web app: auth, K8s orchestration, dashboard, game views, idle cleanup.

### Plan
- Scaffold `web-app/` with package.json and Dockerfile
- Create database module with SQLite schema (users + game_sessions)
- Create auth module (bcrypt hashing, session middleware)
- Create K8s orchestration module (start/stop/status game Pods)
- Create route handlers (auth, game, dashboard)
- Create idle cleanup script for CronJob
- Create EJS views (login, register, dashboard, play)

### Decisions
- Used `better-sqlite3` over `sqlite3` — synchronous API is simpler for this use case
- Used prepared statements for all DB queries
- K8s resource names use first 8 chars of userId to stay within K8s naming limits
- `ignoreNotFound` helper in stopGameForUser to handle already-deleted resources gracefully
- Play page auto-refreshes every 5s while Pod is pending
- Heartbeat runs every 60s from the play page to keep session alive
- Dark theme UI matching the CM 01/02 aesthetic
- Web app Dockerfile uses `node:20-slim` and `npm ci --production`

### Files changed
- `web-app/package.json` — new
- `docker/web-app/Dockerfile` — new
- `web-app/src/db.js` — new
- `web-app/src/auth.js` — new
- `web-app/src/k8s.js` — new
- `web-app/src/cleanup.js` — new
- `web-app/src/index.js` — new
- `web-app/src/routes/auth.js` — new
- `web-app/src/routes/game.js` — new
- `web-app/src/routes/dashboard.js` — new
- `web-app/views/login.ejs` — new
- `web-app/views/register.ejs` — new
- `web-app/views/dashboard.ejs` — new
- `web-app/views/play.ejs` — new
- `docs/AI_LOG.md` — updated

### Follow-ups
- Phase 4: CI/CD (GitHub Actions)
