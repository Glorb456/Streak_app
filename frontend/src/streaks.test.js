import { describe, it, expect } from 'vitest'
import { dayTint } from './streaks.js'

const GREEN = 'rgba(76, 175, 80, 0.22)'
const PALE_RED = 'rgba(229, 115, 115, 0.18)'
const RED = 'rgba(211, 47, 47, 0.30)'
const DEEP_RED = 'rgba(150, 10, 10, 0.45)'

const TASKS = [{ id: 1 }, { id: 2 }, { id: 3 }]
const TODAY = '2026-07-15'
const PAST = '2026-07-10'

// Completions marking the given task ids done on `day`.
const done = (day, ...ids) =>
  ids.map((id) => ({ daily_task_id: id, day, completed: true }))

describe('dayTint', () => {
  it('is null for future days', () => {
    expect(dayTint('2026-07-20', TASKS, [], TODAY)).toBeNull()
  })

  it('is null when there are no daily tasks', () => {
    expect(dayTint(PAST, [], [], TODAY)).toBeNull()
  })

  it('is green when every daily task is completed', () => {
    expect(dayTint(PAST, TASKS, done(PAST, 1, 2, 3), TODAY)).toBe(GREEN)
  })

  it('is green today too once everything is done', () => {
    expect(dayTint(TODAY, TASKS, done(TODAY, 1, 2, 3), TODAY)).toBe(GREEN)
  })

  it('never shows red for today, even with misses', () => {
    expect(dayTint(TODAY, TASKS, done(TODAY, 1), TODAY)).toBeNull()
  })

  it('is pale red for a past day with 1/3 missed', () => {
    expect(dayTint(PAST, TASKS, done(PAST, 1, 2), TODAY)).toBe(PALE_RED)
  })

  it('is red for a past day with 2/3 missed', () => {
    expect(dayTint(PAST, TASKS, done(PAST, 1), TODAY)).toBe(RED)
  })

  it('is deep red for a past day with everything missed', () => {
    expect(dayTint(PAST, TASKS, [], TODAY)).toBe(DEEP_RED)
  })

  it('ignores completions from other days', () => {
    // All three done, but on a different day -> counts as fully missed.
    expect(dayTint(PAST, TASKS, done('2026-07-09', 1, 2, 3), TODAY)).toBe(DEEP_RED)
  })
})

describe('dayTint with weekday schedules', () => {
  // 2026-07-10 is a Friday (bit 4); 2026-07-15 is a Wednesday (bit 2).
  const FRI_ONLY = 1 << 4
  const WED_ONLY = 1 << 2

  it('ignores tasks not scheduled on the day', () => {
    // Only task 1 is due on Friday, and it is done -> fully green, even
    // though tasks 2 and 3 have no completion at all.
    const tasks = [
      { id: 1, days_mask: FRI_ONLY },
      { id: 2, days_mask: WED_ONLY },
      { id: 3, days_mask: WED_ONLY },
    ]
    expect(dayTint(PAST, tasks, done(PAST, 1), TODAY)).toBe(GREEN)
  })

  it('is null when nothing is scheduled that day', () => {
    const tasks = [{ id: 1, days_mask: WED_ONLY }, { id: 2, days_mask: WED_ONLY }]
    expect(dayTint(PAST, tasks, [], TODAY)).toBeNull()
  })

  it('scores misses against the scheduled tasks only', () => {
    // Two due on Friday, one done -> 1/2 missed, which lands in the 2/3 band.
    const tasks = [
      { id: 1, days_mask: FRI_ONLY },
      { id: 2, days_mask: FRI_ONLY },
      { id: 3, days_mask: WED_ONLY },
    ]
    expect(dayTint(PAST, tasks, done(PAST, 1), TODAY)).toBe(RED)
  })

  it('does not tint a day green off an off-schedule completion', () => {
    // A Friday-only task marked done on a Wednesday leaves that Wednesday
    // with nothing due, so it stays neutral rather than reading as a win.
    const tasks = [{ id: 1, days_mask: FRI_ONLY }]
    expect(dayTint(TODAY, tasks, done(TODAY, 1), TODAY)).toBeNull()
  })
})
