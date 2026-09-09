# Streak Companion (Windows & Linux)

A native desktop app that is both a **client** and a **backup** for Streak.
Day to day it looks exactly like the web app in its own window. Underneath, it
runs a full copy of the Streak stack on this machine and keeps it in sync with
your host, so if your home wifi or power dies, this machine — and every phone
or browser pointed at the failover chain — keeps working, and everything
merges back when the host returns.

It ships for **Windows 10/11** (installer + portable `.exe`) and **Linux**
(`.deb` for Ubuntu / Debian / Linux Mint, plus an AppImage for anything else).
The two builds are the same code; only the Docker install differs.

## What you need

Both platforms need three things: **Docker** (the stack runs in it), **Git**
(installs and updates come straight from GitHub) and
**[Tailscale](https://tailscale.com/download)** logged into the same tailnet
as your host (needed for syncing from outside your LAN, and for serving web
clients via Funnel).

### Windows

- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (free
  for personal use). See the answers to its installer questions below.
- **[Git for Windows](https://git-scm.com/download/win)**

The Docker Desktop installer asks three things. For Streak:

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

### Linux (Ubuntu / Debian / Linux Mint)

Use **Docker Engine** from Docker's own apt repository — not Docker Desktop
for Linux, and not the Snap. Engine is a plain system service: it starts at
boot before anyone logs in, and every Streak container is `restart:
unless-stopped`, so a backup node comes back from a power cut on its own
with no auto-login tricks. The recipe below works unchanged on Ubuntu,
Debian and Mint (Mint has no repo of its own; it uses the Ubuntu one for the
release it is based on, which is what the `UBUNTU_CODENAME` line handles —
LMDE falls through to Debian's):

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release
if [ -n "$UBUNTU_CODENAME" ]; then DIST=ubuntu; CODENAME=$UBUNTU_CODENAME
else DIST=debian; CODENAME=${DEBIAN_CODENAME:-$VERSION_CODENAME}; fi
sudo curl -fsSL "https://download.docker.com/linux/$DIST/gpg" -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$DIST $CODENAME stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"     # lets the companion talk to Docker without sudo
```

**Log out and back in** after the last line (group changes only apply to
new sessions), then check with `docker compose version` — it should print a
`v2.x` version. Ubuntu 24.04+ / Mint 22+ also work with the distro packages
(`sudo apt install docker.io docker-compose-v2 git`), but older releases
ship compose v1 (`docker-compose` with a hyphen), which the companion does
not use.

Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh` then
`sudo tailscale up`. To serve web clients from this node later:
`sudo tailscale funnel --bg 3000`.

For a machine that is supposed to be the backup, the one BIOS/UEFI setting
that matters is still power restore → **power on**. Nothing else is needed:
Docker brings the stack up at boot, and the companion (tray icon, daily
update check) can be added to your login autostart from its Settings.

## Getting the app

**From a GitHub Release** — download from this repo's **Releases** page:

| Platform | File | Install |
| --- | --- | --- |
| Windows | `Streak Companion Setup <version>.exe` | run it (or use the portable `.exe` without installing) |
| Ubuntu / Debian / Mint | `streak-companion-<version>-amd64.deb` | `sudo apt install ./streak-companion-<version>-amd64.deb` — then find **Streak Companion** in the app menu, or run `streak-companion` |
| Other Linux | `streak-companion-<version>-x86_64.AppImage` | `chmod +x` and run it (see *Linux notes* for the Ubuntu 24.04 sandbox caveat) |

If Releases is empty, no version has been tagged yet; use either option below.

**Build it on GitHub without a Windows or Linux machine** — the repo has a
workflow that builds every installer on GitHub's own runners. Go to the repo's
**Actions** tab → **Build Streak Companion** → **Run workflow**. When it
finishes, download the `streak-companion-windows` or
`streak-companion-linux` artifact from that run. To turn that into a proper
Release instead, push a tag:

```bash
git tag companion-v1.1.0 && git push origin companion-v1.1.0
```

**Run it from source** — with [Node.js 20+](https://nodejs.org/) on the
machine itself:

```powershell
# Windows
git clone https://github.com/Glorb456/Streak_app.git C:\Streak
cd C:\Streak\companion
npm install
npm start            # runs the companion
npm run dist:win     # or: build the installer here, output in dist\
```

```bash
# Linux
git clone https://github.com/Glorb456/Streak_app.git ~/Streak
cd ~/Streak/companion
npm install
npm start            # runs the companion
npm run dist:linux   # or: build the .deb + AppImage here, output in dist/
```

(Point the companion's *Install folder* at that same clone if you run from
source; it will just `git pull` in place.)

## Set it up

1. Launch the companion. The Settings window opens on first launch:
   - **Role**: `Backup` (the usual choice — your main machine is the host).
   - **Repository URL**: pre-filled with this repo; change it only for a fork.
   - **Install folder**: pre-filled with `C:\Streak` on Windows and
     `~/Streak` on Linux.
   - **Sync token**: the same `SYNC_TOKEN` your host uses (see the main
     README's *Backups & buddy backup* section — one `openssl rand -hex 32`
     secret shared by all of your machines).
   - **Host URL**: the host's Tailscale IP + port, e.g. `http://100.x.y.z:3000`
     (best — works even when the host's Funnel is down), or its Funnel URL.
   - Linux only: **Start the companion when I log in** adds an entry under
     `~/.config/autostart` that launches it into the tray with `--hidden`.
   The status line at the top tells you if Docker isn't usable yet and what
   to do about it (not installed, daemon stopped, not in the `docker` group,
   compose plugin missing).
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

## Linux notes

- **Tray icon.** Cinnamon, MATE, XFCE and KDE show it out of the box. GNOME
  needs the AppIndicator extension: Ubuntu ships it enabled, stock Debian
  GNOME does not (`sudo apt install gnome-shell-extension-appindicator`,
  then enable it). Without a tray, everything is still reachable from the
  **Companion** menu in the app window — press **Alt** to reveal the menu bar
  — and launching the companion again from the app grid just raises the
  existing window (it's single-instance).
- **Closing the window** leaves the companion running in the tray and the
  stack serving other devices, exactly like on Windows. **Quit** is in the
  tray/Companion menu. Stopping the companion does *not* stop the stack —
  Docker keeps it up; use **Stop stack** if you really want it down.
- **AppImage on Ubuntu 24.04+.** Ubuntu restricts unprivileged user
  namespaces, which breaks Chromium's sandbox inside AppImages ("The SUID
  sandbox helper binary was found, but is not configured correctly"). Prefer
  the `.deb` — its install step sets up the sandbox helper correctly. If you
  must use the AppImage, run it with `--no-sandbox`.
- **Where things live.** Config: `~/.config/streak-companion/config.json`.
  The stack: whatever *Install folder* you chose (`~/Streak` by default), a
  normal git checkout with a normal `.env` — `docker compose` commands there
  work the same as on any hand-managed node. Autostart entry:
  `~/.config/autostart/streak-companion.desktop`. Package files:
  `/opt/Streak Companion/` with a `streak-companion` launcher on `PATH`.
- **Docker "permission denied".** You're not in the `docker` group yet, or
  haven't logged out since being added. `sudo usermod -aG docker $USER`, log
  out and back in, and re-open the companion's Settings to re-check.

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
2. Expose it: `tailscale funnel --bg --https=8443 3100` (`sudo` on Linux; the
   mirror serves on port 3100; 8443 keeps your own Funnel URLs free).
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
git tag companion-v1.2.0 && git push origin companion-v1.2.0
```

GitHub builds the Windows installer and the Linux `.deb` + AppImage and
publishes all of them to one Release (see
`.github/workflows/companion-release.yml`). Bump `version` in
`companion/package.json` to match the tag first — that number ends up in the
installers' filenames, in Add/Remove Programs and in `dpkg -l`.
