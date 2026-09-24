// Palm rejection for the drawing page.
//
// Two things make a resting hand hard to tell from a deliberate tap on the
// web. iOS reports a palm as an ordinary touch pointer, indistinguishable
// from a fingertip except by its contact patch. And the `click`, the focus
// and the simulated `:hover` that follow a touch are *not* cancelled by
// preventDefault() on `pointerdown` — only cancelling `touchstart` stops
// them. So the decision lives here as a pure predicate and the page installs
// it on both events; getting it wrong in one place is what makes a toolbar
// light up on its own halfway through a word.

// CSS px across the contact patch. A fingertip measures roughly 15–25; the
// side of a hand is far wider. Set above a fingertip rather than just below
// a palm, because the cost of the two mistakes is not the same: a refused
// tap is repeated, a stray one changes the tool mid-sentence.
export const PALM_SIZE = 34

// A touch this soon after the pen was last in contact is the writing hand.
// The pause between characters is exactly when a palm shifts and re-lands,
// so the window has to outlast it.
export const PALM_MS = 700

// Chrome — the toolbar, the title, the top bar — gets a longer lockout than
// the canvas does. Losing a pan for half a second is a shrug; a palm that
// picks the eraser, fires undo or opens a rename is lost work.
export const CHROME_PALM_MS = 1200

/** Width of a contact patch in CSS px, from a PointerEvent or a raw Touch.
 *
 *  Touch.radiusX/radiusY are read first because iOS Safari fills those in
 *  while leaving PointerEvent.width/height at 1 — testing the pointer alone
 *  silently disables the size check on the one device this exists for. */
export function contactSize(e) {
  if (!e) return 0
  if (typeof e.radiusX === 'number' || typeof e.radiusY === 'number') {
    return Math.max(e.radiusX || 0, e.radiusY || 0) * 2
  }
  return Math.max(e.width || 0, e.height || 0)
}

/** Is this touch a resting hand rather than a deliberate tap?
 *
 *  `sincePen` is milliseconds since the pen tip was last *in contact* — not
 *  since it was last seen. An Apple Pencil streams pointermove the whole
 *  time it hovers, and letting hover hold the lockout open would leave a
 *  finger unable to touch anything while the pen is merely in the hand. */
export function isPalm({
  size = 0,
  sincePen = Infinity,
  penDown = false,
  busy = false,
  windowMs = PALM_MS,
} = {}) {
  if (penDown) return true   // the pen owns the page while its tip is down
  if (busy) return true      // a gesture already has an owner; this is a second contact
  if (size > PALM_SIZE) return true
  return sincePen < windowMs
}
