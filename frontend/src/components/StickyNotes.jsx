import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { notesApi } from '../api.js'
import NotesEditor from './NotesEditor.jsx'

// A sticky-note pad, in the shape of the pre-iOS 7 Notes app: leather bar,
// ruled yellow paper, handwriting. It lives only in the task app — Streak
// Notes is already a notes app and doesn't need a second one floating over it.
//
// It is opened from one yellow launcher bar that is rendered in ordinary
// document flow, directly under the day list. On a phone that is where it
// stays — a bar under today's tasks; from 641px up styles.css locks the same
// element to the bottom-right corner. One element, two layouts, so there is no
// second copy to keep in step.
//
// The notes themselves are stored in Streak Notes, in its app-owned "Sticky
// Notes" section, as ordinary markdown. Both apps sit behind one nginx and one
// oauth2-proxy session, so this is a plain fetch to the other app's API rather
// than a second store to keep in step.

const EDGE = 16
const GAP = 10       // between the launcher and the pad hung off it
const SAVE_DELAY = 700
const DEFAULT_TITLE = 'New Note'

/** The note's title is its first line, the way the old Notes app did it.
 *  A checklist marker is stripped so a note that opens with "- [ ] milk"
 *  is filed as "milk" rather than as punctuation. */
export function titleOf(text) {
  const first = (text || '').split('\n').find((l) => l.trim()) || ''
  const clean = first.replace(/^\s*-\s*\[[ xX]\]\s*/, '').trim()
  // The title is also the filename, so the characters the store would strip
  // are taken out here too — otherwise the note's name and its first line
  // would quietly disagree.
  return clean.replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 60) || DEFAULT_TITLE
}

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "Today" on the left, "May 20  6:52 PM" on the right, as the original did. */
export function stamp(ms) {
  const d = new Date(ms || Date.now())
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const day = sameDay(d, now) ? 'Today' : sameDay(d, yesterday) ? 'Yesterday' : date
  return { day, when: `${date}  ${time}`, short: sameDay(d, now) ? time : date }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))

// Drawn rather than set in emoji: the originals were thin brown line art, and
// an emoji trash can renders in full colour on every platform that has one.
const ChecklistIcon = () => (
  <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false">
    <path d="M3.2 7.4l2.1 2.1 3.6-4.2" />
    <path d="M12.2 7.6h8.6" />
    <path d="M3.2 16.6l2.1 2.1 3.6-4.2" />
    <path d="M12.2 16.8h8.6" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false">
    <path d="M3.8 6.1h16.4" />
    <path d="M9.4 6.1V4.3c0-.45.36-.8.8-.8h3.6c.44 0 .8.35.8.8v1.8" />
    <path d="M6.1 6.1l.95 13.3c.05.72.65 1.3 1.37 1.3h7.16c.72 0 1.32-.58 1.37-1.3l.95-13.3" />
    <path d="M10.1 9.6v7.6M13.9 9.6v7.6" />
  </svg>
)

export default function StickyNotes() {
  const [open, setOpen] = useState(false)
  // The launcher's viewport rect, remeasured while the pad is open: on the
  // phone layout the launcher is in flow and scrolls, on desktop it is pinned.
  const [anchor, setAnchor] = useState(null)
  const [view, setView] = useState('list')       // 'list' | 'note'
  const [section, setSection] = useState(null)
  const [notes, setNotes] = useState([])
  const [note, setNote] = useState(null)         // { id, title, content, updated }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const launchRef = useRef(null)
  const padRef = useRef(null)
  const noteRef = useRef(null)
  const savedRef = useRef('')
  const timerRef = useRef(null)
  const toggleRef = useRef(null)
  const paperRef = useRef(null)
  // A title the store refused because another note already has that filename.
  // Remembered so a note whose first line happens to match another's does not
  // retry the same doomed rename on every keystroke.
  const blockedTitleRef = useRef(null)
  noteRef.current = note

  // Layout effect, not effect: the pad's first render has no anchor yet, and
  // measuring before paint is what keeps it from being drawn in the fallback
  // corner and jumping. No scroll listener — the only layout that reads the
  // anchor is the desktop one, where the launcher is position:fixed and its
  // rect does not move with the page.
  useLayoutEffect(() => {
    if (!open) return undefined
    const measure = () => setAnchor(launchRef.current?.getBoundingClientRect() ?? null)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // ------------------------------------------------------------- saving

  const flushRef = useRef(async () => {})
  flushRef.current = async () => {
    const n = noteRef.current
    if (!n || n.content === savedRef.current) return
    const content = n.content
    savedRef.current = content
    const nextTitle = titleOf(content)
    const rename = nextTitle !== n.title && nextTitle !== blockedTitleRef.current
    try {
      let updated
      try {
        updated = await notesApi.updateNote(n.id, rename ? { content, title: nextTitle } : { content })
      } catch (e) {
        // Another note already owns that filename — two notes are allowed to
        // start with the same line even though two files cannot share a name.
        // The text matters more than the name: keep the old filename, save the
        // content, and stop offering that title until the first line changes.
        if (e.status !== 409) throw e
        blockedTitleRef.current = nextTitle
        updated = await notesApi.updateNote(n.id, { content })
      }
      setNote((cur) => (cur && cur.id === n.id
        ? { ...cur, id: updated.id, title: updated.title, updated: Date.now() }
        : cur))
      setError('')
    } catch (e) {
      savedRef.current = ''   // let the next attempt retry this text
      setError(e.message)
    }
  }

  const schedule = () => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flushRef.current(), SAVE_DELAY)
  }

  useEffect(() => {
    const bail = () => flushRef.current()
    window.addEventListener('pagehide', bail)
    return () => {
      window.removeEventListener('pagehide', bail)
      clearTimeout(timerRef.current)
      flushRef.current()
    }
  }, [])

  // -------------------------------------------------------------- data

  const loadSection = useCallback(async () => {
    const tree = await notesApi.tree()
    // The server materialises this section on any read, so it is always here —
    // there is no "create it first" path to get wrong.
    const sec = tree.find((s) => s.sticky) || null
    setSection(sec)
    setNotes(sec ? sec.pages : [])
    return sec
  }, [])

  const openNote = useCallback(async (summary) => {
    const page = await notesApi.page(summary.id)
    savedRef.current = page.content
    blockedTitleRef.current = null
    setNote({
      id: page.id,
      title: page.title,
      content: page.content,
      updated: (summary.updated_at || 0) * 1000,
    })
    setView('note')
  }, [])

  // Opening restores the note last written, the way the old app reopened where
  // you left off; with nothing saved yet it lands on the (empty) list.
  useEffect(() => {
    if (!open) return
    let stale = false
    setBusy(true)
    ;(async () => {
      try {
        const sec = await loadSection()
        const pages = sec?.pages ?? []
        if (stale) return
        if (pages.length) {
          await openNote([...pages].sort((a, b) => b.updated_at - a.updated_at)[0])
        } else {
          setNote(null)
          setView('list')
        }
        setError('')
      } catch (e) {
        if (!stale) setError(e.message)
      } finally {
        if (!stale) setBusy(false)
      }
    })()
    return () => { stale = true }
  }, [open, loadSection, openNote])

  const focusPaper = () => {
    // A new note should be ready to write in, the way tapping + used to be.
    requestAnimationFrame(() => paperRef.current?.querySelector('textarea')?.focus())
  }

  const newNote = async () => {
    await flushRef.current()
    setBusy(true)
    try {
      const sec = section || await loadSection()
      if (!sec) throw new Error('sticky notes section unavailable')
      const created = await notesApi.createNote(sec.id, DEFAULT_TITLE)
      savedRef.current = created.content
      blockedTitleRef.current = null
      setNote({ id: created.id, title: created.title, content: created.content, updated: Date.now() })
      setView('note')
      await loadSection()
      setError('')
      focusPaper()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const backToList = async () => {
    clearTimeout(timerRef.current)
    await flushRef.current()
    try { await loadSection() } catch (e) { setError(e.message) }
    setView('list')
  }

  const removeNote = async () => {
    const n = noteRef.current
    if (!n) return
    if (!confirm(`Delete “${n.title}”?`)) return
    clearTimeout(timerRef.current)
    savedRef.current = n.content   // don't resurrect it with a pending save
    try {
      await notesApi.deleteNote(n.id)
      setNote(null)
      setView('list')
      await loadSection()
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  // --------------------------------------------------------- open/close

  useEffect(() => {
    if (!open) return undefined
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])

  // A tap outside closes. On a phone the pad covers most of the screen and the
  // launcher is behind it, so without this there is no way back out — the old
  // floating icon sat above the pad and doubled as the close button.
  // The launcher is excluded because its own click already toggles; letting
  // this fire there too would close and immediately reopen.
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => {
      if (padRef.current?.contains(e.target)) return
      if (launchRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // The pad is clamped into the viewport either way. On a phone it is pinned to
  // the bottom of the screen rather than hung off the launcher: the launcher is
  // in flow there, so anchoring to it would fling the pad off-screen as soon as
  // the page was scrolled.
  const narrow = window.innerWidth <= 640
  const width = narrow ? window.innerWidth - EDGE * 2 : 340
  const height = Math.min(narrow ? window.innerHeight - EDGE * 3 : 560, window.innerHeight - EDGE * 2)
  const maxTop = Math.max(EDGE, window.innerHeight - height - EDGE)
  const right = anchor ? anchor.right : window.innerWidth - EDGE
  const above = anchor ? anchor.top : window.innerHeight - EDGE
  const panel = narrow
    ? { width, height, left: EDGE, top: maxTop }
    : {
        width,
        height,
        left: clamp(right - width, EDGE, Math.max(EDGE, window.innerWidth - width - EDGE)),
        top: clamp(above - height - GAP, EDGE, maxTop),
      }

  const when = stamp(note?.updated)

  return (
    <>
      {open && (
        <div className="sticky-pad" ref={padRef} style={panel}>
          <div className="sticky-bar">
            {view === 'note' ? (
              <button type="button" className="sticky-btn back" onClick={backToList}>
                Notes
              </button>
            ) : (
              <span className="sticky-btn-space" />
            )}
            <span className="sticky-title">{view === 'note' ? (note?.title ?? '') : 'Notes'}</span>
            <button
              type="button"
              className="sticky-btn plus"
              title="New note"
              onClick={newNote}
              disabled={busy}
            >
              +
            </button>
          </div>

          {error && <div className="sticky-error">{error}</div>}

          {view === 'note' && note && (
            <>
              {/* Tapping the empty paper below the text carries on writing,
                  the way tapping anywhere in the original note did. */}
              <div
                className="sticky-paper"
                ref={paperRef}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return
                  const boxes = paperRef.current?.querySelectorAll('textarea')
                  boxes?.[boxes.length - 1]?.focus()
                }}
              >
                <div className="sticky-stamp">
                  <span className="sticky-day">{when.day}</span>
                  <span className="sticky-when">{when.when}</span>
                </div>
                <NotesEditor
                  className="sticky-editor"
                  toolbar={false}
                  toggleRef={toggleRef}
                  value={note.content}
                  onChange={(content) => { setNote((n) => ({ ...n, content })); schedule() }}
                  onCommit={(content) => {
                    setNote((n) => ({ ...n, content }))
                    clearTimeout(timerRef.current)
                    // A ticked box is a decision, not a keystroke — write it now.
                    setTimeout(() => flushRef.current(), 0)
                  }}
                  onBlur={() => flushRef.current()}
                />
              </div>
              {/* The old toolbar's four buttons, cut to the two that do
                  something here: make the current line a checkbox, and bin the
                  note. Navigation is the Notes list above. */}
              <div className="sticky-tools">
                <button
                  type="button"
                  title="Make the current line a checkbox"
                  aria-label="Make the current line a checkbox"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleRef.current?.()}
                >
                  <ChecklistIcon />
                </button>
                <button
                  type="button"
                  className="danger"
                  title="Delete note"
                  aria-label="Delete note"
                  onClick={removeNote}
                >
                  <TrashIcon />
                </button>
              </div>
            </>
          )}

          {view === 'list' && (
            <div className="sticky-paper list">
              {notes.map((n) => {
                const s = stamp((n.updated_at || 0) * 1000)
                return (
                  <button key={n.id} type="button" className="sticky-row" onClick={() => openNote(n)}>
                    <span className="sticky-row-title">{n.title}</span>
                    <span className="sticky-row-when">{s.short}</span>
                  </button>
                )
              })}
              {!notes.length && !busy && (
                <div className="sticky-empty">No notes yet — tap + to start one.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ordinary flow, so on a phone it lands directly under the day list;
          styles.css pins the same element to the bottom-right corner from
          641px up. */}
      <button
        type="button"
        ref={launchRef}
        className={`sticky-launch ${open ? 'on' : ''}`}
        title="Quick notes"
        aria-label="Quick notes"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <img src="/icons/sticky_note_icon.png" alt="" draggable="false" />
        <span className="sticky-launch-label">Quick notes</span>
        <span className="sticky-launch-plus" aria-hidden="true">+</span>
      </button>
    </>
  )
}
