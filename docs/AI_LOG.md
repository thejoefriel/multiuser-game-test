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
- Phase 2: Kubernetes manifests
