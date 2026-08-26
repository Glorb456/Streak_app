# Streak Companion (Windows)

A native Windows app that is both a **client** and a **backup** for Streak.
Day to day it looks exactly like the web app in its own window. Underneath, it
runs a full copy of the Streak stack on this machine and keeps it in sync with
your host, so if your home wifi or power dies, this machine — and every phone
or browser pointed at the failover chain — keeps working, and everything
merges back when the host returns.

## What you need

- **Windows 10/11**
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (free
  for personal use) — the stack runs in it
- **[Git for Windows](https://git-scm.com/download/win)** — installs and
  updates come straight from GitHub
- **[Tailscale](https://tailscale.com/download)** logged into the same
  tailnet as your host (needed for syncing from outside your LAN, and for
  serving web clients via Funnel)

## Install

1. Download the latest `Streak Companion Setup.exe` from this repo's
   **GitHub Releases** page and run it (or build it yourself: see below).
2. The Settings window opens on first launch:
   - **Role**: `Backup` (the usual choice — your main machine is the host).
   - **Repository URL**: this repo's URL.
   - **Install folder**: e.g. `C:\Streak`.
   - **Sync token**: the same `SYNC_TOKEN` your host uses (see the main
     README's *Backups & buddy backup* section — one `openssl rand -hex 32`
     secret shared by all of your machines).
   - **Host URL**: the host's Tailscale IP + port, e.g. `http://100.x.y.z:3000`
     (best — works even when the host's Funnel is down), or its Funnel URL.
3. Click **Install / Update & Start**. First build takes a few minutes.
4. Click **Open Streak** — you're looking at the local copy, which is already
   pulling everything (tasks *and* notes) from the host and syncing every
   ~30 seconds.

Google login: the local window needs no login (same as the LAN path at home).
If you expose this machine with `tailscale funnel 3000`, visitors go through
the same Google sign-in as the host — set this machine's callback URL in
Settings and add it to your Google OAuth client's authorized redirect URIs.

## Being the backup when the host dies

Nothing to do — that's the point:

- The companion's window keeps reading and writing its local database.
- Phones/browsers using the failover chain (set inside Streak under
  **Settings → Backups & failover**) automatically land on this machine's
  Funnel URL, because the host stopped answering and this node is next in the
  chain. They stop at the first live node and never probe further down.
- When the host comes back, everything written here is pushed back
  automatically. If the same item was edited in both places while apart, the
  newer edit wins immediately and a **⚠ conflict badge** appears in the top
  bar of the app — click it to keep or restore either version.

## Updating

The app is developed fast; updating a node is `git pull` + rebuild, and the
companion does that for you:

- automatically once a day, and
- on demand: tray icon → **Check for updates (git pull + rebuild)**.

## Hosting a buddy's backup (buddy mirror)

You can host a mirror of a friend's Streak — and they can host yours. The
mirror is a complete, separate copy of the app holding *their* data, running
beside your own stack. **You cannot log into it**: it authenticates against
*their* Google account allowlist, not yours.

As the person **hosting** a buddy's mirror:

1. Get two small files from your buddy: the contents of `.env.mirror` (their
   sync token, their host URL, their OAuth client) and `mirror-emails.txt`
   (their email allowlist). Paste both into the **Buddy mirror** section of
   the companion's Settings and click **Install / Update mirror**.
2. Expose it: `tailscale funnel --bg --https=8443 3100` (the mirror serves on
   port 3100; 8443 keeps your own Funnel URLs free).
3. Tell your buddy the resulting URL — they add it as the *last* entry of
   their failover chain, and to their Google OAuth client's redirect URIs
   (as `https://…:8443/oauth2/callback`).

The mirror refreshes from their host every 10 minutes by default —
deliberately slower than their own backups, since it is the last rung of
their failover ladder — and web clients only ever reach it when everything
above it in the chain is down.

Prefer not to hold a buddy's data readable on your disk (or vice versa)?
Use **encrypted snapshots** instead: the owner sets `BUDDY_BLOB_URL` /
`BUDDY_BLOB_KEY` / `BUDDY_BLOB_TOKEN` on their host (see `.env.example`), and
your machine then just stores opaque AES-256-GCM blobs it can never read.
That mode is pure cold backup — it cannot serve web clients — and restores
with `scripts/restore_blob.py`.

## Building the installer yourself

On a Windows machine with Node.js 20+:

```powershell
cd companion
npm install
npm run dist       # produces dist/ with the NSIS installer + portable exe
```

`npm start` runs it unpackaged for development.
