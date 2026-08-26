async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  // Behind oauth2-proxy an expired session answers /api with 401 rather than a
  // redirect. Reload so the browser follows the login redirect instead of the
  // 5 s poll quietly failing forever.
  if (res.status === 401) {
    window.location.reload()
    throw new Error(`${opts.method || 'GET'} ${path} -> 401 (session expired)`)
  }
  if (!res.ok) {
    // The status rides on the error: callers that can recover from a specific
    // one (the sticky pad retries a 409 rename without the rename) need to
    // tell it apart from a genuine failure.
    const err = new Error(`${opts.method || 'GET'} ${path} -> ${res.status}`)
    err.status = res.status
    throw err
  }
  // Every handler returns a body today, but a 204 would make res.json() throw
  // "Unexpected end of JSON input" on all three delete calls. No caller of
  // those reads the result, so null is safe.
  if (res.status === 204 || res.headers.get('content-length') === '0') return null
  return res.json()
}

export const api = {
  categories: () => req('/categories'),
  createCategory: (body) => req('/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id, body) => req(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCategory: (id) => req(`/categories/${id}`, { method: 'DELETE' }),

  tasks: (start, end) => req(`/tasks?start=${start}&end=${end}`),
  createTask: (body) => req('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id, body) => req(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTask: (id) => req(`/tasks/${id}`, { method: 'DELETE' }),
  // Whole-day, not per-task: the server renumbers that day from this array in
  // one statement, so a reorder can't half-apply. Answers with the day as it
  // now stands.
  reorderTasks: (due_date, ids) =>
    req('/tasks/reorder', { method: 'PUT', body: JSON.stringify({ due_date, ids }) }),

  dailyTasks: () => req('/daily'),
  createDailyTask: (body) => req('/daily', { method: 'POST', body: JSON.stringify(body) }),
  updateDailyTask: (id, body) => req(`/daily/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDailyTask: (id) => req(`/daily/${id}`, { method: 'DELETE' }),

  completions: (start, end) => req(`/daily/completions?start=${start}&end=${end}`),
  streak: (today) => req(`/daily/streak?today=${today}`),
  setCompletion: (body) => req('/daily/completions', { method: 'PUT', body: JSON.stringify(body) }),

  settings: () => req('/settings'),
  setSetting: (key, value) => req('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),

  // Multi-node sync (host/backup/mirror). status is cheap and rides the poll;
  // conflicts is the bare-bones resolver's list.
  syncStatus: () => req('/sync/status'),
  syncNow: () => req('/sync/now', { method: 'POST' }),
  syncConflicts: () => req('/sync/conflicts'),
  resolveConflict: (id, restore) =>
    req(`/sync/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ restore }) }),
}

// Streak Notes' API, reached through the same nginx and the same oauth2-proxy
// session as everything above — which is the whole reason the sticky-note
// widget can live in this app and store its notes in the other one without a
// second login or a second copy of the data.
//
// Sticky notes are ordinary markdown pages in the app-owned "Sticky Notes"
// section, using the same '- [ ]' checklist encoding as task notes, so the
// same note opens in the widget and in Streak Notes.
export const notesApi = {
  tree: () => req('/notes/tree'),
  page: (id) => req(`/notes/pages/${id}`),
  createNote: (section_id, title) =>
    req('/notes/pages', {
      method: 'POST',
      body: JSON.stringify({ section_id, title, kind: 'markdown' }),
    }),
  updateNote: (id, body) =>
    req(`/notes/pages/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteNote: (id) => req(`/notes/pages/${id}`, { method: 'DELETE' }),
}
