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

There is no service worker, deliberately — Add to Home Screen doesn't need one,
and it would fight both the 5 s poll and oauth2-proxy's redirects.

## Future-proofing

- `projects` table + `tasks.project_id` already exist for grouping multiple
  tasks under one category/project.
- All state lives behind the JSON API, so native Windows/iOS/iPadOS/Linux
  apps can reuse the backend unchanged.

## Dev without Docker

```bash
# backend (needs a local postgres and DATABASE_URL set)
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload

# frontend (proxies /api to localhost:8000)
cd frontend && npm install && npm run dev
```
