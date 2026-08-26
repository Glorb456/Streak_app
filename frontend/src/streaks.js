import { scheduledOn } from './dates.js'

// Day tint for the calendar: green as soon as every daily task scheduled for
// that day is completed (including today), and progressively redder the more
// were missed — red shades apply only to past days, since today isn't over
// yet. A day with nothing scheduled is left untinted: nothing was due, so
// nothing was missed (note the streak still counts such a day, so a neutral
// gap can sit inside a green run).
// Returns a CSS color string, or null for "no tint".
export function dayTint(dayIso, dailyTasks, completions, today) {
  if (dayIso > today) return null
  const due = dailyTasks.filter((dt) => scheduledOn(dt, dayIso))
  if (due.length === 0) return null
  const doneCount = due.filter((dt) =>
    completions.some((c) => c.daily_task_id === dt.id && c.day === dayIso && c.completed)
  ).length
  const missed = (due.length - doneCount) / due.length
  if (missed === 0) return 'rgba(76, 175, 80, 0.22)'
  if (dayIso === today) return null
  if (missed <= 1 / 3) return 'rgba(229, 115, 115, 0.18)'
  if (missed <= 2 / 3) return 'rgba(211, 47, 47, 0.30)'
  return 'rgba(150, 10, 10, 0.45)'
}
