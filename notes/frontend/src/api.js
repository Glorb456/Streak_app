async function req(path, opts = {}) {
  const res = await fetch(`/api/notes${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  // Same rule as the task app: behind oauth2-proxy an expired session answers
  // /api with 401 rather than a redirect, so reload and let the browser follow
  // the login hop instead of failing quietly forever. Both apps sit behind the
  // one proxy, so this is also what keeps a single session across the two.
  if (res.status === 401) {
    window.location.reload()
    throw new Error(`${opts.method || 'GET'} ${path} -> 401 (session expired)`)
  }
  if (!res.ok) {
    // The store answers with a readable reason (name taken, page too large);
    // surfacing it beats "PUT /pages/x -> 409".
    let detail = ''
    try { detail = (await res.json()).detail } catch { /* no body */ }
    const object = detail && typeof detail === 'object'
    const err = new Error(
      (object ? detail.message : detail) || `${opts.method || 'GET'} ${path} -> ${res.status}`
    )
    err.status = res.status
    // A 409 carries the page as it now stands, so the drawing client can merge
    // against it and retry without a second round trip.
    if (object && detail.current) err.current = detail.current
    throw err
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null
  return res.json()
}

export const api = {
  tree: () => req('/tree'),

  createSection: (name) => req('/sections', { method: 'POST', body: JSON.stringify({ name }) }),
  updateSection: (id, body) => req(`/sections/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSection: (id) => req(`/sections/${id}`, { method: 'DELETE' }),

  createPage: (section_id, title, kind) =>
    req('/pages', { method: 'POST', body: JSON.stringify({ section_id, title, kind }) }),
  page: (id) => req(`/pages/${id}`),
  updatePage: (id, body) => req(`/pages/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePage: (id) => req(`/pages/${id}`, { method: 'DELETE' }),
  // The API also exposes PUT .../order for sections and pages; nothing calls it
  // until the sidebar grows drag-to-reorder, so it is not mirrored here.

  // Images placed on hand-drawn pages. No Content-Type header: the browser has
  // to set it itself so the multipart boundary comes with it.
  uploadAsset: (file) => {
    const body = new FormData()
    body.append('file', file)
    return req('/assets', { method: 'POST', body, headers: {} })
  },
  assetUrl: (id) => `/api/notes/assets/${id}`,
}
