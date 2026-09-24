# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Streak: a self-hosted task calendar with daily-habit streak tracking, plus **Streak Notes**, a second independent OneNote-style app living in `notes/`. Everything runs in Docker behind one nginx + oauth2-proxy (one Google login covers both apps). It's a personal homelab project; most code is AI-generated and changes are logged in `EDITS.md` — append a dated section there after a significant pass.

Note: the live deployment on this machine runs **from this checkout** — compose project `streak_app` (pinned by `name:` in `docker-compose.yml`), working dir `/home/siddhant/Documents/homelab/streak-github`. So editing the source changes nothing a browser can see until the image is rebuilt: `docker compose up -d --build frontend` (it recreates the backends it depends on too). Confirm with the user before rebuilding — it briefly takes the live app down — and remember that a running tab keeps its old bundle until reloaded; the sync menu's build stamp says which one it has.

The git remote is `github.com/Glorb456/Streak_app.git`. That matters beyond hosting: the companion app clones *that URL* to install a node, so a change only reaches other machines once it is pushed.

There are three long-form READMEs worth reading before a big change in their area: `README.md` (task app + operations + backup ladder), `notes/README.md` (Streak Notes, including the drawing engine), `companion/README.md` (Electron shell, installation, Docker setup per OS).

## Commands

There is **no node/npm/python on the host** — use Docker (the `node:20-alpine` image is already cached). Current baselines, all green as of 2026-09-23:

```bash
# Task frontend unit tests — 88 tests (dates, task ordering, streak tint,
# notes encoding, sync-menu state machine)
docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine npx vitest run
# Single test file:
docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine npx vitest run src/tasks.test.js

# Notes frontend unit tests — 117 tests (markdown parser, page selection, palm
# rejection, and the whole drawing engine: codec, doc merge, erase, geometry)
docker run --rm -v "$PWD/notes/frontend":/app -w /app node:20-alpine npx vitest run

# Build checks (dist/ is gitignored; Docker images build from source)
docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine npm run build
docker run --rm -v "$PWD/notes/frontend":/app -w /app node:20-alpine npm run build
# Both node_modules trees currently carry their dev deps, so no install step is
# needed. If vite/vitest ever goes missing, wrap the command:
#   sh -c "npm install --no-audit && npm run build"

# Task backend tests — 90 tests, throwaway Postgres, nothing needed locally
docker compose -f docker-compose.test.yml up --build \
    --abort-on-container-exit --exit-code-from backend-tests

# Notes backend tests — 78 tests; must run from notes/ (build context ./backend)
cd notes && docker compose -f docker-compose.test.yml up --build \
    --abort-on-container-exit --exit-code-from backend-tests

# Full stack (don't do this on the machine running the live streak_app deployment)
docker compose up -d --build     # app at :3000
```

Both backend suites run against the real thing on purpose — a real Postgres for the task app, a real `tmp_path` directory for the notes store — because in both apps the behaviour under test lives in SQL files or in the filesystem layout, and a mock would test nothing. `backend/tests/conftest.py` truncates and re-seeds before **every** test, so tests are order-independent; `notes/backend/tests/conftest.py` monkeypatches `store.ROOT`, so the real notebook is never touched.

## Architecture

Two parallel app stacks, one origin:

```
/            frontend/        React (Vite) SPA — the task calendar
/api/        backend/         FastAPI + PostgreSQL 16 (tasks, daily tasks, settings, sync)
/notes/      notes/frontend/  React SPA — notebook app
/api/notes/  notes/backend/   FastAPI over plain files in notes/notebook/ — NO database
```

`frontend/nginx.conf` is the single router. nginx matches the longest prefix, so `location /api/notes/` wins over `/api/` without either app knowing about the other, and `location /notes/` proxies with a trailing slash so the notes container serves ordinary root-relative paths (its Vite `base` is `/notes/` to match).

**Two access paths, and only one of them is authenticated:**

- `frontend` publishes `3000:80` on every interface. That LAN path bypasses oauth2-proxy entirely and is unauthenticated **on purpose** (docker-compose.yml says so). Anything reachable at `:3000` is reachable by anyone on the wifi.
- `oauth2-proxy` binds `127.0.0.1:4180` — loopback only, reachable by the host's `tailscaled` and nothing else. Tailscale Funnel → 4180 → frontend is the public path, and that is where the single-Google-account restriction lives (`authenticated-emails.txt`).

`--api-route=^/api` makes oauth2-proxy answer an expired session under `/api` with a 401 instead of Google login HTML — which is why `/api/notes/` deliberately sits under `/api`, so both clients' polls get a parseable 401 rather than a login page. Routes oauth2-proxy skips: `/api/sync/peer/` and `/api/notes/sync/` (machine sync — they enforce the pre-shared `X-Sync-Token` themselves and 403 when `SYNC_TOKEN` is unset), plus `manifest.webmanifest`, `/icons/`, `favicon.ico` and `apple-touch-icon.png` (iOS fetches the home-screen icon from contexts that carry no session cookie). Sessions are 30 days with refresh deliberately off — Google expires refresh tokens after 7 days while the OAuth app is in "Testing".

`docker-compose.mirror.yml` is a complete second stack (project `streak_mirror`, port 3100, oauth2-proxy on 4181) for a buddy hosting *someone else's* data: the owner supplies the OAuth env and email allowlist, so the buddy runs the service but cannot log into it.

`companion/` is a thin Electron shell (Windows installer + Linux .deb/AppImage) that clones this repo, runs `docker compose` for it and shows the app in a window — no app logic lives there; see `companion/README.md`. Its packages are built by `.github/workflows/companion-release.yml` (manual dispatch, or a `companion-v*` tag for a Release), not locally (no node on the host).

### Backend conventions (task app)

- **Every SQL statement is its own file**: `backend/app/sql/queries/<name>.sql`, loaded by `db.sql("name")`; `sql/init/*.sql` run in order at startup (idempotent — they are `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` all the way down, and re-run on every boot). Exception: the sync engine (`sync.py`) generates its statements from the `SYNCED_TABLES` registry so a new column can't be forgotten in one of many files — a new synced column must be added to that registry.
- Route-ordering matters in **both** backends: literal routes are declared before their `/{id}` siblings, because FastAPI matches in definition order. Task app: `/tasks/reorder`, `/daily/completions`, `/daily/streak`. Notes app: `/sections/order`, `/assets`, `/sections/{id}/pages/order`. Keep that order.
- Task ordering is an ascending `position` per day; new tasks insert at `MIN(position) - 1` (positions can be negative) so a create never renumbers. `tasks_reorder.sql` rewrites a whole day in one statement via `unnest(...) WITH ORDINALITY`, and its `due_date` guard means ids from another day match nothing — a stale tab can only renumber the day it was looking at.
- Daily tasks are soft-deleted (`active = FALSE`) and carry a `days_mask` weekday schedule (bit 0 = Monday; 0 = "parked"). `daily_tasks_list.sql` filters to `active`, so a soft-deleted task disappears from the API but keeps its completion history. Creating one backfills `daily_task_completions` as done on every scheduled day in the `STREAK_WINDOW_DAYS` (400) before the client's `today` (`daily_completions_backfill.sql`, same transaction as the insert) — the streak walk judges past days against the schedules as they stand *now*, so without it a task added today would read as missed all the way back. The creation day itself is left alone.
- The streak endpoint takes the client's local date, so the server timezone is irrelevant. It walks back at most 400 days; a day with nothing scheduled carries the streak through rather than breaking it; today only counts once fully done. `daily_streak_counts.sql` excludes completions recorded on a day the task wasn't scheduled (the endpoint compares counts, so an off-schedule tick would otherwise stand in for a task that really was due), and uses `EXTRACT(ISODOW ...)::int - 1` because `>>` is undefined for numeric on PG14+.
- Seeding is gated on a `seeded` row in `settings`, not `ON CONFLICT` — names stopped being unique once deletes went soft.
- Settings are a key/value **string** table; all flags are `'1'`/`'0'`. The live keys are `background_color`, `cyberpunk_skin`, `failover_origins` (a JSON array), `hide_completed`, `streak_emoji`. `seeded` is internal and filtered out of `GET /settings` by `INTERNAL_KEYS` in `routers/settings.py`.
- `GET /api/health` exists for the failover probes and must stay cheap and unauthenticated-friendly.
- `projects` is scaffolding for a future feature: the table, the FK on `tasks.project_id` and the sync registry entry all exist, but no route creates one.

### Multi-node sync (`backend/app/sync.py`, `routers/sync.py`, `notesync.py`)

Star topology set by env `SYNC_ROLE` (host | backup | mirror | empty). The host runs **no** loop of its own; each backup (default 30 s) and each buddy mirror (default 600 s) runs `engine_loop()`, which every cycle pulls the host's changes, pushes its own, then syncs the notebook. Rows travel by `uid` (serial ids never leave a node), merge is last-writer-wins on `updated_at`, deletes carry tombstones (`sync_deletions`), losers land in `sync_conflicts` for the ⚠ resolver UI (`ConflictsModal.jsx`; restoring re-applies the losing version as a fresh, propagating edit and retires the tombstone if it was a delete).

Details that bite:

- A DB trigger touches `updated_at` on writes but is bypassed during imports via `SET LOCAL streak.sync = 'on'`, so applied rows keep the peer's timestamps. Without that, every merge would re-stamp every row and the two nodes would echo forever. The deletion-recording trigger honours the same flag.
- Backup/mirror nodes skip the seed SQL (`db.py`) — they must start empty and receive seeded rows from the host under the host's uids, or the first merge duplicates every seeded row.
- Watermarks are handed back 10 s in the past (`SLACK`) and equal-timestamp rows are skipped on apply, so the deliberate overlap costs nothing. Nodes are assumed to run NTP; timestamps are compared across machines.
- `SYNCED_TABLES` covers `categories`, `projects`, `daily_tasks`, `tasks` in dependency order (parents first, so FK uids resolve as the import walks). Completions, settings and deletions are handled by their own hand-written blocks in `export_changes`/`import_changes` — a new *table* needs work in all of those places, not just the registry. `sync_conflicts` and `sync_peers` are per-node bookkeeping and are never synced.
- **Encrypted buddy snapshots** are a separate, host-only path for a buddy the owner doesn't want holding plaintext: `blob_job()` gzips a full export plus every notes file, seals it with AES-256-GCM under `BUDDY_BLOB_KEY` (SHA-256 of the passphrase), and POSTs it to the buddy's `/api/sync/peer/blob` every `BLOB_INTERVAL` (default 6 h). The receiving node stores ciphertext in the `streak_blobs` volume and prunes to the newest `BLOB_KEEP` (14). Recovery is `scripts/restore_blob.py` against a fresh stack — it replays through `/api/sync/peer/import`, so uids and timestamps survive.
- Notes sync is rsync-shaped (sha256 manifest, preserved mtimes, tombstones, "(conflict …)" copies). Preserving mtimes on write is load-bearing: "which side is newer" is a cross-machine mtime comparison. Only `.streaknotes.json` and `.assets/` may travel among the dot-paths; `.sync-tombstones.json` and `*.tmp` are excluded from the manifest. The "both sides changed" marker (`_last_sync`) is in-memory per process — after a restart the worst case is one extra conflict copy, chosen over data loss.

### Frontend conventions (task app, `frontend/src/`)

- One `App.jsx` owns all state; loads everything via `syncAll()` (one `Promise.all` over every endpoint) and polls every 5 s. The poll **pauses while a modal is open or a drag is active** (refs `modalRef`/`draggingRef`, the latter fed by `onDragActive` on `Calendar`/`DayTaskList`) — any new overlay that live-edits data should do the same. Writes are optimistic; on failure: `alert(...)` + `syncAll()`. `api.syncStatus()` is wrapped in `.catch(() => null)` so an older backend can't take the whole poll down.
- `api.js` reloads the page on any 401, so an expired oauth2-proxy session turns into a login redirect instead of a poll that fails silently forever. Errors carry `err.status` for callers that recover from a specific one.
- `tasks.js` re-derives order client-side (`orderTasks`: due_date, position, id) because optimistic mutations break arrival order. `applyVisibleOrder` deals hidden ("hide done") rows back into their slots on reorder — the endpoint renumbers a whole day, so sending only the visible ids would strand the hidden ones on stale positions.
- `notes.js`: task notes/checklists are plain text with markdown-style `- [ ]` / `- [x]` lines — the same encoding used by sticky notes and Streak Notes pages, so the same note renders everywhere. `NotesEditor.jsx` is shared by the task modal and the sticky pad (`toolbar={false}` + `toggleRef` let the sticky pad supply its own ✓ button).
- `useDragOrder.js`: drag-reorder built on pointer events (HTML5 DnD never fires on iOS Safari). It measures once at pointerdown and writes transforms directly to nodes so React never re-renders mid-drag. Desktop calendar drags the card itself; mobile list drags a ☰ handle (`touch-action: none` is load-bearing). A 5 px threshold and a 300 ms post-drag click grace keep tap-to-edit and double-click-to-edit alive.
- `failover.js` + `public/sw.js`: clients cache the failover origin chain in localStorage and walk it **strictly in order**, stopping at the first reachable origin, so a live host means no backup is ever probed. Cross-origin probes use `mode: 'no-cors'` (a funnel's cookie-less 401 carries no CORS headers, and an opaque response still proves the machine answered). The service worker is network-first, caches only the app shell, and never touches `/api`, `/oauth2` or `/notes`; it drops a timestamped `/__served-from-cache` marker that `shellcache.js` reads once at boot and consumes.
- `syncstate.js` is the pure state machine behind the sync menu (`offline` → `cached` → `stale`/`down` → `connecting` → `ok`), kept separate precisely so it can be unit-tested. `vite.config.js` stamps `__BUILD_ID__` into the bundle, and `SyncMenu.jsx` compares the entry-asset path in the freshly-fetched `/` against the one this tab is running — that comparison is how a stale tab or a never-rebuilt container becomes visible from the inside.
- Sticky notes (`StickyNotes.jsx`) are opened from one `.sticky-launch` bar rendered in ordinary flow after `DayTaskList` — a phone gets it as a bar under today's tasks, and a `min-width: 641px` rule pins that same element to the bottom-right corner, so there is no second copy to keep in step. They store their content in Streak Notes' app-owned "Sticky Notes" section via `notesApi` — same origin, same cookie, no second store. A note's title is its first line, sanitised the same way the store sanitises filenames so the name and the first line can't disagree; a rename the store rejects as a duplicate is remembered so it isn't retried on every keystroke.
- Styling is one `styles.css` (~1570 lines), no framework. Notable scoped blocks: mobile ≤640px (calendar collapses to dots + `DayTaskList`), wide task modal ≥820px, the `(pointer: coarse)` 16px focus-zoom guard (every text input must compute ≥16px on touch devices, or iOS zooms the viewport on focus), and the cyberpunk skin from ~line 1387 — every skin override lives under `.app.cyberpunk`, toggled by the `cyberpunk_skin` setting (App.jsx skips the inline background style when it's on so the CSS grid overlay survives).
- localStorage keys: `streak.onboarded.v1` (first-run tour), `streak_failover_origins`. Streak Notes adds `streak-notes.tools.v1` (pencil slots, deliberately per-device).

### Notes app (`notes/`)

The filesystem is the source of truth: one directory per section, one file per page (`.md`, or `.draw.json` for hand-drawn vector pages); `.streaknotes.json` sidecar holds only ordering/colors; `.assets/` holds content-hash-addressed images. All logic is in `notes/backend/app/store.py` — the router only translates `StoreError` into HTTP.

- Page ids are base64url of the path relative to the notebook root, so **titles are filenames**: renames move files and change page ids, and clients must follow the returned id. `decode_id` is the single traversal chokepoint; a malformed id and a stale one both answer 404.
- Concurrent drawing saves use etags (sha256 of the bytes, not mtime); `if_match` mismatch gives a 409 whose body carries the page as it now stands, so `DrawingPage.jsx` merges per element (`mergeDocs`) and retries — up to three attempts, since each conflict resolves one competing save. Markdown pages send no `if_match` and stay last-write-wins with a debounced autosave.
- A rename is delete-old + create-new to the file sync, so `update_page` records a tombstone and then explicitly sets the new file's mtime *after* that stamp — kernel file timestamps are coarser than `time.time()`, and a "touch now" can land a tick before a stamp taken moments earlier.
- The section flagged `sticky` in the tree is the app-owned Sticky Notes section: materialized on read by `ensure_sticky_section()` (so it reappears even if deleted by hand), pinned first in the sidebar, 403 on rename or delete, and markdown-only — a drawing there would be a page the sticky widget could not open.
- Limits worth knowing: page 5 MB, asset 12 MB, filename 120 chars, one synced file 16 MB, blob 512 MB. Uploaded images are identified by **magic bytes**, never by the client's filename, and served with an immutable cache header because the id is the content hash. Tombstones are pruned after 90 days.
- The drawing format (`notes/frontend/src/draw/`) is a JSON envelope with the sample stream packed — quantise to 1/16 px, delta, zigzag, LEB128, base64 — roughly 3 bytes per sample against ~30 naive. `codec.js` owns the wire format (bump `ENCODING` if it changes), `doc.js` the element ops and the cross-device merge (element tombstones, 30-day TTL, creation-time ordering with an id tiebreak so two devices draw the same order), `geometry.js` the pure stroke math, `erase.js` both erasers, `render.js` the two-canvas split (committed base layer vs. the live stroke) that is the whole latency story, `palm.js` the one predicate both palm guards share.
- Palm rejection is in two places and both matter. The stage refuses touches in its own `pointerdown`; everything else on the page — toolbar, title, top bar — is covered by native **capture-phase listeners on `document`** installed by `DrawingPage`, because React's own listeners sit at the app root and that is the only place that runs first. The event matters too: `preventDefault()` on `pointerdown` does not stop the click, focus or simulated `:hover` iOS synthesises from a touch, so the gate cancels `touchstart` (and the matching `touchend`). Stylus touches are skipped — the Pencil raises touch events as well, and the gate would otherwise refuse every toolbar tap made with the pen.
- `selection.js` is the pure rule for which section and page are selected; `App.jsx` runs it on every tree change, so it is also the repair after a delete or rename. It never defaults to the sticky section. Because it judges against the tree *in state*, every mutation fetches the new tree and commits it in the **same synchronous block** as the selection it moves — split across two ticks, the rule sees an id that does not exist yet and undoes the move (a new page that would not open, a rename that bounced).
