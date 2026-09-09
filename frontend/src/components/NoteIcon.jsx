import React from 'react'

// Small Notion-style page glyph shown after a task's text when its notes
// field has content — a hint that opening the task has more to read.
// Drawn inline so it inherits currentColor (readable on done/highlighted
// cards alike) and costs no asset fetch.
export default function NoteIcon() {
  return (
    <svg
      className="note-icon"
      viewBox="0 0 16 16"
      width="11"
      height="11"
      aria-label="has notes"
      role="img"
    >
      <path d="M3.5 1.5h6L13 4.9v9.6h-9.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.3 1.8V5h3.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.5 8h5.2M5.5 10.4h5.2M5.5 12.8h3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

// Whether a task's notes carry anything worth flagging. Whitespace-only notes
// (a stray newline from the editor) don't count.
export function hasNotes(task) {
  return !!task.notes && task.notes.trim() !== ''
}
