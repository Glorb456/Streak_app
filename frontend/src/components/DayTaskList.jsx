import React from 'react'
import { todayIso } from '../dates.js'
import { useDragOrder } from '../useDragOrder.js'

// Mobile-only (shown via CSS below 640px): full-size, scrollable list of the
// selected day's tasks, since the calendar collapses to dots on phones.
// Tap the circle to toggle done, tap the card to edit, + to add, and drag the
// ☰ handle on the right to reorder the day.
export default function DayTaskList({
  selectedDay, tasks, hideDone, categories, firstTodayId,
  onToggleTask, onEditTask, onNewTask, onReorder, onDragActive,
}) {
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]))
  const dayTasks = tasks.filter((t) => t.due_date === selectedDay)
  const { setItemRef, dragProps, draggingId, wasDragged } = useDragOrder(
    dayTasks.map((t) => t.id),
    (ids) => onReorder(selectedDay, ids),
    onDragActive
  )
  const label =
    selectedDay === todayIso()
      ? 'Today'
      : new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
        })

  return (
    <div className="day-list">
      <div className="day-list-header">
        <span>Tasks — {label}</span>
        <button className="day-list-add" onClick={() => onNewTask(selectedDay)}>
          + Add
        </button>
      </div>
      <div className="day-list-items">
        {dayTasks.length === 0 && (
          <div className="day-list-empty">
            {hideDone ? 'Nothing left to do' : 'No tasks'}
          </div>
        )}
        {dayTasks.map((t) => {
          const cat = catById[t.category_id]
          return (
            <div
              key={t.id}
              ref={setItemRef(t.id)}
              className={[
                'day-list-item',
                t.done ? 'done' : '',
                t.id === firstTodayId ? 'first-today' : '',
                t.id === draggingId ? 'dragging' : '',
              ].join(' ')}
              // The pointerup that ends a drag still emits a click on the row,
              // which would open the task that was just dropped.
              onClick={() => { if (!wasDragged()) onEditTask(t) }}
            >
              <button
                className="check-circle"
                onClick={(e) => { e.stopPropagation(); onToggleTask(t) }}
                aria-label="toggle done"
              />
              <span className="task-desc">{t.description || '(untitled)'}</span>
              {cat && (
                <span className="task-cat" style={{ background: cat.color }}>
                  {cat.name}
                </span>
              )}
              {/* Rightmost, outside the category chip. touch-action:none in the
                  CSS is what stops the browser taking the gesture as a scroll;
                  without it a drag from here never reaches pointermove. */}
              <button
                type="button"
                className="drag-handle"
                aria-label="reorder task"
                onClick={(e) => e.stopPropagation()}
                {...dragProps(t.id)}
              >
                <span /><span /><span />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
