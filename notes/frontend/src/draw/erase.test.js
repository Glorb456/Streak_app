import { describe, expect, it } from 'vitest'
import { pt } from './geometry.js'
import { emptyDoc, makeImage, makeStroke } from './doc.js'
import { objectErase, pixelErase, pixelEraseStroke } from './erase.js'

const across = (n = 41) => Array.from({ length: n }, (_, i) => pt(i, 0, 0.5))
const stroke = (pts = across()) => makeStroke(pts, { color: '#fff', size: 2 })
const docWith = (...els) => ({ ...emptyDoc(), elements: els })

describe('object eraser', () => {
  it('takes the whole stroke it crosses', () => {
    const s = stroke()
    expect(objectErase(docWith(s), pt(20, -5), pt(20, 5), 4)).toEqual([s.id])
  })

  it('leaves strokes it misses', () => {
    const s = stroke()
    expect(objectErase(docWith(s), pt(20, 40), pt(20, 50), 4)).toEqual([])
  })

  it('catches strokes crossed between two frames, not just under the cursor', () => {
    // At pen speed the pointer jumps; a point test would skip straight over.
    const a = stroke(across().map((p) => ({ ...p, y: 0 })))
    const b = stroke(across().map((p) => ({ ...p, y: 60 })))
    expect(objectErase(docWith(a, b), pt(20, -10), pt(20, 90), 2).sort())
      .toEqual([a.id, b.id].sort())
  })

  it('takes an image it crosses', () => {
    const img = makeImage('a.png', { x: 0, y: 0, w: 40, h: 40 })
    expect(objectErase(docWith(img), pt(20, 20), pt(21, 21), 3)).toEqual([img.id])
  })
})

describe('pixel eraser', () => {
  it('cuts a stroke in two when dragged through its middle', () => {
    const s = stroke()
    const pieces = pixelEraseStroke(s, pt(20, -5), pt(20, 5), 4)
    expect(pieces).toHaveLength(2)
    // The gap is where the eraser went, and the ends are untouched.
    expect(pieces[0].points[0].x).toBe(0)
    expect(pieces[0].points.at(-1).x).toBeLessThan(20)
    expect(pieces[1].points[0].x).toBeGreaterThan(20)
    expect(pieces[1].points.at(-1).x).toBe(40)
  })

  it('shortens rather than splits when it clips an end', () => {
    const pieces = pixelEraseStroke(stroke(), pt(0, 0), pt(3, 0), 3)
    expect(pieces).toHaveLength(1)
    expect(pieces[0].points[0].x).toBeGreaterThan(3)
  })

  it('removes the stroke entirely when nothing is left', () => {
    expect(pixelEraseStroke(stroke(), pt(-10, 0), pt(60, 0), 30)).toEqual([])
  })

  it('reports untouched strokes as untouched, not as unchanged copies', () => {
    // null lets the caller skip the element entirely; [] would mean "delete it".
    expect(pixelEraseStroke(stroke(), pt(20, 90), pt(21, 95), 3)).toBe(null)
  })

  it('gives each fragment a new id but the original creation time', () => {
    const s = stroke()
    const pieces = pixelEraseStroke(s, pt(20, -5), pt(20, 5), 4)
    expect(new Set(pieces.map((p) => p.id)).size).toBe(2)
    expect(pieces.map((p) => p.id)).not.toContain(s.id)
    for (const p of pieces) expect(p.ct).toBe(s.ct)
  })

  it('keeps colour and width across the cut', () => {
    const s = makeStroke(across(), { color: '#ff0055', size: 7 })
    for (const p of pixelEraseStroke(s, pt(20, -5), pt(20, 5), 4)) {
      expect(p).toMatchObject({ color: '#ff0055', size: 7 })
    }
  })

  it('does not leave single-sample specks behind', () => {
    // A one-point fragment is residue of the cut, not a mark the user drew.
    const zig = [pt(0, 0), pt(10, 0), pt(11, 0), pt(30, 0), pt(40, 0)]
    for (const p of pixelEraseStroke(stroke(zig), pt(20, -30), pt(20, 30), 12)) {
      expect(p.points.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('leaves images alone — a pixel eraser is not a photo editor', () => {
    const img = makeImage('a.png', { x: 0, y: 0, w: 40, h: 40 })
    expect(pixelEraseStroke(img, pt(20, 20), pt(21, 21), 5)).toBe(null)
  })

  it('applies across the document as one removed/added pair', () => {
    const a = stroke()
    const b = stroke(across().map((p) => ({ ...p, y: 60 })))
    const { removed, added } = pixelErase(docWith(a, b), pt(20, -5), pt(20, 5), 4)
    expect(removed).toEqual([a.id])
    expect(added).toHaveLength(2)
  })
})
