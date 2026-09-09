# Streak
NOTE THIS IS NOT A CODING PROJECT. THE MAJORITY OF THE CODE IS AI GENERATED.

Self-hosted productivity app: a Notion-style task calendar with daily-task
streak tracking. Runs entirely in the browser against a local FastAPI +
PostgreSQL backend, all in Docker.

## Run

```bash
cd streak_app
docker compose up -d --build
```

Open http://localhost:3000 (or `http://<server-ip>:3000` from other devices
on your wifi). Ports were chosen to avoid the Nextcloud (8080) and ARK
containers; Postgres and the API are not exposed outside the compose network.

## Architecture

```
frontend/   React (Vite) SPA, served by nginx which proxies /api -> backend
backend/    FastAPI; every query and schema init is an individual .sql file
            in backend/app/sql/ (init/ runs at startup, queries/ loaded by name)
db          PostgreSQL 16, data in the streak_pgdata volume
notes/      Streak Notes — a second, independent app (see notes/README.md)
```

- **Sync**: the app loads everything once, the blue Sync button re-fetches,
  and it auto-refreshes every 5 s. When the browser is offline the Sync
  button greys out and auto-refresh pauses.
- **Daily tasks**: up to 5 pastel cards at the top of the page, showing only
  the ones scheduled for that weekday; past days are tinted green when every
  task due that day was completed, and progressively redder the more were
  missed. A day with nothing scheduled is left untinted and carries the streak
  through rather than breaking it.
- **Task order**: new tasks land at the top of their day, and a day can be
  reordered by hand — drag the ☰ handle at the right of a row on mobile, or
  drag the card itself on the desktop calendar (there is no handle there). The
  order is stored per day and shared between devices. Whichever task is first
  **today** is tinted `#00c0ab`; the tint follows the top of the list, so it
  moves as soon as a drag, a delete or a new task changes which task that is.
- **Tasks**: double-click empty space in a day to create a task (opens on the
  Category tab); double-click an existing task to edit it (opens on the
  Calendar tab with the due date highlighted dark red). On a desktop-width
  window the task popup is two columns — notes on the left, category grid and
  calendar both on the right at once. Below 820px it falls back to one column
  where the two pickers share a tab row and clicking into the notes expands
  them over the picker. Either way the first click outside collapses the notes
  and the second closes the task.
- **Hide done**: the toggle beside Sync hides completed tasks from the calendar
  and the mobile day list. The choice is stored server-side, so it follows you
  between the desktop and the phone.
- **Settings** (profile picture, top right): category colors, daily tasks +
  colors + which weekdays each one runs on, background color. Turning every day
  off parks a daily task without deleting it. **Launch Streak notes** at the
  bottom of that menu switches apps.

## Sticky notes

A draggable sticky-note icon floats over the task app — bottom right by
default, and it remembers where you drag it (per device). Tapping it opens a pad
in the shape of the pre-iOS 7 Notes app: leather bar, ruled yellow paper,
handwriting, a Notes list behind the back button and `+` for a new note. The
bottom toolbar keeps two of the original four buttons — make the current line a
checkbox (the same checklist as a task's notes) and delete — since the list
replaces the arrows and there is nothing to mail.

The notes are stored in **Streak Notes**, in its app-owned `Sticky Notes`
section, as ordinary markdown; a note's title is its first line. That section
cannot be deleted or renamed and holds nothing but sticky notes. The icon is
deliberately not shown inside Streak Notes, which is already a notes app.

## Streak Notes

A separate OneNote-style notebook app at `/notes/`, with its own API and no
database — every page is a real `.md` file under `notes/notebook/`. It is served
through the same nginx as the task app, so the one oauth2-proxy cookie
authorises both and switching between them never asks for a second login.

Hand-drawn pages are a vector canvas built for an Apple Pencil in Safari:
pressure-tapered strokes, five configurable pencils, a lasso, object and pixel
erasers, and inserted images. Strokes are stored in a packed vector format and
merged per element across devices, so the same page is safe to edit from the
iPad and the desktop at once.

Get there from **Settings → Launch Streak notes**, and back from the gear icon
in the notes top right → **Launch Streak**. Full details in
[notes/README.md](notes/README.md).

## Install on iOS / iPadOS

Open the **Tailscale Funnel URL** (not `:3000` — the LAN path skips auth, so an
install made from it only works at home) and use Share → Add to Home Screen.
The app then launches without Safari chrome, edge to edge under the notch.

Two things to expect, both inherent to auth-proxied web apps rather than bugs:

- A home-screen app has its own cookie jar, separate from Safari, so the first
  launch after installing asks for the Google login once. Sessions last 30 days
  (`--cookie-expire=720h`, refresh deliberately off while the OAuth app is in
  Google "Testing" status), so expect roughly monthly re-logins inside the app.
- The login hop leaves the app's scope for `accounts.google.com`. iOS 16.4+
  handles this in an in-app browser and returns on the callback; older iOS can
  strand the session in Safari. If that happens, log in once in Safari at the
  Funnel URL and re-add to the home screen.

Icons are generated from `frontend/public/streak.png` and committed, so the
build is a plain copy. Regenerate them after changing that file:

```bash
python3 frontend/scripts/make_icons.py
```

There is one deliberately tiny service worker (`frontend/public/sw.js`) that
caches only the app shell, never touches `/api`, `/oauth2` or `/notes`, and
answers only when the network can't. It exists so the installed app can still
*open* while its origin is down and walk the failover chain (below); online
behaviour — the 5 s poll and oauth2-proxy's redirects included — is untouched.

## Backups, failover & buddy backup

Streak is multi-node: every machine runs this same stack, and a `.env` file
decides its role (see `.env.example`). If the host's wifi or power dies,
nothing is lost and nothing stops working.

```
web clients try, in order, and stop at the first one that answers:
  host  ->  backup(s)  ->  buddy mirror
   |            |               |
   |  <--- 2-way sync, ~30s --->|          backups: your other machines
   |  <------- 2-way sync, ~10min -------> mirror: a friend's machine
```

- **Roles.** One *host* (the hub; what you run today), any number of
  *backups* (your other machines; full read-write copies syncing every ~30 s),
  and optionally one *mirror* on a buddy's machine (slow refresh, last
  resort). Rows travel by globally-unique `uid`, merge is last-writer-wins on
  `updated_at`, deletes carry tombstones, and the notes notebook syncs
  file-by-file with the same rules. Machine-to-machine calls use a pre-shared
  `SYNC_TOKEN` (`/api/sync/peer/*` — the only routes oauth2-proxy skips);
  humans still sign in with Google exactly as before, on every node.

- **Failover.** Inside the app: **Settings → Backups & failover**, one URL
  per line, most-preferred first. Every device caches the chain and, when its
  current node stops answering, walks it top-down and stops at the first live
  node — while the host is up, backups and the mirror are never even probed.
  When the host recovers, clients return to it the next time they open.

- **Offline edits & conflicts.** A backup keeps accepting writes while the
  host is down and pushes them back when it returns. If the same item was
  edited on both sides while apart, the newer edit wins immediately and a ⚠
  badge appears in the top bar — a bare-bones list where either version can
  be kept or restored.

- **Windows and Linux machines** (Ubuntu / Debian / Mint) run all of this
  through the native [Streak Companion](companion/README.md) app: installs
  the stack from GitHub, keeps it updated (`git pull` + rebuild, daily or on
  demand), shows the app in its own window, and sets up buddy mirrors by
  pasting two files. Ships as a Windows installer and a `.deb` / AppImage.

- **Buddy backup.** A friend hosts a mirror of your Streak (and you can host
  theirs): a fully separate stack (`docker-compose.mirror.yml`) on their
  machine that only *your* Google account can log into — their email simply
  isn't on the mirror's allowlist. You hand them `.env.mirror` +
  `mirror-emails.txt` (from `.env.mirror.example`); they run it and Funnel it
  (`tailscale funnel --bg --https=8443 3100`). It mirrors only from your
  *host*, never from your backups, and web clients only reach it when
  everything above it in the chain is dead. If neither of you wants the
  other's data readable at rest, use encrypted snapshots instead
  (`BUDDY_BLOB_*` in `.env.example`): the buddy stores AES-256-GCM blobs they
  can't decrypt, and `scripts/restore_blob.py` brings a fresh stack back from
  one.

Quick host setup for sync: copy `.env.example` to `.env`, set
`SYNC_ROLE=host` and a `SYNC_TOKEN` (`openssl rand -hex 32`), then
`docker compose up -d`. Give the same token to your backups/companion, and
add each machine's Funnel URL to the failover chain in Settings.

## Future-proofing

- `projects` table + `tasks.project_id` already exist for grouping multiple
  tasks under one category/project.
- All state lives behind the JSON API, so native apps can reuse the backend
  unchanged — the Windows/Linux companion already does; iOS/iPadOS could too.

## Dev without Docker

```bash
# backend (needs a local postgres and DATABASE_URL set)
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload

# frontend (proxies /api to localhost:8000)
cd frontend && npm install && npm run dev
```
