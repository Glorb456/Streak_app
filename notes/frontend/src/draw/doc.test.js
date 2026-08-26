import { describe, expect, it } from 'vitest'
import { pt } from './geometry.js'
import {
  addElements, elementBox, emptyDoc, growPage, makeImage, makeStroke, mergeDocs,
  removeElements, replaceElement, selectInLasso, selectionBox, translateElements,
} from './doc.js'

const stroke = (pts, ct = 1000) => ({ ...makeStroke(pts, { color: '#fff', size: 3 }), ct, mt: ct })
const docWith = (...els) => ({ ...emptyDoc(), elements: els })

describe('element operations', () => {
  it('adds and bumps the revision', () => {
    const d = addElements(emptyDoc(), [stroke([pt(0, 0), pt(5, 5)])])
    expect(d.elements).toHaveLength(1)
    expect(d.rev).toBe(1)
  })

  it('removes and leaves a tombstone, so the delete can propagate', () => {
    const s = stroke([pt(0, 0), pt(5, 5)])
    const d = removeElements(docWith(s), [s.id])
    expect(d.elements).toEqual([])
    expect(d.deleted[s.id]).toBeGreaterThan(0)
  })

  it('translates strokes and images alike', () => {
    const s = stroke([pt(0, 0), pt(10, 0)])
    const img = makeImage('a.png', { x: 5, y: 5, w: 20, h: 20 })
    const d = translateElements(docWith(s, img), [s.id, img.id], 3, -2)
    expect(d.elements[0].points[0]).toEqual({ x: 3, y: -2, p: 0.5 })
    expect(d.elements[1]).toMatchObject({ x: 8, y: 3 })
  })

  it('leaves unselected elements untouched, by identity', () => {
    const a = stroke([pt(0, 0), pt(1, 1)])
    const b = stroke([pt(9, 9), pt(8, 8)])
    const d = translateElements(docWith(a, b), [a.id], 5, 5)
    expect(d.elements.find((e) => e.id === b.id)).toBe(b)
  })

  it('keeps a fragment split in the original z-position', () => {
    const old = stroke([pt(0, 0), pt(9, 9)], 1000)
    const recent = stroke([pt(0, 5), pt(9, 5)], 5000)
    const pieces = [{ ...old, id: 'p1' }, { ...old, id: 'p2' }]
    const d = replaceElement(docWith(old, recent), old.id, pieces)
    // Both fragments still sit under the newer stroke.
    expect(d.elements.map((e) => e.id)).toEqual(['p1', 'p2', recent.id])
    expect(d.deleted[old.id]).toBeGreaterThan(0)
  })

  it('caches bounds without serialising them', () => {
    const s = stroke([pt(0, 0), pt(10, 4)])
    expect(elementBox(s)).toBe(elementBox(s))
    expect(Object.keys(JSON.parse(JSON.stringify(s)))).not.toContain('_box')
  })

  it('grows the page in whole steps once drawing reaches the bottom', () => {
    const d = growPage(emptyDoc(100, 800), 810)
    expect(d.page.h).toBe(1200)
    expect(growPage(d, 500)).toBe(d)
  })
})

describe('lasso selection', () => {
  const loop = [[0, 0], [50, 0], [50, 50], [0, 50]]

  it('picks up a stroke inside the loop and not one outside', () => {
    const inside = stroke([pt(10, 10), pt(20, 20)])
    const outside = stroke([pt(200, 200), pt(210, 210)])
    expect(selectInLasso(docWith(inside, outside), loop)).toEqual([inside.id])
  })

  it('picks up a stroke that only partly enters the loop', () => {
    // Requiring every sample inside would make a long stroke unselectable.
    const crossing = stroke([pt(25, 25), pt(400, 400)])
    expect(selectInLasso(docWith(crossing), loop)).toEqual([crossing.id])
  })

  it('picks up an image the loop encloses', () => {
    const img = makeImage('a.png', { x: 10, y: 10, w: 20, h: 20 })
    expect(selectInLasso(docWith(img), loop)).toEqual([img.id])
  })

  it('ignores a loop too small to be a loop', () => {
    expect(selectInLasso(docWith(stroke([pt(1, 1), pt(2, 2)])), [[0, 0], [1, 1]])).toEqual([])
  })

  it('reports the box around a selection', () => {
    const a = stroke([pt(0, 0), pt(10, 10)])
    const b = stroke([pt(30, 5), pt(40, 15)])
    const box = selectionBox(docWith(a, b), [a.id, b.id])
    expect(box.x).toBeLessThanOrEqual(0)
    expect(box.x + box.w).toBeGreaterThanOrEqual(40)
    expect(selectionBox(docWith(a), [])).toBe(null)
  })
})

describe('cross-device merge', () => {
  const shared = stroke([pt(0, 0), pt(5, 5)], 1000)

  it('keeps strokes drawn on both devices', () => {
    const mine = addElements(docWith(shared), [stroke([pt(1, 1), pt(2, 2)], 2000)])
    const theirs = addElements(docWith(shared), [stroke([pt(7, 7), pt(8, 8)], 3000)])
    expect(mergeDocs(mine, theirs).elements).toHaveLength(3)
  })

  it('does not resurrect what the other device erased', () => {
    const mine = docWith(shared)
    const theirs = removeElements(docWith(shared), [shared.id])
    expect(mergeDocs(mine, theirs).elements).toEqual([])
    expect(mergeDocs(theirs, mine).elements).toEqual([])
  })

  it('takes the later edit when both moved the same stroke', () => {
    const mine = { ...docWith({ ...shared, mt: 5000, points: [pt(1, 1)] }) }
    const theirs = { ...docWith({ ...shared, mt: 9000, points: [pt(9, 9)] }) }
    expect(mergeDocs(mine, theirs).elements[0].points[0].x).toBe(9)
    expect(mergeDocs(theirs, mine).elements[0].points[0].x).toBe(9)
  })

  it('is commutative in the order it produces', () => {
    const a = stroke([pt(0, 0), pt(1, 1)], 4000)
    const b = stroke([pt(2, 2), pt(3, 3)], 4000) // identical ct: the id breaks the tie
    const mine = docWith(shared, a)
    const theirs = docWith(shared, b)
    const ids = (d) => d.elements.map((e) => e.id)
    expect(ids(mergeDocs(mine, theirs))).toEqual(ids(mergeDocs(theirs, mine)))
  })

  it('is idempotent, so it can run on every conflict retry', () => {
    const mine = addElements(docWith(shared), [stroke([pt(1, 1), pt(2, 2)], 2000)])
    const theirs = removeElements(docWith(shared), [shared.id])
    const once = mergeDocs(mine, theirs)
    const twice = mergeDocs(once, theirs)
    expect(twice.elements.map((e) => e.id)).toEqual(once.elements.map((e) => e.id))
  })

  it('keeps the taller page, so nothing below the fold is cropped', () => {
    const short = { ...emptyDoc(1000, 800) }
    const tall = { ...emptyDoc(1000, 2400) }
    expect(mergeDocs(short, tall).page.h).toBe(2400)
  })

  it('drops tombstones old enough that every device has seen them', () => {
    const ancient = { ...emptyDoc(), deleted: { gone: Date.now() - 40 * 24 * 3600 * 1000 } }
    const fresh = { ...emptyDoc(), deleted: { recent: Date.now() } }
    const out = mergeDocs(ancient, fresh)
    expect(out.deleted.gone).toBeUndefined()
    expect(out.deleted.recent).toBeDefined()
  })

  it('moves the revision past both sides', () => {
    const mine = { ...emptyDoc(), rev: 7 }
    const theirs = { ...emptyDoc(), rev: 12 }
    expect(mergeDocs(mine, theirs).rev).toBe(13)
  })
})
