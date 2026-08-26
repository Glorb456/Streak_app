// Tool state: five pencils, two erasers, and where that lives.
//
// Pencils are stored per device rather than in the notebook: which colour is
// in slot 3 is a property of the person holding the iPad, not of the page, and
// syncing it would mean the desktop reaching over and rearranging the pencils
// mid-sentence.

const STORE_KEY = 'streak-notes.tools.v1'

export const PENCIL_COUNT = 5

export const DEFAULT_PENCILS = [
  { color: '#f2f2f2', size: 3 },
  { color: '#b39bff', size: 5 },
  { color: '#5ac8fa', size: 2 },
  { color: '#ffd60a', size: 9, opacity: 0.4 }, // highlighter
  { color: '#ff453a', size: 4 },
]

export const SIZE_MIN = 1
export const SIZE_MAX = 24

export const ERASER_MIN = 6
export const ERASER_MAX = 60

export const defaultTools = () => ({
  kind: 'pen',            // 'pen' | 'eraser' | 'lasso'
  pencil: 0,              // active slot, 0..4
  eraserMode: 'pixel',    // 'pixel' | 'object'
  eraserSize: 18,
  pencils: DEFAULT_PENCILS.map((p) => ({ opacity: 1, ...p })),
})

const clampSize = (v, lo, hi) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))

/** Read tool state back, repairing anything a hand-edited or older store left
 *  behind — a missing pencil, a size from a previous range, a tool that no
 *  longer exists. The toolbar must always come up usable. */
export function loadTools() {
  const base = defaultTools()
  let raw
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch { raw = null }
  if (!raw || typeof raw !== 'object') return base

  const pencils = base.pencils.map((fallback, i) => {
    const p = Array.isArray(raw.pencils) ? raw.pencils[i] : null
    if (!p || typeof p !== 'object') return fallback
    return {
      color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : fallback.color,
      size: clampSize(p.size, SIZE_MIN, SIZE_MAX),
      opacity: Number.isFinite(p.opacity) ? Math.min(1, Math.max(0.05, p.opacity)) : fallback.opacity,
    }
  })
  return {
    kind: ['pen', 'eraser', 'lasso'].includes(raw.kind) ? raw.kind : base.kind,
    pencil: Number.isInteger(raw.pencil) && raw.pencil >= 0 && raw.pencil < PENCIL_COUNT
      ? raw.pencil : 0,
    eraserMode: raw.eraserMode === 'object' ? 'object' : 'pixel',
    eraserSize: clampSize(raw.eraserSize, ERASER_MIN, ERASER_MAX),
    pencils,
  }
}

export function saveTools(tools) {
  // A full localStorage (or a private window) must not take the toolbar down.
  try { localStorage.setItem(STORE_KEY, JSON.stringify(tools)) } catch { /* not fatal */ }
}

export const activePencil = (tools) => tools.pencils[tools.pencil] ?? tools.pencils[0]
