import { describe, expect, it } from 'vitest'
import {
  ENCODING, decodePoints, emptyDoc, encodePoints, newId, parseDoc, serializeDoc,
} from './codec.js'
import { makeStroke } from './doc.js'

const samples = (n) =>
  Array.from({ length: n }, (_, i) => ({
    x: 100 + Math.sin(i / 7) * 60,
    y: 50 + i * 1.7,
    p: 0.2 + (Math.sin(i / 3) + 1) * 0.35,
  }))

describe('point packing', () => {
  it('round-trips within the quantisation step', () => {
    const src = samples(400)
    const back = decodePoints(encodePoints(src))
    expect(back).toHaveLength(src.length)
    for (let i = 0; i < src.length; i++) {
      // 1/16 px and 1/255 pressure — both far below what any display resolves.
      expect(Math.abs(back[i].x - src[i].x)).toBeLessThanOrEqual(1 / 32)
      expect(Math.abs(back[i].y - src[i].y)).toBeLessThanOrEqual(1 / 32)
      expect(Math.abs(back[i].p - src[i].p)).toBeLessThanOrEqual(1 / 510)
    }
  })

  it('handles the degenerate cases', () => {
    expect(decodePoints(encodePoints([]))).toEqual([])
    const one = decodePoints(encodePoints([{ x: -12.5, y: 7.25, p: 1 }]))
    expect(one[0].x).toBeCloseTo(-12.5, 3)
    expect(one[0].p).toBeCloseTo(1, 3)
  })

  it('survives a stroke long enough to break naive base64', () => {
    // String.fromCharCode(...bytes) throws past ~100k arguments; a long
    // scribble is exactly the case this format is for.
    const long = samples(60000)
    expect(decodePoints(encodePoints(long))).toHaveLength(60000)
  })

  it('is much smaller than the same samples as JSON', () => {
    const src = samples(2000)
    const packed = encodePoints(src).length
    const naive = JSON.stringify(src).length
    expect(packed).toBeLessThan(naive / 5)
  })

  it('refuses truncated data rather than returning half a stroke', () => {
    const good = encodePoints(samples(50))
    // Lop off the tail; decoding must fail loudly so the caller drops this one
    // element instead of drawing a stroke that stops in the wrong place.
    expect(() => decodePoints(good.slice(0, 8) + '////')).toThrow()
  })
})

describe('ids', () => {
  it('does not collide across many mints', () => {
    const seen = new Set()
    for (let i = 0; i < 20000; i++) seen.add(newId())
    expect(seen.size).toBe(20000)
  })
})

describe('the envelope', () => {
  const doc = () => {
    const d = emptyDoc()
    d.elements = [makeStroke(samples(20), { color: '#ff0000', size: 4 })]
    return d
  }

  it('round-trips a document', () => {
    const before = doc()
    const after = parseDoc(serializeDoc(before))
    expect(after.elements).toHaveLength(1)
    expect(after.elements[0]).toMatchObject({
      type: 'stroke', color: '#ff0000', size: 4, id: before.elements[0].id,
    })
    expect(after.page).toEqual(before.page)
  })

  it('opens the placeholder a new drawing is created with', () => {
    // create_page writes '{}' — that has to open as a blank page, not an error.
    expect(parseDoc('{}').elements).toEqual([])
    expect(parseDoc('').elements).toEqual([])
    expect(parseDoc('not json at all').elements).toEqual([])
    expect(parseDoc('[1,2,3]').elements).toEqual([])
  })

  it('drops one unreadable element and still opens the page', () => {
    const d = doc()
    const raw = JSON.parse(serializeDoc(d))
    raw.elements.unshift({ id: 'bad', type: 'stroke', enc: ENCODING, points: '!!!!' })
    raw.elements.push({ id: 'alsobad', type: 'mystery' })
    const after = parseDoc(JSON.stringify(raw))
    expect(after.elements).toHaveLength(1)
    expect(after.elements[0].id).toBe(d.elements[0].id)
  })

  it('refuses an element in an encoding it does not know', () => {
    const raw = JSON.parse(serializeDoc(doc()))
    raw.elements[0].enc = 'q32d2-from-the-future'
    expect(parseDoc(JSON.stringify(raw)).elements).toEqual([])
  })

  it('never resurrects a tombstoned element', () => {
    const d = doc()
    const raw = JSON.parse(serializeDoc(d))
    raw.deleted = { [d.elements[0].id]: Date.now() }
    expect(parseDoc(JSON.stringify(raw)).elements).toEqual([])
  })

  it('drops a duplicate id, which would make deletes ambiguous', () => {
    const raw = JSON.parse(serializeDoc(doc()))
    raw.elements.push({ ...raw.elements[0] })
    expect(parseDoc(JSON.stringify(raw)).elements).toHaveLength(1)
  })
})
