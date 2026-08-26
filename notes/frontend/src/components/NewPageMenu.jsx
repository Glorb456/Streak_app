import React, { useEffect, useRef } from 'react'

// The '+ Page' button asks which kind first, because the two are different
// files on disk (.md vs .draw.json) and a page cannot change kind afterwards.
export default function NewPageMenu({ onPick, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    // 'click', not 'mousedown', to match the settings menu in the task app:
    // mousedown would unmount the buttons before their click handlers ran.
    document.addEventListener('click', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div className="kind-menu" ref={ref} role="menu">
      <div className="kind-title">New page</div>
      <button type="button" onClick={() => onPick('markdown')}>
        <span className="kind-glyph">¶</span>
        <span className="kind-text">
          <strong>Markdown</strong>
          <small>Renders as you type, saved as a .md file</small>
        </span>
      </button>
      <button type="button" onClick={() => onPick('drawing')}>
        <span className="kind-glyph">✎</span>
        <span className="kind-text">
          <strong>Hand-drawn</strong>
          <small>Blank canvas — placeholder for now</small>
        </span>
      </button>
    </div>
  )
}
