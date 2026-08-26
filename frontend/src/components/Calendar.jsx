import React, { useEffect, useState } from 'react'
import { iso, todayIso, DAY_NAMES } from '../dates.js'
import { dayTint } from '../streaks.js'
import { useDragOrder } from '../useDragOrder.js'

// Phone-width viewports collapse task cards into colored dots.
function useCompact() {
  const [compact, setCompact] = useState(
    () => window.matchMedia('(max-width: 640px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const onChange = (e) => setCompact(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return compact
}

// One day's cards, as its own component so each day gets its own drag session
// — useDragOrder can't be called from inside the day loop.
//
// The whole card is the drag surface here rather than a handle: this only ever
// renders above 640px, where the pointer is a mouse and the card carries no
// competing gesture (edit is a *double* click). That is also why there is no ☰
// on the calendar — the desktop UI is meant to look exactly as it did.
function DayCards({ dayIso, tasks, catById, firstTodayId, onToggleTask, onEditTask, onReorder, onDragActive }) {
  const { setItemRef, dragProps, draggingId, wasDragged } = useDragOrder(
    tasks.map((t) => t.id),
    (ids) => onReorder(dayIso, ids),
    onDragActive
  )

  return tasks.map((t) => {
    const cat = catById[t.category_id]
    return (
      <div
        key={t.id}
        ref={setItemRef(t.id)}
        className={[
          'task-card',
          t.done ? 'done' : '',
          t.id === firstTodayId ? 'first-today' : '',
          t.id === draggingId ? 'dragging' : '',
        ].join(' ')}
        // Two drags in quick succession can still land a dblclick; wasDragged
        // keeps that from opening the card that was being moved.
        onDoubleClick={(e) => { e.stopPropagation(); if (!wasDragged()) onEditTask(t) }}
        {...dragProps(t.id)}
      >
        <button
          className="check-circle small"
          onClick={(e) => { e.stopPropagation(); onToggleTask(t) }}
          aria-label="toggle done"
        />
        <div className="task-body">
          <span className="task-desc">{t.description || '(untitled)'}</span>
          {cat && (
            <span className="task-cat" style={{ background: cat.color }}>
              {cat.name}
            </span>
          )}
        </div>
      </div>
    )
  })
}

export default function Calendar({
  weeks, month, tasks, categories, dailyTasks, completions,
  selectedDay, firstTodayId, onSelectDay, onToggleTask, onEditTask, onNewTask,
  onReorder, onDragActive,
}) {
  const today = todayIso()
  const compact = useCompact()
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]))
  const tasksByDay = {}
  for (const t of tasks) (tasksByDay[t.due_date] ??= []).push(t)

  return (
    <div className="calendar">
      <div className="weekday-row">
        {DAY_NAMES.map((d) => <div key={d} className="weekday">{d}</div>)}
      </div>
      {weeks.map((week, wi) => {
        // Week height grows with the busiest day in that week.
        const maxTasks = Math.max(1, ...week.map((d) => (tasksByDay[iso(d)] || []).length))
        const minHeight = compact ? 52 : 56 + maxTasks * 46
        return (
          <div key={wi} className="week-row" style={{ minHeight }}>
            {week.map((d) => {
              const dIso = iso(d)
              const dayTasks = tasksByDay[dIso] || []
              const tint = dayTint(dIso, dailyTasks, completions, today)
              const isToday = dIso === today
              const inMonth = d.getMonth() === month
              return (
                <div
                  key={dIso}
                  className={[
                    'day-cell',
                    inMonth ? '' : 'out-month',
                    dIso === selectedDay ? 'selected' : '',
                  ].join(' ')}
                  style={tint ? { background: tint } : {}}
                  onClick={() => onSelectDay(dIso)}
                  onDoubleClick={(e) => {
                    if (e.target === e.currentTarget) onNewTask(dIso)
                  }}
                >
                  <div className={`day-num ${isToday ? 'today' : ''}`}>{d.getDate()}</div>
                  {compact ? (
                    dayTasks.length > 0 && (
                      <div className="task-dots">
                        {dayTasks.map((t) => (
                          // Not interactive on mobile: tapping bubbles to the
                          // cell, selecting the day; the list below the
                          // calendar is where tasks are opened, edited and
                          // reordered.
                          <span
                            key={t.id}
                            className={`task-dot ${t.done ? 'done' : ''}`}
                            style={{ background: catById[t.category_id]?.color || '#8a8a8a' }}
                          />
                        ))}
                      </div>
                    )
                  ) : (
                    <DayCards
                      dayIso={dIso}
                      tasks={dayTasks}
                      catById={catById}
                      firstTodayId={firstTodayId}
                      onToggleTask={onToggleTask}
                      onEditTask={onEditTask}
                      onReorder={onReorder}
                      onDragActive={onDragActive}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
