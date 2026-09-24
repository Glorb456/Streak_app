import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { pickSelection } from './selection.js'
import Sidebar from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import MarkdownPage from './components/MarkdownPage.jsx'
import DrawingPage from './components/DrawingPage.jsx'

export default function App() {
  const [sections, setSections] = useState([])
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [activePageId, setActivePageId] = useState(null)
  const [page, setPage] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const tree = await api.tree()
      setSections(tree)
      setError('')
      return tree
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Land on something rather than an empty pane, and repair the selection
  // after a delete or a rename, without every handler having to work out what
  // should be selected next. The rule itself is in selection.js so it can be
  // unit-tested — in particular that Sticky Notes, which the server pins to
  // the top of the sidebar, is never what the notebook opens on.
  //
  // It runs against whatever tree is in state, which is why anything that
  // creates a section or a page refreshes the tree *before* moving the
  // selection: an id this has not heard of yet reads as stale and gets
  // "repaired" straight back to where it came from.
  useEffect(() => {
    const next = pickSelection(sections, activeSectionId, activePageId)
    if (next.sectionId !== activeSectionId) setActiveSectionId(next.sectionId)
    if (next.pageId !== activePageId) setActivePageId(next.pageId)
  }, [sections, activeSectionId, activePageId])

  // Content is fetched per page rather than shipped with the tree: the tree is
  // re-fetched on every save for the sidebar snippets, and carrying every
  // page's full body through that would grow with the notebook.
  useEffect(() => {
    let stale = false
    if (!activePageId) { setPage(null); return }
    api.page(activePageId)
      .then((p) => { if (!stale) setPage(p) })
      .catch((e) => { if (!stale) setError(e.message) })
    return () => { stale = true }
  }, [activePageId])

  // Every mutation goes through here, because every one of them has to hand
  // the new tree and the new selection to React *together*. Committing the
  // tree first and the selection a tick later — or the other way round —
  // leaves the repair effect above one render in which the id it is looking
  // at does not exist yet, and it faithfully repairs it back to whatever was
  // selected before. That is why a new page used not to open, and why a
  // rename bounced to the top of its section. Both setState calls sit in one
  // synchronous block, so React batches them into a single render.
  const mutate = async (fn, apply = () => {}) => {
    try {
      const result = await fn()
      const tree = await api.tree()
      setSections(tree)
      apply(result)
      setError('')
    } catch (e) {
      setError(e.message)
      await refresh()
    }
  }

  const addSection = () => mutate(
    () => api.createSection('New section'),
    (created) => {
      setActiveSectionId(created.id)
      setActivePageId(null)
      // The sidebar stays open: a new section is empty, so the next thing
      // wanted is the + Page button sitting right next to it.
    },
  )

  const addPage = (kind) => mutate(
    () => api.createPage(
      activeSectionId, kind === 'drawing' ? 'Untitled drawing' : 'Untitled Page', kind,
    ),
    (created) => {
      setActivePageId(created.id)
      setPage(created)
      // A new page is made to be written in, so it opens the way it will be
      // used: selected, and with the sidebar out of the way. That matters
      // most for a drawing, where the lists cost the canvas a third of an
      // iPad. The ⤡ button in the top bar brings the lists back.
      setSidebarOpen(false)
    },
  )

  const deleteSection = (s) => {
    if (!confirm(`Delete “${s.name}” and every page in it?`)) return
    mutate(() => api.deleteSection(s.id))
  }

  const deletePage = (p) => {
    if (!confirm(`Delete “${p.title}”?`)) return
    mutate(() => api.deletePage(p.id), () => {
      // Cleared against the fresh tree, so the repair lands on a page that
      // still exists rather than briefly re-opening the one just deleted.
      if (p.id === activePageId) { setActivePageId(null); setPage(null) }
    })
  }

  const savePage = async (content) => {
    setSaving(true)
    try {
      await api.updatePage(activePageId, { content })
      // Re-read the tree so the sidebar snippet catches up with the body.
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  // Drawings save differently in two ways. They send the etag they were read
  // at, so a save that lost a race to another device is refused rather than
  // silently overwriting it — the drawing merges and retries. And they skip
  // the tree refresh: a drawing has no sidebar snippet to update, so re-reading
  // every section on each autosave would be pure cost.
  const saveDrawing = useCallback(async (content, ifMatch) => {
    setSaving(true)
    try {
      return await api.updatePage(activePageId, { content, if_match: ifMatch })
    } finally {
      setSaving(false)
    }
  }, [activePageId])

  const reloadPage = useCallback(() => api.page(activePageId), [activePageId])

  // A rename moves the file, so the id changes with it and the selection has
  // to follow — otherwise the editor would be pointing at a path that is gone.
  // A 409, when another page already owns that filename, surfaces in the
  // banner instead of leaving the sidebar silently out of step with the title.
  const renamePage = (p, title) => mutate(
    () => api.updatePage(p.id, { title }),
    (updated) => {
      if (p.id === activePageId) { setActivePageId(updated.id); setPage(updated) }
    },
  )

  const renameSection = (s, name) => mutate(
    () => api.updateSection(s.id, { name }),
    (updated) => {
      if (s.id === activeSectionId) setActiveSectionId(updated.id)
    },
  )

  const recolorSection = (s, color) => mutate(() => api.updateSection(s.id, { color }))

  return (
    <div className={`notes-app ${sidebarOpen ? '' : 'collapsed'}`}>
      <Topbar
        title={page?.title ?? ''}
        sidebarOpen={sidebarOpen}
        saving={saving}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      {error && <div className="banner">{error}</div>}

      <div className="workspace">
        <Sidebar
          sections={sections}
          activeSectionId={activeSectionId}
          activePageId={activePageId}
          onSelectSection={(id) => { setActiveSectionId(id) }}
          onSelectPage={setActivePageId}
          onAddSection={addSection}
          onAddPage={addPage}
          onRenameSection={renameSection}
          onRenamePage={renamePage}
          onRecolorSection={recolorSection}
          onDeleteSection={deleteSection}
          onDeletePage={deletePage}
        />

        {/* Tapping the body maximizes the page and slides the sidebar away.
            It listens on the bubble, so clicking straight into a line of text
            both places the caret and clears the sidebar in one tap. */}
        <main
          className={`editor ${page?.kind === 'drawing' ? 'canvas' : ''}`}
          onClick={() => sidebarOpen && setSidebarOpen(false)}
        >
          {page?.kind === 'markdown' && (
            <MarkdownPage
              key={page.id}
              page={page}
              sidebarOpen={sidebarOpen}
              onSave={savePage}
              onRename={(title) => renamePage(page, title)}
            />
          )}
          {page?.kind === 'drawing' && (
            <DrawingPage
              key={page.id}
              page={page}
              sidebarOpen={sidebarOpen}
              onSave={saveDrawing}
              onReload={reloadPage}
              onUploadImage={api.uploadAsset}
              assetUrl={api.assetUrl}
              onRename={(title) => renamePage(page, title)}
            />
          )}
          {!page && (
            <div className="editor-empty">
              <p>{sections.length ? 'Pick a page, or make one with + Page.' : 'Start with + Section.'}</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
