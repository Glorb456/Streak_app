// What the sync menu says about this tab's connection. Pure on purpose: the
// state machine is the part worth testing, and everything that touches the
// network or the service worker lives in SyncMenu.jsx / shellcache.js.

// Ordered worst-first — the first rule that matches wins.
//   online      navigator.onLine
//   fromCache   the service worker served this page out of its shell cache,
//               i.e. the server was already unreachable at load
//   lastSyncAt  ms of the last successful poll, null if none ever landed
//   error       message from the last failed poll, null once one succeeds
export function connState({ online, fromCache, lastSyncAt, error }) {
  if (!online) return 'offline'
  if (error && fromCache) return 'cached'
  if (error) return lastSyncAt ? 'stale' : 'down'
  if (!lastSyncAt) return 'connecting'
  return 'ok'
}

export const STATES = {
  ok: {
    tone: 'ok',
    title: 'Synced',
    detail: 'This tab is talking to the server and refreshing every 5 seconds.',
  },
  connecting: {
    tone: 'ok',
    title: 'Connecting…',
    detail: 'Waiting for the first answer from the server.',
  },
  stale: {
    tone: 'warn',
    title: 'Unable to fetch new data',
    detail: 'The server stopped answering. Everything on screen is the last data this tab loaded; it keeps retrying every 5 seconds.',
  },
  down: {
    tone: 'down',
    title: 'Unable to connect',
    detail: 'Nothing has loaded from the server in this tab yet.',
  },
  cached: {
    tone: 'down',
    title: 'Cached by browser, unable to connect',
    detail: 'This page came out of the browser’s offline copy and the server has not answered since, so what you see may be out of date.',
  },
  offline: {
    tone: 'offline',
    title: 'Offline',
    detail: 'This device reports no network connection.',
  },
}

export function ago(then, now = Date.now()) {
  if (!then) return 'never'
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

// The hashed entry bundle a built index.html points at. Comparing it with the
// bundle this tab is running is how the menu notices that the server has been
// redeployed since the page loaded — the trap that makes a freshly rebuilt
// container look like it changed nothing at all.
export function entryAsset(html) {
  const m = /src="([^"]*\/assets\/index-[^"]+\.js)"/.exec(html || '')
  return m ? m[1] : null
}

// Hostname only: a full funnel URL is too long for a status row.
export function shortHost(url) {
  try { return new URL(url).host } catch { return url }
}
