import React, { useRef, useState } from 'react'
import { iso, monthWeeks, todayIso, DAY_NAMES, MONTH_NAMES } from '../dates.js'
import NotesEditor from './NotesEditor.jsx'

// New-task modal opens on the Category tab; editing an existing task opens
// on the Calendar tab with the task's current day highlighted dark red.
// Edits to an existing task apply immediately (Notion-style) — date/category/
// done on click, description/notes on blur and on close.
//
// Wide screens put the notes and the category/calendar pickers side by side,
// so both pickers are always visible and focusing the notes changes nothing but
// the caret. Narrow screens fall back to one column with a tab row, where
// focusing the notes expands them over the tab panel. Either way the backdrop
// dismisses in two stages, notes first and the modal second.
export default function TaskModal({ modal, categories, onSave, onLive, onDelete, onClose }) {
  const editing = modal.mode === 'edit' ? modal.task : null
  const [description, setDescription] = useState(editing?.description ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? null)
  const [dueDate, setDueDate] = useState(editing?.due_date ?? modal.date)
  const [done, setDone] = useState(editing?.done ?? false)
  const [tab, setTab] = useState(editing ? 'calendar' : 'category')
  const [notesExpanded, setNotesExpanded] = useState(false)

  const notesRef = useRef(null)
  const deleting = useRef(false)
  const saving = useRef(false)

  const initial = new Date(dueDate + 'T00:00:00')
  const [calYear, setCalYear] = useState(initial.getFullYear())
  const [calMonth, setCalMonth] = useState(initial.getMonth())
  const weeks = monthWeeks(calYear, calMonth)

  // Guarded so Enter-then-click (or a doubled Enter) can't create the same
  // task twice while the first POST is still in flight.
  const save = async () => {
    if (saving.current) return
    saving.current = true
    try {
      await onSave(
        { description, notes, category_id: categoryId, due_date: dueDate, done },
        editing
      )
    } finally {
      saving.current = false
    }
  }

  // Push the current state (plus the just-changed field, since setState is
  // async) straight to the server when editing an existing task. Skipped once
  // a delete is under way: a PUT racing the DELETE loses and 404s.
  const applyLive = (patch = {}) => {
    if (!editing || deleting.current) return
    onLive(editing, {
      description, notes, category_id: categoryId, due_date: dueDate, done,
      ...patch,
    })
  }

  const close = () => {
    applyLive()
    onClose()
  }

  // Read focus from the DOM rather than notesExpanded: mousedown fires before
  // focusout, so during a backdrop click the state has not caught up yet but
  // document.activeElement is already authoritative.
  const notesHasFocus = () =>
    !!notesRef.current && notesRef.current.contains(document.activeElement)
  const blurNotes = () => { if (notesHasFocus()) document.activeElement.blur() }

  // Buttons below the notes must not let their own mousedown collapse the
  // notes: the resulting reflow moves them out from under the pointer and the
  // click never fires. Suppressing the focus shift keeps the layout still.
  // The picker buttons carry it too. They are unreachable while the notes are
  // focused in the narrow layout, but in the wide one they sit beside live
  // notes, where blurring would fire an applyLive() PUT immediately followed by
  // the button's own — the same save, twice.
  const keepFocus = (e) => e.preventDefault()

  // Category squares padded to a full grid of equal-size tiles.
  const tiles = [...categories]
  while (tiles.length < 8 || tiles.length % 4 !== 0) tiles.push(null)

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (notesHasFocus()) {
          // Stage one: shrink the notes back down, leave the modal open.
          e.preventDefault()
          document.activeElement.blur()
          return
        }
        close()
      }}
    >
      <div className={`modal ${notesExpanded ? 'notes-expanded' : ''}`}>
        <div className="modal-header">
          <button
            className={`check-circle ${done ? 'checked' : ''}`}
            onMouseDown={keepFocus}
            onClick={() => { setDone(!done); applyLive({ done: !done }) }}
            aria-label="toggle done"
          />
          <input
            className="desc-input"
            placeholder="Description"
            value={description}
            autoFocus
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => applyLive()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              // New task: Enter is Save-and-close. Existing task: edits are
              // already live, so Enter just commits via the blur handler.
              if (editing) e.currentTarget.blur()
              else save()
            }}
          />
        </div>

        {/* Two columns on wide screens (notes left, both pickers right) and
            one flat column below that — the wrappers dissolve via
            display:contents, see the note in styles.css. */}
        <div className="modal-body">
          <div className="modal-notes">
            <NotesEditor
              value={notes}
              containerRef={notesRef}
              onChange={setNotes}
              onCommit={(v) => { setNotes(v); applyLive({ notes: v }) }}
              onFocusChange={setNotesExpanded}
              onBlur={() => applyLive()}
            />
          </div>

          {/* Both pickers stay mounted and `tab` only marks which one the
              narrow layout reveals, because the wide layout shows both at once
              and drops the tab row in CSS — so the tab state has to survive a
              resize in either direction. */}
          <div className="modal-picker">
            <div className="tabs">
              <button
                className={tab === 'calendar' ? 'active' : ''}
                onMouseDown={keepFocus}
                onClick={() => { blurNotes(); setTab('calendar') }}
              >
                Calendar
              </button>
              <button
                className={tab === 'category' ? 'active' : ''}
                onMouseDown={keepFocus}
                onClick={() => { blurNotes(); setTab('category') }}
              >
                Category
              </button>
            </div>

            <div className={`cat-grid ${tab === 'category' ? 'shown' : ''}`}>
              {tiles.map((c, i) =>
                c ? (
                  <button
                    key={c.id}
                    className={`cat-tile ${categoryId === c.id ? 'selected' : ''}`}
                    style={{ background: c.color }}
                    onMouseDown={keepFocus}
                    onClick={() => {
                      const next = categoryId === c.id ? null : c.id
                      setCategoryId(next)
                      applyLive({ category_id: next })
                    }}
                  >
                    {c.name}
                  </button>
                ) : (
                  <div key={`empty-${i}`} className="cat-tile empty" />
                )
              )}
            </div>

            <div className={`mini-cal ${tab === 'calendar' ? 'shown' : ''}`}>
              <div className="mini-cal-nav">
                <button onMouseDown={keepFocus} onClick={() => { const d = new Date(calYear, calMonth - 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()) }}>‹</button>
                <span>{MONTH_NAMES[calMonth]} {calYear}</span>
                <button onMouseDown={keepFocus} onClick={() => { const d = new Date(calYear, calMonth + 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()) }}>›</button>
              </div>
              <div className="mini-cal-grid">
                {DAY_NAMES.map((d) => <div key={d} className="mini-head">{d[0]}</div>)}
                {weeks.flat().map((d) => {
                  const dIso = iso(d)
                  return (
                    <button
                      key={dIso}
                      className={[
                        'mini-day',
                        d.getMonth() !== calMonth ? 'out' : '',
                        dIso === todayIso() ? 'today' : '',
                        dIso === dueDate ? 'selected-day' : '',
                      ].join(' ')}
                      onMouseDown={keepFocus}
                      onClick={() => { setDueDate(dIso); applyLive({ due_date: dIso }) }}
                    >
                      {d.getDate()}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          {editing && (
            <button
              className="danger"
              onMouseDown={keepFocus}
              onClick={() => { deleting.current = true; onDelete(editing) }}
            >
              Delete
            </button>
          )}
          <span className="spacer" />
          {editing ? (
            <button className="primary" onMouseDown={keepFocus} onClick={close}>Close</button>
          ) : (
            <>
              <button onMouseDown={keepFocus} onClick={onClose}>Cancel</button>
              <button className="primary" onMouseDown={keepFocus} onClick={save}>Save</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
