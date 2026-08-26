import { describe, it, expect } from 'vitest'
import {
  iso, addDays, mondayOf, monthWeeks, weekdayIndex, scheduledOn,
  MONTH_NAMES, DAY_NAMES, EVERY_DAY,
} from './dates.js'

describe('iso', () => {
  it('zero-pads month and day', () => {
    expect(iso(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
  it('formats a two-digit month and day', () => {
    expect(iso(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(iso(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01')
  })
  it('crosses a year boundary', () => {
    expect(iso(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01')
  })
  it('goes backwards with a negative offset', () => {
    expect(iso(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31')
  })
  it('does not mutate its argument', () => {
    const d = new Date(2026, 5, 10)
    addDays(d, 5)
    expect(iso(d)).toBe('2026-06-10')
  })
})

describe('mondayOf', () => {
  it('returns the same day for a Monday', () => {
    // 2026-07-13 is a Monday.
    expect(iso(mondayOf(new Date(2026, 6, 13)))).toBe('2026-07-13')
  })
  it('returns the preceding Monday for a mid-week day', () => {
    // 2026-07-15 is a Wednesday.
    expect(iso(mondayOf(new Date(2026, 6, 15)))).toBe('2026-07-13')
  })
  it('treats Sunday as the end of the week, not the start', () => {
    // 2026-07-19 is a Sunday -> Monday of that week is the 13th.
    expect(iso(mondayOf(new Date(2026, 6, 19)))).toBe('2026-07-13')
  })
  it('zeroes the time component', () => {
    const m = mondayOf(new Date(2026, 6, 15, 23, 30, 15))
    expect([m.getHours(), m.getMinutes(), m.getSeconds()]).toEqual([0, 0, 0])
  })
})

describe('monthWeeks', () => {
  const weeks = monthWeeks(2026, 6) // July 2026

  it('returns rows of 7 Mon-Sun days', () => {
    for (const week of weeks) {
      expect(week).toHaveLength(7)
      expect(week[0].getDay()).toBe(1) // Monday
      expect(week[6].getDay()).toBe(0) // Sunday
    }
  })

  it('starts on the Monday on/before the first of the month', () => {
    // July 1 2026 is a Wednesday, so the grid starts Mon June 29.
    expect(iso(weeks[0][0])).toBe('2026-06-29')
  })

  it('covers every day of the month', () => {
    const all = weeks.flat().map(iso)
    for (let d = 1; d <= 31; d++) {
      expect(all).toContain(`2026-07-${String(d).padStart(2, '0')}`)
    }
  })

  it('has consecutive days across the whole grid', () => {
    const flat = weeks.flat()
    for (let i = 1; i < flat.length; i++) {
      expect(iso(flat[i])).toBe(iso(addDays(flat[i - 1], 1)))
    }
  })

  it('handles a December start without breaking the year', () => {
    // Dec 2026: last day is computed as new Date(2026, 12, 0) = Dec 31.
    const dec = monthWeeks(2026, 11).flat().map(iso)
    expect(dec).toContain('2026-12-31')
    expect(dec).toContain('2026-12-01')
  })

  it('handles February in a non-leap year', () => {
    const feb = monthWeeks(2026, 1).flat().map(iso)
    expect(feb).toContain('2026-02-28')
    expect(feb).not.toContain('2026-02-29')
  })
})

describe('weekdayIndex', () => {
  it('maps Monday to 0', () => {
    expect(weekdayIndex('2026-07-13')).toBe(0)
  })
  it('maps a mid-week day to its DAY_NAMES index', () => {
    // 2026-07-15 is a Wednesday.
    expect(weekdayIndex('2026-07-15')).toBe(2)
    expect(DAY_NAMES[weekdayIndex('2026-07-15')]).toBe('Wed')
  })
  it('maps Sunday to 6, not 0', () => {
    expect(weekdayIndex('2026-07-19')).toBe(6)
  })
  it('parses as local midnight, not UTC', () => {
    // A UTC parse would shift the day west of Greenwich and pick Sunday.
    expect(weekdayIndex('2026-07-13')).toBe(0)
  })
})

describe('scheduledOn', () => {
  const WED = '2026-07-15'
  const THU = '2026-07-16'

  it('treats a task with no mask as every day', () => {
    expect(scheduledOn({ id: 1 }, WED)).toBe(true)
    expect(scheduledOn({ id: 1 }, THU)).toBe(true)
  })
  it('is true for a day whose bit is set', () => {
    expect(scheduledOn({ days_mask: 1 << 2 }, WED)).toBe(true)
  })
  it('is false for a day whose bit is clear', () => {
    expect(scheduledOn({ days_mask: 1 << 2 }, THU)).toBe(false)
  })
  it('honours a mask of 0 rather than defaulting it away', () => {
    expect(scheduledOn({ days_mask: 0 }, WED)).toBe(false)
  })
  it('is true every day for EVERY_DAY', () => {
    const week = ['2026-07-13', '2026-07-14', WED, THU, '2026-07-17', '2026-07-18', '2026-07-19']
    for (const d of week) expect(scheduledOn({ days_mask: EVERY_DAY }, d)).toBe(true)
  })
})

describe('name tables', () => {
  it('has 12 months', () => {
    expect(MONTH_NAMES).toHaveLength(12)
    expect(MONTH_NAMES[0]).toBe('January')
  })
  it('has 7 weekdays starting Monday', () => {
    expect(DAY_NAMES).toHaveLength(7)
    expect(DAY_NAMES[0]).toBe('Mon')
    expect(DAY_NAMES[6]).toBe('Sun')
  })
})
