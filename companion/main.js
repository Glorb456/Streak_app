// Streak Companion: a thin native shell around the real app.
//
// The heavy lifting — API, database, notes, sync engine — is the same Docker
// stack every Streak node runs; this process only (1) installs/updates that
// stack from GitHub, (2) starts and stops it, (3) shows the web app in a
// native window, and (4) puts status + controls in the tray. Keeping the
// companion this thin is deliberate: the app is developed fast, and every
// feature lands in the stack (one `git pull` away) rather than needing a new
// companion release.
//
// Logging in happens inside the window exactly like in a browser: the first
// visit to the Funnel URL bounces through Google, and Electron keeps the
// oauth2-proxy cookie in its own session. The local stack at localhost:3000
// needs no login at all (same as visiting it on the LAN).
const {
  app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell, nativeImage,
} = require('electron')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const REPO_URL = 'https://github.com/YOURUSER/streak.git' // set on first run in Settings
const LOCAL_URL = 'http://localhost:3000'

const configPath = () => path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { return {} }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

// ------------------------------------------------------------- processes

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err ? err.code : 0, stdout, stderr }))
  })
}

const dockerCompose = (cfg, args, extra = {}) =>
  run('docker', ['compose', ...args], { cwd: cfg.repoDir, ...extra })

async function haveTools() {
  const docker = await run('docker', ['--version'])
  const git = await run('git', ['--version'])
  return { docker: docker.ok, git: git.ok }
}

// --------------------------------------------------------------- actions

async function installOrUpdate(cfg, log) {
  const exists = fs.existsSync(path.join(cfg.repoDir, 'docker-compose.yml'))
  if (!exists) {
    log(`Cloning ${cfg.repoUrl} into ${cfg.repoDir}…`)
    fs.mkdirSync(cfg.repoDir, { recursive: true })
    const r = await run('git', ['clone', cfg.repoUrl, cfg.repoDir])
    if (!r.ok) return { ok: false, message: `git clone failed:\n${r.stderr}` }
  } else {
    log('Pulling latest from GitHub…')
    const r = await run('git', ['pull', '--ff-only'], { cwd: cfg.repoDir })
    if (!r.ok) return { ok: false, message: `git pull failed:\n${r.stderr}` }
    if (/Already up to date/i.test(r.stdout) && cfg.installed) {
      log('Already up to date.')
    }
  }
  writeEnv(cfg)
  log('Building + starting the stack (first time can take a few minutes)…')
  const up = await dockerCompose(cfg, ['up', '-d', '--build'])
  if (!up.ok) return { ok: false, message: `docker compose up failed:\n${up.stderr}` }
  cfg.installed = true
  saveConfig(cfg)
  log('Stack is up.')
  return { ok: true, message: 'Stack is up.' }
}

// The stack reads its role from .env — same file a hand-managed node uses,
// so nothing about a companion-managed machine is special.
function writeEnv(cfg) {
  const lines = [
    '# Written by Streak Companion (Settings edits will overwrite this file).',
    cfg.role ? `SYNC_ROLE=${cfg.role}` : '',
    cfg.token ? `SYNC_TOKEN=${cfg.token}` : '',
    cfg.role === 'backup' && cfg.upstream ? `SYNC_UPSTREAM=${cfg.upstream}` : '',
    cfg.interval ? `SYNC_INTERVAL=${cfg.interval}` : '',
    cfg.redirectUrl ? `OAUTH_REDIRECT_URL=${cfg.redirectUrl}` : '',
  ].filter(Boolean)
  fs.writeFileSync(path.join(cfg.repoDir, '.env'), lines.join('\n') + '\n')
}

async function writeMirrorFiles(cfg, envText, emailsText) {
  fs.writeFileSync(path.join(cfg.repoDir, '.env.mirror'), envText)
  fs.writeFileSync(path.join(cfg.repoDir, 'mirror-emails.txt'), emailsText)
}

async function stackStatus(cfg) {
  if (!cfg.repoDir || !fs.existsSync(cfg.repoDir)) return 'not installed'
  const r = await dockerCompose(cfg, ['ps', '--format', 'json'])
  if (!r.ok) return 'docker unavailable'
  const lines = r.stdout.trim().split('\n').filter(Boolean)
  const running = lines.filter((l) => { try { return JSON.parse(l).State === 'running' } catch { return false } })
  if (running.length === 0) return 'stopped'
  return `running (${running.length} containers)`
}

// ------------------------------------------------------------------ UI

let tray = null
let win = null
let setupWin = null

function openApp() {
  const cfg = loadConfig()
  const url = cfg.installed ? LOCAL_URL : (cfg.upstream || LOCAL_URL)
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return }
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Streak',
    icon: path.join(__dirname, 'assets', 'streak.png'),
    autoHideMenuBar: true,
  })
  win.loadURL(url)
  // The failover chain lives in the web app itself; if the local stack is
  // somehow dead the page's own chain-walk redirects, so the shell needs no
  // failover logic of its own.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    // Google's login must stay inside the window (cookie jar); anything else
    // (external links in notes) goes to the default browser.
    if (/accounts\.google\.com|oauth2/.test(u)) return { action: 'allow' }
    shell.openExternal(u)
    return { action: 'deny' }
  })
}

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return }
  setupWin = new BrowserWindow({
    width: 720,
    height: 820,
    title: 'Streak Companion — Settings',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  setupWin.loadFile('setup.html')
}

async function refreshTray() {
  if (!tray) return
  const cfg = loadConfig()
  const status = await stackStatus(cfg)
  tray.setToolTip(`Streak Companion — ${status}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Stack: ${status}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Streak', click: openApp },
    { label: 'Settings…', click: openSetup },
    { type: 'separator' },
    {
      label: 'Sync now',
      click: async () => {
        try { await fetch(`${LOCAL_URL}/api/sync/now`, { method: 'POST' }) } catch { }
      },
    },
    {
      label: 'Check for updates (git pull + rebuild)',
      click: async () => {
        const c = loadConfig()
        const r = await installOrUpdate(c, () => { })
        dialog.showMessageBox({ message: r.message })
        refreshTray()
      },
    },
    { type: 'separator' },
    {
      label: 'Start stack',
      click: async () => { await dockerCompose(loadConfig(), ['up', '-d']); refreshTray() },
    },
    {
      label: 'Stop stack',
      click: async () => { await dockerCompose(loadConfig(), ['down']); refreshTray() },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
}

// ----------------------------------------------------------------- ipc

ipcMain.handle('config:get', () => ({ ...loadConfig(), defaultRepoUrl: REPO_URL }))
ipcMain.handle('config:save', (_e, cfg) => { saveConfig({ ...loadConfig(), ...cfg }); return true })
ipcMain.handle('tools:check', () => haveTools())
ipcMain.handle('stack:status', () => stackStatus(loadConfig()))
ipcMain.handle('stack:install', async (e) => {
  const cfg = loadConfig()
  const log = (m) => e.sender.send('log', m)
  const r = await installOrUpdate(cfg, log)
  refreshTray()
  return r
})
ipcMain.handle('stack:start', async () => { const r = await dockerCompose(loadConfig(), ['up', '-d']); refreshTray(); return r })
ipcMain.handle('stack:stop', async () => { const r = await dockerCompose(loadConfig(), ['down']); refreshTray(); return r })
ipcMain.handle('mirror:install', async (e, { envText, emailsText }) => {
  const cfg = loadConfig()
  const log = (m) => e.sender.send('log', m)
  if (!cfg.installed) return { ok: false, message: 'Install the main stack first.' }
  await writeMirrorFiles(cfg, envText, emailsText)
  log('Building + starting the buddy mirror stack…')
  const r = await dockerCompose(cfg, [
    '-f', 'docker-compose.mirror.yml', '--env-file', '.env.mirror', 'up', '-d', '--build',
  ])
  return r.ok ? { ok: true, message: 'Mirror stack is up on port 3100.' }
    : { ok: false, message: `mirror compose failed:\n${r.stderr}` }
})
ipcMain.handle('open:app', () => openApp())
ipcMain.handle('pick:dir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

// -------------------------------------------------------------- startup

app.whenReady().then(async () => {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')))
  await refreshTray()
  setInterval(refreshTray, 60_000)

  const cfg = loadConfig()
  if (!cfg.installed) openSetup()
  else {
    // Bring the stack up (no-op if already running) and open the app.
    dockerCompose(cfg, ['up', '-d']).then(refreshTray)
    openApp()
  }

  // Daily auto-update: git pull + rebuild, only when it actually changed.
  setInterval(async () => {
    const c = loadConfig()
    if (!c.installed || c.autoUpdate === false) return
    await run('git', ['fetch'], { cwd: c.repoDir })
    const behind = await run('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: c.repoDir })
    if (behind.ok && parseInt(behind.stdout.trim(), 10) > 0) {
      await installOrUpdate(c, () => { })
      refreshTray()
    }
  }, 24 * 3600 * 1000)
})

// Tray app: closing windows must not quit; the stack keeps serving other
// devices (that is the whole point of a backup node).
app.on('window-all-closed', (e) => e.preventDefault?.())
