import React, { useLayoutEffect, useRef, useState } from 'react'
import { parseNotes, serializeNotes } from '../notes.js'

function autoGrow(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// Line-based notes editor. The ✓ toolbar button turns the line being typed
// into a checkable item (its text becomes the item's contents); clicking an
// item's circle greys it out and crosses off the text. Enter continues a
// checklist; Backspace at the start of an item turns it back into text.
//
// onChange fires for plain typing (saved on blur, like the old textarea);
// onCommit fires for structural/check changes that should persist right away.
export default function NotesEditor({
  value, containerRef, onChange, onCommit, onFocusChange, onBlur,
}) {
  const lines = parseNotes(value)
  const [focused, setFocused] = useState(0)
  const refs = useRef([])
  const pendingFocus = useRef(null)

  // Layout effect, not effect: merging the last line unmounts the focused
  // textarea, and anything watching focus would see it leave and come back
  // across a paint — a visible flicker plus a spurious save.
  useLayoutEffect(() => {
    const p = pendingFocus.current
    if (p) {
      pendingFocus.current = null
      const el = refs.current[p.index]
      if (el) {
        el.focus()
        el.setSelectionRange(p.pos, p.pos)
      }
    }
  })

  const update = (next, commit = false) => {
    const text = serializeNotes(next)
    ;(commit ? onCommit : onChange)(text)
  }

  const setLineText = (i, text) =>
    update(lines.map((l, j) => (j === i ? { ...l, text } : l)))

  const toggleType = () => {
    const i = Math.min(focused, lines.length - 1)
    const next = lines.map((l, j) =>
      j === i
        ? { type: l.type === 'check' ? 'text' : 'check', done: false, text: l.text }
        : l
    )
    pendingFocus.current = { index: i, pos: lines[i].text.length }
    update(next, true)
  }

  const toggleDone = (i) =>
    update(lines.map((l, j) => (j === i ? { ...l, done: !l.done } : l)), true)

  const onKeyDown = (e, i) => {
    const el = e.target
    const l = lines[i]
    if (e.key === 'Enter') {
      e.preventDefault()
      const pos = el.selectionStart
      const next = [
        ...lines.slice(0, i),
        { ...l, text: l.text.slice(0, pos) },
        { type: l.type, done: false, text: l.text.slice(pos) },
        ...lines.slice(i + 1),
      ]
      pendingFocus.current = { index: i + 1, pos: 0 }
      update(next)
    } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (l.type === 'check') {
        // Demote the item back to a plain text line.
        e.preventDefault()
        pendingFocus.current = { index: i, pos: 0 }
        update(
          lines.map((x, j) => (j === i ? { type: 'text', done: false, text: x.text } : x)),
          true
        )
      } else if (i > 0) {
        // Merge into the previous line.
        e.preventDefault()
        const prev = lines[i - 1]
        pendingFocus.current = { index: i - 1, pos: prev.text.length }
        update([
          ...lines.slice(0, i - 1),
          { ...prev, text: prev.text + l.text },
          ...lines.slice(i + 1),
        ])
      }
    }
  }

  return (
    // onFocus/onBlur are focusin/focusout and bubble, so without the
    // containment check every hop between two lines would count as leaving
    // the notes and fire a redundant save.
    <div
      className="notes-editor"
      ref={containerRef}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onFocusChange(true)
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return
        onFocusChange(false)
        onBlur()
      }}
    >
      <div className="notes-toolbar">
        <span className="notes-label">Notes</span>
        <button
          type="button"
          className="notes-check-btn"
          title="Make the current line a checkbox"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleType}
        >
          ✓
        </button>
      </div>
      {lines.map((l, i) => (
        <div key={i} className={`notes-line ${l.type} ${l.done ? 'done' : ''}`}>
          {l.type === 'check' && (
            <button
              type="button"
              className={`check-circle small ${l.done ? 'checked' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggleDone(i)}
              aria-label="toggle item"
            />
          )}
          <textarea
            ref={(el) => { refs.current[i] = el; autoGrow(el) }}
            rows={1}
            value={l.text}
            onChange={(e) => { autoGrow(e.target); setLineText(i, e.target.value) }}
            onKeyDown={(e) => onKeyDown(e, i)}
            onFocus={() => setFocused(i)}
          />
        </div>
      ))}
    </div>
  )
}
