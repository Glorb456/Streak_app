// App-shell cache, and nothing more. This exists for exactly one scenario:
// the origin this PWA was installed from is unreachable (host machine off),
// and the app must still *open* so failover.js can walk the chain and
// redirect to a live backup. Everything the old README warned a service
// worker would fight is excluded up front:
//
//   - /api and /notes are never touched, so the 5s poll and both backends
//     always hit the network,
//   - /oauth2 is never touched, and redirect responses are passed through
//     uncached, so login flows behave exactly as before,
//   - only same-origin GETs are considered at all.
//
// Strategy is network-first: online behaviour is byte-for-byte what the
// server serves; the cache only ever answers when the network cannot.

const CACHE = 'streak-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  const p = url.pathname
  if (p.startsWith('/api') || p.startsWith('/oauth2') || p.startsWith('/notes')) return
  e.respondWith(networkFirst(e.request))
})

async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    // Only clean same-origin 200s are cached: a 302 to Google (opaqueredirect,
    // status 0) or an error page must never become the offline shell.
    if (res.ok && res.type === 'basic') cache.put(req, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(req)
    if (hit) return hit
    if (req.mode === 'navigate') {
      // Any navigation falls back to the cached shell; the SPA and
      // failover.js take it from there.
      const shell = await cache.match('/')
      if (shell) return shell
    }
    throw err
  }
}
