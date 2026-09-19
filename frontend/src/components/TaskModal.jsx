import React, { useEffect, useRef, useState } from 'react'
import { iso, monthWeeks, todayIso, DAY_NAMES, MONTH_NAMES } from '../dates.js'
import NotesEditor from './NotesEditor.jsx'

// Buttons inside the modal must not let their own mousedown move focus: in the
// narrow layout the resulting notes collapse reflows the button out from under
// the pointer and the click never fires, and in the wide layout, where the
// pickers sit beside live notes, blurring would fire an applyLive() PUT
// immediately followed by the button's own — the same save, twice.
const keepFocus = (e) => e.preventDefault()

const prettyDate = (dIso) => {
  const d = new Date(dIso + 'T00:00:00')
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

const SelectIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="3.5" width="13" height="4" rx="2" stroke="currentColor" />
    <rect x="1.5" y="9.5" width="9" height="4" rx="2" stroke="currentColor" />
  </svg>
)

const DateIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" />
    <path d="M1.5 6.5h13M5 1.5v2M11 1.5v2" stroke="currentColor" />
  </svg>
)

// Notion's select property: the value reads as a coloured chip and clicking it
// drops a searchable list underneath. The menu owns its own outside-click
// handling and swallows that mousedown, so the first click off the menu closes
// the menu only — the backdrop behind it does not also close the modal.
function CategorySelect({ categories, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

  const selected = categories.find((c) => c.id === value) || null
  const q = query.trim().toLowerCase()
  const shown = q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories

  const dismiss = () => {
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }
  const pick = (id) => {
    dismiss()
    onChange(id)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target)) return
      e.stopPropagation()
      setOpen(false)
      setQuery('')
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      dismiss()
    }
    // Capture phase: React's own listeners sit on the app root, below document,
    // so stopping here keeps the click from reaching the backdrop.
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // The menu is absolutely positioned inside a column that can scroll; nudge
  // that column when it opens clipped. A fully visible menu moves nothing.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() =>
      menuRef.current?.scrollIntoView({ block: 'nearest' })
    )
    return () => cancelAnimationFrame(id)
  }, [open])

  return (
    <div className="prop-value" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`prop-select ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={() => (open ? dismiss() : setOpen(true))}
      >
        {selected ? (
          <span className="cat-chip" style={{ background: selected.color }}>{selected.name}</span>
        ) : (
          <span className="prop-empty">Empty</span>
        )}
        <span className="prop-caret">▾</span>
      </button>

      {open && (
        <div className="prop-menu" ref={menuRef}>
          <div className="prop-menu-search">
            <input
              autoFocus
              value={query}
              placeholder="Search for a category…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (shown.length) pick(shown[0].id)
              }}
            />
          </div>
          <div className="prop-menu-label">Select a category</div>
          <div className="prop-menu-list">
            {shown.map((c) => (
              <button
                key={c.id}
                type="button"
                className="prop-menu-item"
                onMouseDown={keepFocus}
                onClick={() => pick(value === c.id ? null : c.id)}
              >
                <span className="cat-chip" style={{ background: c.color }}>{c.name}</span>
                {value === c.id && <span className="prop-menu-check">✓</span>}
              </button>
            ))}
            {!shown.length && (
              <div className="prop-menu-empty">
                {categories.length ? 'No categories match' : 'No categories yet — add them in settings'}
              </div>
            )}
          </div>
          <button
            type="button"
            className="prop-menu-clear"
            onMouseDown={keepFocus}
            onClick={() => pick(null)}
          >
            Clear category
          </button>
        </div>
      )}
    </div>
  )
}

// New-task and edit-task modal, laid out the way a Notion page is: a big
// left-aligned title, then the properties (category as a dropdown, deadline),
// then the note body. Edits to an existing task apply immediately — date/
// category/done on click, description/notes on blur and on close.
//
// Wide screens put the notes and the property/calendar column side by side.
// Narrow screens fall back to one column, where focusing the notes expands them
// over the properties and the calendar. Either way the backdrop dismisses in
// two stages, notes first and the modal second.
export default function TaskModal({ modal, categories, onSave, onLive, onDelete, onClose }) {
  const editing = modal.mode === 'edit' ? modal.task : null
  const [description, setDescription] = useState(editing?.description ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? null)
  const [dueDate, setDueDate] = useState(editing?.due_date ?? modal.date)
  const [done, setDone] = useState(editing?.done ?? false)
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
            placeholder="Untitled"
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

        {/* Two columns on wide screens (notes left, properties and calendar
            right) and one flat column below that — the wrappers dissolve via
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

          <div className="modal-picker">
            <div className="modal-props">
              <div className="prop-row">
                <span className="prop-label"><SelectIcon />Category</span>
                <CategorySelect
                  categories={categories}
                  value={categoryId}
                  onChange={(next) => { setCategoryId(next); applyLive({ category_id: next }) }}
                />
              </div>
              <div className="prop-row">
                <span className="prop-label"><DateIcon />Deadline</span>
                <span className="prop-static">{prettyDate(dueDate)}</span>
              </div>
            </div>

            <div className="mini-cal">
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
