// The two erasers.
//
// Object erase removes whole strokes; pixel erase cuts a hole in them. They
// are genuinely different operations on a vector document — the second one has
// to rebuild the path, which is why it lives here as a pure function with its
// own tests rather than inside a pointer handler.

import { distToSegment, boxesOverlap, boundsOf } from './geometry.js'
import { elementBox, newId } from './doc.js'

/** Bounds of the eraser's travel this frame, padded by its radius. */
const strokeBox = (from, to, radius) =>
  boundsOf([from, to], radius)

/** Whether the eraser, dragged from `from` to `to`, touched this element.
 *
 *  Tested against the segment rather than the endpoint: at pen speed the
 *  pointer jumps tens of pixels between frames, and a point test would skip
 *  straight over strokes the user clearly dragged across. */
function touches(el, from, to, radius) {
  if (!boxesOverlap(elementBox(el), strokeBox(from, to, radius))) return false
  if (el.type === 'image') return true
  const reach = radius + el.size / 2
  return el.points.some((p) => distToSegment(p, from, to) <= reach)
}

/** Object eraser: the ids of every element the eraser crossed. */
export function objectErase(doc, from, to, radius) {
  return doc.elements.filter((el) => touches(el, from, to, radius)).map((el) => el.id)
}

/** Pixel eraser: the surviving fragments of one stroke.
 *
 *  Returns null when the stroke was not touched (so the caller can leave it
 *  alone), or an array — possibly empty — of replacement strokes. Erasing
 *  through the middle of a stroke yields two, which is the behaviour that
 *  makes this feel like erasing pixels rather than deleting objects.
 *
 *  Images are not split; a pixel eraser dragged over one leaves it alone,
 *  since cutting a hole in a photo is not what the tool is for. */
export function pixelEraseStroke(el, from, to, radius) {
  if (el.type !== 'stroke') return null
  if (!touches(el, from, to, radius)) return null

  const reach = radius + el.size / 2
  const runs = []
  let run = []
  for (const p of el.points) {
    if (distToSegment(p, from, to) <= reach) {
      if (run.length) { runs.push(run); run = [] }
    } else {
      run.push(p)
    }
  }
  if (run.length) runs.push(run)

  // A one-sample fragment is a dot the user did not draw — the residue of a
  // cut, not a mark. Dropping them is what keeps a scrubbed area clean
  // instead of leaving a trail of specks behind the eraser.
  return runs
    .filter((r) => r.length >= 2)
    .map((points) => ({
      ...el,
      id: newId(),
      // ct is inherited so the fragments hold the original's place in the page
      // order; without it, erasing through an old stroke would lift its halves
      // above everything drawn since.
      mt: Date.now(),
      points,
    }))
}

/** Apply the pixel eraser across the whole document.
 *
 *  Returns the ids that were cut and the replacements to put in their place,
 *  so the caller can apply it as one undoable step. */
export function pixelErase(doc, from, to, radius) {
  const removed = []
  const added = []
  for (const el of doc.elements) {
    const pieces = pixelEraseStroke(el, from, to, radius)
    if (pieces === null) continue
    removed.push(el.id)
    added.push(...pieces)
  }
  return { removed, added }
}
