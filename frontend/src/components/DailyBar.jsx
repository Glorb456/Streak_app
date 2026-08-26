import React from 'react'
import { scheduledOn, todayIso } from '../dates.js'

// Up to 5 daily-task cards with pastel fill, showing the status of the
// selected day (today by default — single-click a day to inspect/edit it).
// Clicking the circle greys the box and crosses out the text.
//
// Only tasks scheduled for the selected weekday appear, and the cap applies
// after that filter so a light day still fills the bar.
export default function DailyBar({ dailyTasks, completions, selectedDay, onToggle }) {
  const today = todayIso()
  if (dailyTasks.length === 0) return null

  const shown = dailyTasks.filter((dt) => scheduledOn(dt, selectedDay)).slice(0, 5)

  const label =
    selectedDay === today
      ? 'Today'
      : new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
        })

  return (
    <div className="daily-bar">
      <div className="daily-day-label">{label}</div>
      {/* Keep the row rather than collapsing it: a bar that vanishes on a rest
          day reads as a bug and jumps the calendar up. */}
      {shown.length === 0 && <div className="daily-empty">Nothing scheduled</div>}
      {shown.map((dt) => {
        const done = completions.some(
          (c) => c.daily_task_id === dt.id && c.day === selectedDay && c.completed
        )
        return (
          <div
            key={dt.id}
            className={`daily-card ${done ? 'done' : ''}`}
            style={done ? {} : { background: dt.color }}
          >
            <button
              className="check-circle"
              onClick={() => onToggle(dt)}
              aria-label={`toggle ${dt.name}`}
            />
            <span className="daily-name">{dt.name}</span>
          </div>
        )
      })}
    </div>
  )
}
