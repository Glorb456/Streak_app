import { describe, expect, it } from 'vitest'
import {
  boundsOf, boxesOverlap, distToSegment, outline, pointInPolygon, pt,
  radiusAt, resample, simplify, smooth, strokeNear,
} from './geometry.js'

const line = (n, step = 1) =>
  Array.from({ length: n }, (_, i) => pt(i * step, 0, 0.5))

describe('simplify', () => {
  it('collapses a straight run to its endpoints', () => {
    expect(simplify(line(50))).toHaveLength(2)
  })

  it('keeps the corner of an L', () => {
    const points = [...line(20), ...Array.from({ length: 20 }, (_, i) => pt(19, i + 1))]
    const out = simplify(points)
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out.some((p) => p.x === 19 && p.y === 0)).toBe(true)
  })

  it('keeps every point within tolerance of the original path', () => {
    const wiggly = Array.from({ length: 300 }, (_, i) => pt(i, Math.sin(i / 5) * 20))
    const out = simplify(wiggly, 0.35)
    expect(out.length).toBeLessThan(wiggly.length / 2)
    for (const p of wiggly) {
      let best = Infinity
      for (let i = 1; i < out.length; i++) best = Math.min(best, distToSegment(p, out[i - 1], out[i]))
      expect(best).toBeLessThanOrEqual(0.36)
    }
  })

  it('leaves a pen held still alone rather than dividing by zero', () => {
    const still = Array.from({ length: 10 }, () => pt(5, 5))
    expect(simplify(still)).toHaveLength(2)
  })

  it('carries pressure through on the points it keeps', () => {
    const points = [pt(0, 0, 0.1), pt(5, 30, 0.9), pt(10, 0, 0.2)]
    expect(simplify(points).map((p) => p.p)).toEqual([0.1, 0.9, 0.2])
  })

  it('keeps the taper of a straight stroke pressed harder in the middle', () => {
    // What a real pen stroke does. Geometry-only RDP collapses this to its two
    // endpoints — both at the light end — and throws the taper away entirely,
    // which on a straight line is the only thing there was to keep.
    const arc = Array.from(
      { length: 60 },
      (_, i) => pt(i * 3, 0, 0.15 + 0.8 * Math.sin((i / 59) * Math.PI))
    )
    const out = simplify(arc)
    // Well past the two endpoints plain RDP would leave — but the count is not
    // the point; the fidelity check below is. Five or six samples is enough to
    // carry this taper, and storing more would be storing nothing.
    expect(out.length).toBeGreaterThan(3)
    // Every original sample's pressure is reproduced by the retained ramp.
    for (let i = 1; i < arc.length; i++) {
      let best = Infinity
      for (let j = 1; j < out.length; j++) {
        const a = out[j - 1]
        const b = out[j]
        if (arc[i].x < a.x || arc[i].x > b.x) continue
        const t = (arc[i].x - a.x) / (b.x - a.x || 1)
        best = Math.min(best, Math.abs(arc[i].p - (a.p + (b.p - a.p) * t)))
      }
      expect(best).toBeLessThan(0.08)
    }
  })

  it('still collapses a straight stroke drawn at constant pressure', () => {
    // The pressure term must not defeat the simplification it rides along with.
    expect(simplify(Array.from({ length: 60 }, (_, i) => pt(i * 3, 0, 0.5)))).toHaveLength(2)
  })

  it('collapses a straight, linear ramp too — two points already describe it', () => {
    // Pressure is interpolated between samples, so a straight line whose
    // pressure rises evenly is reproduced exactly by its endpoints. Keeping
    // more would be storing points that change nothing.
    const ramp = Array.from({ length: 60 }, (_, i) => pt(i * 3, 0, 0.15 + (i / 59) * 0.8))
    expect(simplify(ramp)).toHaveLength(2)
  })

  it('keeps a pressure dip in the middle of a stroke', () => {
    const dip = Array.from({ length: 40 }, (_, i) => pt(i * 4, 0, i === 20 ? 0.1 : 0.9))
    expect(simplify(dip).some((p) => p.p < 0.3)).toBe(true)
  })
})

describe('smooth', () => {
  it('pins the last sample to where the pen actually lifted', () => {
    const points = [...line(10), pt(100, 100, 1)]
    const out = smooth(points)
    expect(out[out.length - 1].x).toBe(100)
    expect(out[out.length - 1].y).toBe(100)
  })

  it('reduces jitter', () => {
    const noisy = Array.from({ length: 60 }, (_, i) => pt(i, i % 2 ? 1 : -1))
    const spread = (ps) => Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y))
    expect(spread(smooth(noisy).slice(5, -5))).toBeLessThan(spread(noisy))
  })

  it('leaves a tap alone', () => {
    expect(smooth([pt(1, 2, 0.7)])).toEqual([pt(1, 2, 0.7)])
  })
})

describe('resample', () => {
  it('produces roughly even spacing', () => {
    const out = resample([pt(0, 0), pt(10, 0), pt(60, 0)], 2)
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y)).toBeLessThanOrEqual(2.5)
    }
  })

  it('keeps the endpoints', () => {
    const out = resample([pt(0, 0), pt(10, 5), pt(20, 0)], 1)
    expect(out[0]).toMatchObject({ x: 0, y: 0 })
    expect(out[out.length - 1].x).toBeCloseTo(20, 6)
  })
})

describe('outline', () => {
  it('gets wider with pressure', () => {
    expect(radiusAt(10, 1)).toBeGreaterThan(radiusAt(10, 0.2))
    // Never vanishes: a light stroke must still leave a mark.
    expect(radiusAt(10, 0)).toBeGreaterThan(0)
  })

  it('wraps a straight stroke in a closed band of the right width', () => {
    const poly = outline(line(20, 4), 8)
    const b = boundsOf(poly.map(([x, y]) => ({ x, y })))
    expect(b.h).toBeCloseTo(radiusAt(8, 0.5) * 2, 1)
    expect(poly.length).toBeGreaterThan(20)
  })

  it('renders a single tap as a dot', () => {
    const poly = outline([pt(10, 10, 1)], 6)
    const b = boundsOf(poly.map(([x, y]) => ({ x, y })))
    expect(b.w).toBeCloseTo(6, 1)
    expect(b.h).toBeCloseTo(6, 1)
  })

  it('survives a stroke of repeated identical samples', () => {
    expect(outline(Array.from({ length: 8 }, () => pt(3, 3, 0.5)), 4).length).toBeGreaterThan(0)
  })
})

describe('hit tests', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]]

  it('does point-in-polygon on a convex loop', () => {
    expect(pointInPolygon(pt(5, 5), square)).toBe(true)
    expect(pointInPolygon(pt(15, 5), square)).toBe(false)
  })

  it('is right on a concave loop, which is what a freehand lasso makes', () => {
    // A 'C': the gap in the middle right is outside despite being within bounds.
    const c = [[0, 0], [10, 0], [10, 3], [4, 3], [4, 7], [10, 7], [10, 10], [0, 10]]
    expect(pointInPolygon(pt(2, 5), c)).toBe(true)
    expect(pointInPolygon(pt(8, 5), c)).toBe(false)
  })

  it('measures distance to a segment, including past its ends', () => {
    expect(distToSegment(pt(5, 3), pt(0, 0), pt(10, 0))).toBeCloseTo(3, 6)
    expect(distToSegment(pt(-4, 0), pt(0, 0), pt(10, 0))).toBeCloseTo(4, 6)
    expect(distToSegment(pt(1, 1), pt(2, 2), pt(2, 2))).toBeCloseTo(Math.hypot(1, 1), 6)
  })

  it('finds a stroke under the cursor without walking off the ends', () => {
    const s = line(10, 5)
    expect(strokeNear(s, pt(22, 2), 3)).toBe(true)
    expect(strokeNear(s, pt(22, 9), 3)).toBe(false)
    expect(strokeNear(s, pt(-20, 0), 3)).toBe(false)
  })

  it('overlaps boxes only when they really overlap', () => {
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true)
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toBe(false)
  })

  it('pads bounds by the stroke half width', () => {
    expect(boundsOf([pt(0, 0), pt(10, 4)], 2)).toEqual({ x: -2, y: -2, w: 14, h: 8 })
  })
})
