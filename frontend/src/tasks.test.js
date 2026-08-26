import { describe, expect, it } from 'vitest'
import {
  applyVisibleOrder, firstTaskIdOn, moveItem, orderTasks, tasksOn,
} from './tasks.js'

const t = (id, position, due_date = '2026-07-15') => ({ id, position, due_date })

describe('orderTasks', () => {
  it('sorts by position within a day', () => {
    const out = orderTasks([t(1, 2), t(2, 0), t(3, 1)])
    expect(out.map((x) => x.id)).toEqual([2, 3, 1])
  })

  it('handles the negative positions new tasks are created with', () => {
    const out = orderTasks([t(1, 0), t(2, -1), t(3, -2)])
    expect(out.map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('falls back to id when positions tie, keeping pre-migration order', () => {
    const out = orderTasks([t(3, 0), t(1, 0), t(2, 0)])
    expect(out.map((x) => x.id)).toEqual([1, 2, 3])
  })

  it('treats a missing position as 0, for optimistic local objects', () => {
    const out = orderTasks([{ id: 5, due_date: '2026-07-15' }, t(6, -1)])
    expect(out.map((x) => x.id)).toEqual([6, 5])
  })

  it('groups by date before position', () => {
    const out = orderTasks([t(1, 0, '2026-07-16'), t(2, 9, '2026-07-15')])
    expect(out.map((x) => x.id)).toEqual([2, 1])
  })

  it('does not mutate its input', () => {
    const input = [t(1, 2), t(2, 0)]
    orderTasks(input)
    expect(input.map((x) => x.id)).toEqual([1, 2])
  })
})

describe('tasksOn', () => {
  it('keeps only the requested day, in order', () => {
    const out = tasksOn([t(1, 1), t(2, 0), t(3, 0, '2026-07-16')], '2026-07-15')
    expect(out.map((x) => x.id)).toEqual([2, 1])
  })

  it('returns [] for a day with nothing on it', () => {
    expect(tasksOn([t(1, 0)], '2026-07-20')).toEqual([])
  })
})

describe('moveItem', () => {
  it('moves an item down', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('moving to its own index changes nothing', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('leaves the list alone for out-of-range indices', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const input = ['a', 'b', 'c']
    moveItem(input, 0, 2)
    expect(input).toEqual(['a', 'b', 'c'])
  })
})

describe('applyVisibleOrder', () => {
  it('is a straight swap when everything is visible', () => {
    expect(applyVisibleOrder([1, 2, 3], [1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2])
  })

  it('leaves hidden ids in the slots they already held', () => {
    // 2 is a done task hidden by `hide done`; dragging 3 above 1 must not
    // move 2 out of the middle slot.
    expect(applyVisibleOrder([1, 2, 3], [1, 3], [3, 1])).toEqual([3, 2, 1])
  })

  it('keeps a hidden id at the top where it was', () => {
    expect(applyVisibleOrder([9, 1, 2], [1, 2], [2, 1])).toEqual([9, 2, 1])
  })

  it('returns the whole day, not just the visible part', () => {
    expect(applyVisibleOrder([1, 2, 3, 4], [2, 4], [4, 2])).toHaveLength(4)
  })

  it('is a no-op when the visible order is unchanged', () => {
    expect(applyVisibleOrder([1, 2, 3], [1, 3], [1, 3])).toEqual([1, 2, 3])
  })

  it('falls back to the existing id if the new list runs short', () => {
    expect(applyVisibleOrder([1, 2], [1, 2], [2])).toEqual([2, 2])
  })
})

describe('firstTaskIdOn', () => {
  const today = '2026-07-15'

  it('picks the lowest-positioned task of the day', () => {
    expect(firstTaskIdOn([t(1, 1), t(2, -3), t(3, 0)], today)).toBe(2)
  })

  it('follows a reorder rather than creation order', () => {
    const before = [t(1, 0), t(2, 1)]
    expect(firstTaskIdOn(before, today)).toBe(1)
    const after = [t(1, 1), t(2, 0)]
    expect(firstTaskIdOn(after, today)).toBe(2)
  })

  it('ignores other days entirely', () => {
    expect(firstTaskIdOn([t(1, -9, '2026-07-14'), t(2, 5, today)], today)).toBe(2)
  })

  it('is null when today has no tasks', () => {
    expect(firstTaskIdOn([t(1, 0, '2026-07-16')], today)).toBeNull()
  })

  it('is null for an empty list', () => {
    expect(firstTaskIdOn([], today)).toBeNull()
  })

  it('reflects the list it is given, so a filtered-out task cannot win', () => {
    // `hide done` has already removed task 1; the highlight lands on what is
    // actually rendered at the top.
    expect(firstTaskIdOn([t(2, 1), t(3, 2)], today)).toBe(2)
  })
})
