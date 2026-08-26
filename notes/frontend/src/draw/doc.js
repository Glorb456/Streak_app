// The drawing document: element operations, and the merge that makes the same
// page editable from two devices.
//
// Every mutation returns a new doc object (the elements themselves are shared
// where untouched), so React re-renders on identity and undo is a stack of
// previous docs rather than a stack of inverse operations.

import { boundsOf, boxesOverlap, pointInPolygon, radiusAt } from './geometry.js'
import { emptyDoc, newId } from './codec.js'

export { emptyDoc, newId }

// Tombstones are kept so a delete propagates to a device that still has the
// element, and pruned so they don't accumulate forever. Thirty days is far
// longer than any realistic gap between two devices opening the same notebook.
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000

/** Cached axis-aligned bounds. Culling runs this per element per frame while
 *  scrolling, so it must not walk the point list every time. */
export function elementBox(el) {
  if (el._box) return el._box
  const box = el.type === 'image'
    ? { x: el.x, y: el.y, w: el.w, h: el.h }
    : boundsOf(el.points, radiusAt(el.size, 1) + 1)
  Object.defineProperty(el, '_box', { value: box, enumerable: false, configurable: true })
  return box
}

/** Page order: creation time, then id.
 *
 *  Never modification time — moving an old stroke must not bring it to the
 *  front — and the id tiebreak is what makes two devices that received the
 *  same two elements in different orders still draw them in the same order. */
const byCreation = (a, b) => (a.ct - b.ct) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function makeStroke(points, { color, size, opacity = 1 }) {
  const now = Date.now()
  return { id: newId(), type: 'stroke', color, size, opacity, ct: now, mt: now, points }
}

export function makeImage(asset, { x, y, w, h }) {
  const now = Date.now()
  return { id: newId(), type: 'image', asset, x, y, w, h, ct: now, mt: now }
}

export function addElements(doc, els) {
  if (!els.length) return doc
  return {
    ...doc,
    rev: doc.rev + 1,
    elements: [...doc.elements, ...els].sort(byCreation),
  }
}

export function removeElements(doc, ids) {
  const set = ids instanceof Set ? ids : new Set(ids)
  if (!set.size) return doc
  const now = Date.now()
  const deleted = { ...doc.deleted }
  for (const id of set) deleted[id] = now
  return {
    ...doc,
    rev: doc.rev + 1,
    elements: doc.elements.filter((e) => !set.has(e.id)),
    deleted,
  }
}

/** Swap one element for its replacements — how the pixel eraser applies a
 *  split. The pieces inherit ct, so an erased stroke's fragments keep the
 *  z-position the original had instead of jumping to the front. */
export function replaceElement(doc, id, replacements) {
  const now = Date.now()
  const deleted = { ...doc.deleted, [id]: now }
  const rest = doc.elements.filter((e) => e.id !== id)
  return {
    ...doc,
    rev: doc.rev + 1,
    elements: [...rest, ...replacements].sort(byCreation),
    deleted,
  }
}

export function translateElements(doc, ids, dx, dy) {
  const set = ids instanceof Set ? ids : new Set(ids)
  if (!set.size || (dx === 0 && dy === 0)) return doc
  const now = Date.now()
  return {
    ...doc,
    rev: doc.rev + 1,
    elements: doc.elements.map((el) => {
      if (!set.has(el.id)) return el
      if (el.type === 'image') return { ...el, x: el.x + dx, y: el.y + dy, mt: now }
      return {
        ...el,
        mt: now,
        points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy, p: p.p })),
      }
    }),
  }
}

/** The page grows downward as the drawing approaches the bottom, so there is
 *  always somewhere to keep writing — the same way a notes app never makes you
 *  ask for more paper. */
export function growPage(doc, needed) {
  if (needed <= doc.page.h) return doc
  return { ...doc, rev: doc.rev + 1, page: { ...doc.page, h: Math.ceil(needed / 400) * 400 } }
}

// ------------------------------------------------------------ selection

/** Elements whose geometry falls inside a freehand lasso loop.
 *
 *  A stroke counts when any of its samples is inside, not all of them: on a
 *  long stroke, requiring every sample would make it impossible to pick up
 *  anything that runs off the loop, which is not how a lasso reads. Bounds are
 *  checked first so the per-sample test only runs on plausible candidates. */
export function selectInLasso(doc, poly) {
  if (poly.length < 3) return []
  const box = boundsOf(poly.map(([x, y]) => ({ x, y })))
  const hits = []
  for (const el of doc.elements) {
    if (!boxesOverlap(elementBox(el), box)) continue
    if (el.type === 'image') {
      const b = elementBox(el)
      const corners = [
        { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
        { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h },
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      ]
      if (corners.some((c) => pointInPolygon(c, poly))) hits.push(el.id)
      continue
    }
    if (el.points.some((p) => pointInPolygon(p, poly))) hits.push(el.id)
  }
  return hits
}

export function selectionBox(doc, ids) {
  const set = ids instanceof Set ? ids : new Set(ids)
  const boxes = doc.elements.filter((e) => set.has(e.id)).map(elementBox)
  if (!boxes.length) return null
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.w))
  const maxY = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ---------------------------------------------------------------- merge

/** Reconcile two versions of the same page.
 *
 *  This is what makes the drawing safe to edit from the iPad and the desktop
 *  without one clobbering the other. Whole-file last-write-wins would silently
 *  discard whichever device saved first; instead:
 *
 *    - elements union by id, so strokes drawn on either device all survive
 *    - a tombstone on either side wins, so an erase is never resurrected by
 *      the other device still holding the stroke
 *    - for an element both sides changed (a lasso move), the later mt wins
 *    - order is by ct, so both devices end up drawing the page identically
 *
 *  It is commutative and idempotent, which is what lets it run on whichever
 *  side notices the conflict, as many times as the sync needs. */
export function mergeDocs(mine, theirs) {
  const now = Date.now()
  const deleted = { ...theirs.deleted }
  for (const [id, ts] of Object.entries(mine.deleted)) {
    if (!deleted[id] || ts < deleted[id]) deleted[id] = ts
  }
  for (const [id, ts] of Object.entries(deleted)) {
    if (now - ts > TOMBSTONE_TTL) delete deleted[id]
  }

  const byId = new Map()
  for (const el of [...theirs.elements, ...mine.elements]) {
    if (deleted[el.id]) continue
    const existing = byId.get(el.id)
    if (!existing || el.mt > existing.mt) byId.set(el.id, el)
  }

  return {
    format: mine.format,
    version: mine.version,
    // The taller page wins: a device that only ever saw the short version
    // must not crop away strokes drawn below its own bottom edge.
    page: { w: Math.max(mine.page.w, theirs.page.w), h: Math.max(mine.page.h, theirs.page.h) },
    rev: Math.max(mine.rev, theirs.rev) + 1,
    elements: [...byId.values()].sort(byCreation),
    deleted,
  }
}
