import React, { useEffect, useRef, useState } from 'react'

// Both apps are served from one origin behind one oauth2-proxy session, so
// moving between them is a plain navigation — no second login, no token to
// hand over.
const STREAK_URL = '/'

export default function Topbar({ title, sidebarOpen, onToggleSidebar, saving }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => {
      // A target detached mid-click was an element React swapped out during
      // the click; that is an inside click even though contains() can't see it.
      if (!e.target.isConnected) return
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="app-name">Streak Notes</span>
        {saving && <span className="saving">saving…</span>}
      </div>

      <div className="topbar-title">{title}</div>

      <div className="topbar-right" ref={ref}>
        <div className="notes-settings">
          <button
            type="button"
            className="icon-btn"
            aria-label="settings"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            ⚙
          </button>
          {open && (
            <div className="dropdown">
              <button type="button" onClick={() => { window.location.href = STREAK_URL }}>
                Launch Streak
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleSidebar}
          aria-pressed={!sidebarOpen}
          title={sidebarOpen ? 'Maximize the page' : 'Show sections and pages'}
          aria-label={sidebarOpen ? 'Maximize the page' : 'Show sections and pages'}
        >
          {sidebarOpen ? '⤢' : '⤡'}
        </button>
      </div>
    </header>
  )
}
