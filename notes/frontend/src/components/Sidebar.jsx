import React, { useState } from 'react'
import ColorSwatch from './ColorSwatch.jsx'
import NewPageMenu from './NewPageMenu.jsx'

const NOTEBOOK = 'Streak Notes'
// The reference layout shows this line under every page title, so an empty
// page reads as empty rather than as a rendering failure.
const NO_TEXT = 'No additional text'

// Editable label: a single click selects the row, a double click renames it.
// Rename is inline rather than a dialog because the title *is* the filename,
// and seeing it in place is the only cue that renaming moves the file.
function Label({ value, className, onRename }) {
  const [draft, setDraft] = useState(null)

  if (draft === null) {
    return (
      <span className={className} onDoubleClick={(e) => { e.stopPropagation(); setDraft(value) }}>
        {value}
      </span>
    )
  }
  const commit = () => {
    setDraft(null)
    if (draft.trim() && draft.trim() !== value) onRename(draft.trim())
  }
  return (
    <input
      className={`${className} renaming`}
      value={draft}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

// A markdown page previews as its own first words at a readable-but-tiny size;
// a hand-drawn page has nothing to show yet, so its thumbnail stays blank.
function Thumb({ page }) {
  if (page.kind === 'drawing') return <div className="thumb blank" aria-hidden="true" />
  return (
    <div className="thumb" aria-hidden="true">
      <div className="thumb-text">{page.snippet}</div>
    </div>
  )
}

export default function Sidebar({
  sections, activeSectionId, activePageId,
  onSelectSection, onSelectPage,
  onAddSection, onAddPage, onRenameSection, onRenamePage,
  onRecolorSection, onDeleteSection, onDeletePage,
}) {
  const [picking, setPicking] = useState(false)
  const active = sections.find((s) => s.id === activeSectionId)
  const pages = active ? active.pages : []

  return (
    <aside className="sidebar">
      <div className="col sections-col">
        <div className="notebook-head">
          <span className="notebook-name">{NOTEBOOK}</span>
          <span className="notebook-dots" aria-hidden="true">•••</span>
        </div>

        {/* The accent rail is its own column so the swatches line up with the
            notebook's left edge, as in OneNote. Both columns render the same
            list at the same row height, which is what keeps them in step. */}
        <div className="rail-and-list">
          <div className="rail">
            {sections.map((s) => (
              <ColorSwatch
                key={s.id}
                className="chip"
                title="Section colour"
                value={s.color}
                onChange={(color) => onRecolorSection(s, color)}
              />
            ))}
          </div>

          <div className="section-list">
            {sections.map((s) => (
              <div
                key={s.id}
                className={`row section-row ${s.id === activeSectionId ? 'active' : ''}`}
                onClick={() => onSelectSection(s.id)}
              >
                <Label
                  className="section-name"
                  value={s.name}
                  onRename={(name) => onRenameSection(s, name)}
                />
                <button
                  type="button"
                  className="row-x"
                  title="Delete section"
                  onClick={(e) => { e.stopPropagation(); onDeleteSection(s) }}
                >
                  ✕
                </button>
              </div>
            ))}
            {sections.length === 0 && <div className="empty-hint">No sections yet</div>}
          </div>
        </div>

        <button type="button" className="add-btn" onClick={onAddSection}>
          <span className="plus">+</span> Section
        </button>
      </div>

      <div className="col pages-col">
        <div className="page-list">
          {pages.map((p) => (
            <div
              key={p.id}
              className={`page-row ${p.id === activePageId ? 'active' : ''}`}
              onClick={() => onSelectPage(p.id)}
            >
              <div className="page-text">
                <Label
                  className="page-title"
                  value={p.title}
                  onRename={(title) => onRenamePage(p, title)}
                />
                <div className={`page-snippet ${p.snippet ? '' : 'muted'}`}>
                  {p.snippet || NO_TEXT}
                </div>
              </div>
              <Thumb page={p} />
              <button
                type="button"
                className="row-x"
                title="Delete page"
                onClick={(e) => { e.stopPropagation(); onDeletePage(p) }}
              >
                ✕
              </button>
            </div>
          ))}
          {active && pages.length === 0 && <div className="empty-hint">No pages in this section</div>}
          {!active && <div className="empty-hint">Pick a section</div>}
        </div>

        <div className="add-wrap">
          <button
            type="button"
            className="add-btn"
            disabled={!active}
            title={active ? 'New page' : 'Create a section first'}
            onClick={(e) => { e.stopPropagation(); setPicking((v) => !v) }}
          >
            <span className="plus">+</span> Page
          </button>
          {picking && (
            <NewPageMenu
              onClose={() => setPicking(false)}
              onPick={(kind) => { setPicking(false); onAddPage(kind) }}
            />
          )}
        </div>
      </div>
    </aside>
  )
}
