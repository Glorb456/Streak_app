// The service worker's app-shell cache, seen from the page.
//
// public/sw.js leaves a timestamped marker in the cache whenever it answers a
// navigation from that cache instead of the network — the one case where the
// page you are looking at did not come from the server at all. The flag is
// read once at boot and consumed, so it can only ever describe this load.

const CACHE = 'streak-shell-v1'
const MARK = '/__served-from-cache'

export async function servedFromCache() {
  if (!('caches' in window)) return false
  try {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(MARK)
    if (!hit) return false
    await cache.delete(MARK)
    const at = Number(await hit.text())
    // A marker left by an earlier boot that never got read must not brand a
    // healthy session as cached; the sw writes it moments before this load.
    return Number.isFinite(at) && Date.now() - at < 60000
  } catch {
    return false
  }
}

// Throw the shell away and reload. Used by the "newer build" prompt: a stale
// cached shell is exactly what pins a tab to an old bundle, and the cache
// refills itself on the next successful load.
export async function reloadFromServer() {
  try { await caches.delete(CACHE) } catch { /* nothing to clear */ }
  window.location.reload()
}
