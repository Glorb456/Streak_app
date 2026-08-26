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
  for personal use) — the stack runs in it. See the answers to its installer
  questions below.
- **[Git for Windows](https://git-scm.com/download/win)** — installs and
  updates come straight from GitHub
- **[Tailscale](https://tailscale.com/download)** logged into the same
  tailnet as your host (needed for syncing from outside your LAN, and for
  serving web clients via Funnel)

### Installing Docker Desktop

The installer asks three things. For Streak:

| Question | Answer | Why |
| --- | --- | --- |
| Use WSL 2 instead of Hyper-V | **Yes, WSL 2** | Faster, uses less RAM, and works on Windows Home. Hyper-V is the legacy backend and needs Pro/Enterprise. |
| Windows containers | **Leave unchecked** | Every Streak image (Postgres, Python, nginx) is a Linux container. Windows containers can't run them. |
| Per-user or all-users install | **All users**, if offered the choice | Nothing in Streak needs it, but a system-wide install keeps working if you ever add a second Windows account, and it's the better-trodden path. Per-user is fine if you'd rather not enter an admin password. |

If WSL 2 isn't set up yet, Docker will prompt you — accept, and run
`wsl --install` from an admin PowerShell if it asks. Virtualization must be
enabled in the BIOS/UEFI (it usually already is).

**Then, because this machine is a backup, make sure it comes back by itself
after a power cut** — otherwise it's offline exactly when you need it:

1. Docker Desktop → Settings → General → tick **Start Docker Desktop when
   you sign in**.
2. Windows: set the machine to sign in automatically (`netplwiz`, untick
   "Users must enter a user name and password"). Docker Desktop only runs
   while a user is signed in, so without this a reboot leaves the stack down.
3. In the BIOS/UEFI, set power restore behaviour to **power on** (often
   "Restore on AC Power Loss").

## Getting the app

**From a GitHub Release** — download `Streak Companion Setup <version>.exe`
from this repo's **Releases** page and run it. If Releases is empty, no
version has been tagged yet; use either option below.

**Build it from GitHub without a Windows machine** — the repo has a workflow
that builds the installer on GitHub's own Windows runners. Go to the repo's
**Actions** tab → **Build Streak Companion (Windows)** → **Run workflow**.
When it finishes, download the `streak-companion-windows` artifact from that
run; the `.exe` is inside. To turn that into a proper Release instead, push a
tag:

```bash
git tag companion-v1.0.0 && git push origin companion-v1.0.0
```

**Run it from source** — on the Windows machine itself, with
[Node.js 20+](https://nodejs.org/):

```powershell
git clone https://github.com/Glorb456/Streak_app.git C:\Streak
cd C:\Streak\companion
npm install
npm start          # runs the companion
npm run dist       # or: build the installer here, output in dist\
```

## Set it up

1. Launch the companion. The Settings window opens on first launch:
   - **Role**: `Backup` (the usual choice — your main machine is the host).
   - **Repository URL**: pre-filled with this repo; change it only for a fork.
   - **Install folder**: e.g. `C:\Streak`.
   - **Sync token**: the same `SYNC_TOKEN` your host uses (see the main
     README's *Backups & buddy backup* section — one `openssl rand -hex 32`
     secret shared by all of your machines).
   - **Host URL**: the host's Tailscale IP + port, e.g. `http://100.x.y.z:3000`
     (best — works even when the host's Funnel is down), or its Funnel URL.
2. Click **Install / Update & Start**. First build takes a few minutes.
3. Click **Open Streak** — you're looking at the local copy, which is already
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

## Cutting a new companion release

The companion itself rarely needs updating — it only clones, updates and
launches the stack, and everything else ships through `git pull`. When it
does change:

```bash
git tag companion-v1.1.0 && git push origin companion-v1.1.0
```

GitHub builds the installer and publishes it to Releases (see
`.github/workflows/companion-release.yml`). Bump `version` in
`companion/package.json` to match the tag first — that number ends up in the
installer's filename and in Add/Remove Programs.
