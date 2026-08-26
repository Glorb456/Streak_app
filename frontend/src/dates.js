export function iso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayIso() {
  return iso(new Date())
}

export function addDays(d, n) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

// Monday on/before the given date.
export function mondayOf(d) {
  const c = new Date(d)
  const shift = (c.getDay() + 6) % 7
  c.setDate(c.getDate() - shift)
  c.setHours(0, 0, 0, 0)
  return c
}

// Weeks (arrays of 7 Dates, Mon-Sun) covering the given month.
export function monthWeeks(year, month) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const weeks = []
  let cur = mondayOf(first)
  while (cur <= last) {
    const week = []
    for (let i = 0; i < 7; i++) week.push(addDays(cur, i))
    weeks.push(week)
    cur = addDays(cur, 7)
  }
  return weeks
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Every weekday set: the schedule a daily task has unless it says otherwise.
export const EVERY_DAY = 127

// 0 = Monday ... 6 = Sunday, indexing DAY_NAMES and the days_mask bit order.
export function weekdayIndex(dayIso) {
  return (new Date(dayIso + 'T00:00:00').getDay() + 6) % 7
}

// Daily tasks predating the schedule feature — and optimistic local objects
// that never round-tripped the server — count as scheduled every day. Uses ??
// rather than ||, since a mask of 0 is a real value meaning "parked".
export function scheduledOn(dailyTask, dayIso) {
  const mask = dailyTask.days_mask ?? EVERY_DAY
  return (mask & (1 << weekdayIndex(dayIso))) !== 0
}
