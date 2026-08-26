// Failover: walk the configured origin chain (host -> backups -> buddy
// mirror) and land on the FIRST reachable one. The walk is strictly in order
// and stops at the first success, so while the host answers, no backup or
// mirror is ever even probed.
//
// The chain itself is a setting (failover_origins, a JSON array), so it syncs
// to every node like any other setting; it is cached in localStorage because
// the one moment it is needed is exactly the moment the server that would
// serve it is down. The page itself survives that moment via the service
// worker's shell cache (see public/sw.js).

const KEY = 'streak_failover_origins'

export function rememberFailover(settings) {
  try {
    const list = JSON.parse(settings.failover_origins || '[]')
    if (Array.isArray(list)) localStorage.setItem(KEY, JSON.stringify(list))
  } catch { /* a malformed setting must never break the app */ }
}

export function failoverList() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list.filter((o) => typeof o === 'string' && o) : []
  } catch {
    return []
  }
}

const strip = (o) => o.replace(/\/+$/, '')

// Cross-origin reachability probe. no-cors on purpose: a funnel answers /api
// without a session cookie with a 401 that carries no CORS headers, and a
// plain fetch would report that live server as unreachable. An opaque
// response proves the machine answered, which is all the chain needs —
// logging in happens after the redirect, through oauth2-proxy as usual.
function reachable(origin, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { ctrl.abort(); resolve(false) }, timeoutMs)
    const ctrl = new AbortController()
    fetch(`${origin}/api/health`, { mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' })
      .then(() => { clearTimeout(t); resolve(true) })
      .catch(() => { clearTimeout(t); resolve(false) })
  })
}

// Same-origin probe can read the real answer.
async function selfHealthy(timeoutMs = 4000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    // 401 means oauth2-proxy is alive and wants a login — the node is up.
    return res.ok || res.status === 401
  } catch {
    return false
  }
}

async function walkChain({ skipSelf }) {
  const here = strip(window.location.origin)
  for (const raw of failoverList()) {
    const origin = strip(raw)
    if (origin === here) {
      if (skipSelf) continue
      if (await selfHealthy()) return // already on the best available node
      continue
    }
    if (await reachable(origin)) {
      window.location.replace(origin + window.location.pathname + window.location.search)
      return
    }
  }
}

// On boot: if a better (earlier-in-chain) node than the current origin is
// alive, go there; if the current origin's API is dead, fail down the chain.
export function ensureBestOrigin() {
  if (failoverList().length === 0) return
  walkChain({ skipSelf: false }).catch(() => {})
}

// Mid-session: the poll started failing. Confirm it's really this node (not
// the phone's wifi), then fail over. Throttled so a flap can't redirect-storm.
let lastAttempt = 0
export async function failoverOnError() {
  if (!navigator.onLine || failoverList().length === 0) return
  const now = Date.now()
  if (now - lastAttempt < 30000) return
  lastAttempt = now
  if (await selfHealthy()) return
  walkChain({ skipSelf: true }).catch(() => {})
}
