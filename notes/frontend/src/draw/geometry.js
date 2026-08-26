// Stroke geometry: what turns a stream of pointer samples into the filled
// outline that gets drawn, and the hit tests the lasso and eraser run against.
//
// Everything here is pure and works in page coordinates (CSS pixels at zoom 1),
// never device pixels — that separation is what keeps a drawing crisp when the
// same file is opened on a 3x iPad and a 1x monitor.

/** A sample as it comes off the pointer: page x/y plus 0..1 pressure. */
export const pt = (x, y, p = 0.5) => ({ x, y, p })

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

/** Exponential smoothing of position, and of pressure separately.
 *
 *  Raw pen input is jittery at the sample rate an Apple Pencil reports, and
 *  drawing it unfiltered shows up as a visibly ragged edge on the outline.
 *  Pressure gets a heavier filter than position: it is noisier and the eye
 *  reads a width wobble much more readily than a sub-pixel position wobble. */
export function smooth(points, position = 0.5, pressure = 0.25) {
  if (points.length < 3) return points.map((p) => ({ ...p }))
  const out = [{ ...points[0] }]
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1]
    const cur = points[i]
    out.push({
      x: prev.x + (cur.x - prev.x) * position,
      y: prev.y + (cur.y - prev.y) * position,
      p: prev.p + (cur.p - prev.p) * pressure,
    })
  }
  // The filter lags, so the last sample is pinned back to where the pen
  // actually was — otherwise every stroke ends slightly short of the lift.
  out[out.length - 1] = { ...points[points.length - 1], p: out[out.length - 1].p }
  return out
}

/** Ramer–Douglas–Peucker over position *and* pressure.
 *
 *  Run once when a stroke is committed. A three-second scribble arrives as
 *  hundreds of samples of which most sit on a straight run; dropping them
 *  costs nothing visible and is most of why the stored file stays small.
 *
 *  Pressure is part of the error term, not just cargo on the surviving points.
 *  Plain RDP measures geometry alone, so a firm-then-light stroke drawn in a
 *  straight line collapses to its two endpoints and loses its taper entirely —
 *  the width variation is the whole point of drawing with a pencil, and on a
 *  straight line it is the *only* thing that varies. */
export function simplify(points, tolerance = 0.35, pressureTolerance = 0.05) {
  if (points.length < 3) return points.map((p) => ({ ...p }))
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let index = -1
    // Both errors are normalised against their own tolerance, so one score
    // ranks them and either alone can justify keeping a point.
    let worst = 1
    const a = points[first]
    const b = points[last]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    for (let i = first + 1; i < last; i++) {
      const p = points[i]
      // Perpendicular distance, degenerating to plain distance when the
      // segment has no length (a pen held still still emits samples).
      const d = len === 0
        ? Math.hypot(p.x - a.x, p.y - a.y)
        : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
      // Pressure is compared against the ramp the two endpoints imply, using
      // position along the span rather than index, so it stays right where
      // samples bunch up.
      const t = len === 0 ? (i - first) / (last - first) : Math.hypot(p.x - a.x, p.y - a.y) / len
      const pd = Math.abs(p.p - (a.p + (b.p - a.p) * Math.min(1, t)))
      const score = Math.max(d / tolerance, pd / pressureTolerance)
      if (score > worst) { index = i; worst = score }
    }
    if (index !== -1) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  const out = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push({ ...points[i] })
  return out
}

/** Resample along a centripetal Catmull-Rom spline at even spacing.
 *
 *  Simplify leaves points bunched at curves and sparse on straights; the
 *  outline builder needs even spacing or the width steps visibly between far
 *  apart samples. Centripetal (alpha 0.5) rather than uniform because uniform
 *  Catmull-Rom overshoots into a cusp exactly where a fast pen stroke doubles
 *  back on itself. */
export function resample(points, spacing = 1.5) {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const src = points
  const at = (i) => src[Math.max(0, Math.min(src.length - 1, i))]

  // Two passes, because a spline's arc length is longer than the chord it
  // spans: subdividing each segment by chord/spacing leaves the actual gaps
  // up to a third too wide on a curve, and the width steps show. So sample
  // finely first, then walk that polyline by true distance.
  const dense = [{ ...src[0] }]
  for (let i = 0; i < src.length - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const steps = Math.max(2, Math.ceil((dist(p1, p2) / spacing) * 4))
    for (let s = 1; s <= steps; s++) dense.push(catmullRom(p0, p1, p2, p3, s / steps))
  }

  const out = [{ ...dense[0] }]
  let carry = 0
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]
    const b = dense[i]
    let seg = dist(a, b)
    if (seg === 0) continue
    let travelled = 0
    // Emit a point every `spacing` along this sub-segment, carrying the
    // leftover distance into the next one so gaps never accumulate.
    while (carry + (seg - travelled) >= spacing) {
      travelled += spacing - carry
      carry = 0
      const t = travelled / seg
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t })
    }
    carry += seg - travelled
  }
  const last = dense[dense.length - 1]
  if (dist(out[out.length - 1], last) > 1e-9) out.push({ ...last })
  return out
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  const f = (a, b, c, d) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return {
    x: f(p0.x, p1.x, p2.x, p3.x),
    y: f(p0.y, p1.y, p2.y, p3.y),
    p: p1.p + (p2.p - p1.p) * t,
  }
}

/** Half-width at a sample, in page units.
 *
 *  Pressure maps to 35–100% of the nominal size, which is roughly what a real
 *  pencil does — it never goes to nothing, so a light stroke stays visible. */
export function radiusAt(size, pressure) {
  return (size / 2) * (0.35 + 0.65 * Math.max(0, Math.min(1, pressure)))
}

const TAU = Math.PI * 2

/** Build the fillable outline of a stroke: one closed polygon, up one side of
 *  the centreline and back down the other, with round caps at both ends.
 *
 *  Filling an outline rather than stroking a path with a varying lineWidth is
 *  what gives the pressure taper — canvas lineWidth is per-path, so the
 *  stroke-based approach can only step width between sub-paths and shows a
 *  visible seam at every step. */
export function outline(points, size) {
  if (points.length === 0) return []
  if (points.length === 1) return circle(points[0], radiusAt(size, points[0].p))

  const left = []
  const right = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const prev = points[i - 1] || p
    const next = points[i + 1] || p
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    dx /= len
    dy /= len
    const r = radiusAt(size, p.p)
    left.push([p.x - dy * r, p.y + dx * r])
    right.push([p.x + dy * r, p.y - dx * r])
  }
  if (!left.length) return circle(points[0], radiusAt(size, points[0].p))

  const first = points[0]
  const last = points[points.length - 1]
  return [
    ...left,
    ...cap(last, radiusAt(size, last.p), angleOf(points[points.length - 2] || first, last)),
    ...right.reverse(),
    ...cap(first, radiusAt(size, first.p), angleOf(points[1] || last, first)),
  ]
}

const angleOf = (from, to) => Math.atan2(to.y - from.y, to.x - from.x)

function cap(p, r, angle, steps = 8) {
  const out = []
  for (let i = 0; i <= steps; i++) {
    const a = angle - Math.PI / 2 + (Math.PI * i) / steps
    out.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r])
  }
  return out
}

function circle(p, r, steps = 16) {
  const out = []
  for (let i = 0; i < steps; i++) {
    const a = (TAU * i) / steps
    out.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r])
  }
  return out
}

// ------------------------------------------------------------- bounds

/** Axis-aligned bounds of a point list, padded by a stroke's half width.
 *
 *  Every element carries this precomputed: culling to the visible band is a
 *  bounds test per element per frame, so recomputing it from the points would
 *  put the whole document back in the scroll path. */
export function boundsOf(points, pad = 0) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

export const boxesOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export const boxContains = (box, p) =>
  p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h

// ---------------------------------------------------------- hit tests

/** Even-odd ray cast. Used by the lasso, so it has to be right on the concave
 *  shapes a freehand loop actually produces, not just convex ones. */
export function pointInPolygon(p, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const straddles = (yi > p.y) !== (yj > p.y)
    if (straddles && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Shortest distance from a point to a segment. The eraser and the tap-select
 *  both need "is the cursor on this stroke", which is this against the
 *  stroke's half width. */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** True if the centreline passes within `radius` of `p`. */
export function strokeNear(points, p, radius) {
  if (points.length === 1) return dist(points[0], p) <= radius
  for (let i = 1; i < points.length; i++) {
    if (distToSegment(p, points[i - 1], points[i]) <= radius) return true
  }
  return false
}
