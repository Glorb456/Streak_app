# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Streak: a self-hosted task calendar with daily-habit streak tracking, plus **Streak Notes**, a second independent OneNote-style app living in `notes/`. Everything runs in Docker behind one nginx + oauth2-proxy (one Google login covers both apps). It's a personal homelab project; most code is AI-generated and changes are logged in `EDITS.md` — append a dated section there after a significant pass.

Note: the live deployment on this machine runs from a **different checkout** (containers prefixed `streak_app`). Don't restart or rebuild those from this repo.

## Commands

There is **no node/npm/python on the host** — use Docker (the `node:20-alpine` image is already cached):

```bash
# Frontend unit tests (pure logic: dates, tasks ordering, streak tint, notes encoding)
docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine npx vitest run
# Single test file:
docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine npx vitest run src/tasks.test.js

# Frontend build check (dist/ is gitignored; Docker images build from source)
docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine npm run build

# Notes frontend: same commands with notes/frontend; run `npm install` first (its
# node_modules may lack dev deps): sh -c "npm install --no-audit && npm run build"

# Backend tests (throwaway Postgres, nothing needed locally)
docker compose -f docker-compose.test.yml up --build \
    --abort-on-container-exit --exit-code-from backend-tests

# Full stack (don't do this on the machine running the live streak_app deployment)
docker compose up -d --build     # app at :3000
```

Notes backend has its own `notes/docker-compose.test.yml` with the same pattern.

## Architecture

Two parallel app stacks, one origin:

```
/            frontend/        React (Vite) SPA — the task calendar
/api/        backend/         FastAPI + PostgreSQL 16 (tasks, daily tasks, settings, sync)
/notes/      notes/frontend/  React SPA — notebook app
/api/notes/  notes/backend/   FastAPI over plain files in notes/notebook/ — NO database
```

`frontend/nginx.conf` is the single router; oauth2-proxy fronts it. `/api/notes/` deliberately sits under `/api` so oauth2-proxy's `--api-route=^/api` returns 401s (not login-page HTML) to both clients. The only unauthenticated routes are `/api/sync/peer/*`, guarded by pre-shared `X-Sync-Token`.

`companion/` is a thin Electron shell (Windows installer + Linux .deb/AppImage) that clones this repo, runs `docker compose` for it and shows the app in a window — no app logic lives there; see `companion/README.md`. Its packages are built by `.github/workflows/companion-release.yml`, not locally (no node on the host).

### Backend conventions (task app)

- **Every SQL statement is its own file**: `backend/app/sql/queries/<name>.sql`, loaded by `db.sql("name")`; `sql/init/*.sql` run in order at startup (idempotent). Exception: the sync engine (`sync.py`) generates its statements from the `SYNCED_TABLES` registry so a new column can't be forgotten in one of many files — a new synced column must be added to that registry.
- Route-ordering matters: literal routes (`/tasks/reorder`, `/daily/completions`, `/daily/streak`) are declared before their `/{id}` siblings; keep that order.
- Task ordering is an ascending `position` per day; new tasks insert at `MIN(position) - 1` (positions can be negative) so a create never renumbers. Reorder rewrites a whole day in one statement.
- Daily tasks are soft-deleted (`active = FALSE`) and carry a `days_mask` weekday schedule (bit 0 = Monday; 0 = "parked"). The streak endpoint takes the client's local date; server timezone is irrelevant.
- Settings are a key/value string table. All flags are strings: `'1'`/`'0'` (e.g. `hide_completed`, `cyberpunk_skin`).

### Multi-node sync (`backend/app/sync.py`, `routers/sync.py`, `notesync.py`)

Star topology set by env `SYNC_ROLE` (host | backup | mirror). Backups/mirrors run a pull-then-push loop against the host; rows travel by `uid` (serial ids never leave a node), merge is last-writer-wins on `updated_at`, deletes carry tombstones (`sync_deletions`), losers land in `sync_conflicts` for the ⚠ resolver UI. A DB trigger touches `updated_at` on writes but is bypassed during imports via `SET LOCAL streak.sync = 'on'` so applied rows keep the peer's timestamps. Backup/mirror nodes skip the seed SQL (`db.py`) — they must receive seeded rows from the host under the host's uids. Notes sync is rsync-shaped (sha256 manifest, preserved mtimes, tombstones, "(conflict …)" copies).

### Frontend conventions (task app, `frontend/src/`)

- One `App.jsx` owns all state; loads everything via `syncAll()` and polls every 5 s. The poll **pauses while a modal is open or a drag is active** (refs `modalRef`/`draggingRef`) — any new overlay that live-edits data should do the same. Writes are optimistic; on failure: `alert(...)` + `syncAll()`.
- `tasks.js` re-derives order client-side (`orderTasks`: due_date, position, id) because optimistic mutations break arrival order. `applyVisibleOrder` deals hidden ("hide done") rows back into their slots on reorder.
- `notes.js`: task notes/checklists are plain text with markdown-style `- [ ]` / `- [x]` lines — the same encoding used by sticky notes and Streak Notes pages, so the same note renders everywhere. `NotesEditor.jsx` is shared by the task modal and the sticky pad.
- `useDragOrder.js`: drag-reorder built on pointer events (HTML5 DnD never fires on iOS Safari). It measures once at pointerdown and writes transforms directly to nodes so React never re-renders mid-drag. Desktop calendar drags the card itself; mobile list drags a ☰ handle (`touch-action: none` is load-bearing).
- `failover.js` + `public/sw.js`: clients cache the failover origin chain in localStorage and walk it when the current node dies; the service worker caches only the app shell and never touches `/api`, `/oauth2`, `/notes`.
- Sticky notes (`StickyNotes.jsx`) store their content in Streak Notes' app-owned "Sticky Notes" section via `notesApi` — same origin, same cookie, no second store.
- Styling is one `styles.css`, no framework. Notable scoped blocks: mobile ≤640px (calendar collapses to dots + `DayTaskList`), wide task modal ≥820px, the iOS 16px focus-zoom guard (every text input must compute ≥16px on touch devices), and the cyberpunk skin — every skin override lives under `.app.cyberpunk`, toggled by the `cyberpunk_skin` setting (App.jsx skips the inline background style when it's on so the CSS grid overlay survives).
- localStorage keys: `streak.onboarded.v1` (first-run tour), `streak_failover_origins`, `streak.sticky.pos.v1`.

### Notes app (`notes/`)

The filesystem is the source of truth: one directory per section, one file per page (`.md`, or `.draw.json` for hand-drawn vector pages); `.streaknotes.json` sidecar holds only ordering/colors; `.assets/` holds content-hash-addressed images. All logic is in `notes/backend/app/store.py`. Titles are filenames, so renames move files and change page ids — clients must follow the returned id. Concurrent drawing saves use etags (`if_match`); a 409 means merge and retry. Section flagged `sticky` in the tree is the app-owned Sticky Notes section, materialized on read.
