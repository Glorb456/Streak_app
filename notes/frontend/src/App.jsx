import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
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

  // Land on something rather than an empty pane: first section, first page.
  // Also repairs the selection after a delete, without needing every handler
  // to work out what should be selected next. The app-owned Sticky Notes
  // section is skipped as a default — it belongs to the task app's widget,
  // not to whoever just opened their notebook — unless it is all there is.
  useEffect(() => {
    if (!sections.length) { setActiveSectionId(null); setActivePageId(null); return }
    const fallback = sections.find((s) => !s.sticky) || sections[0]
    const current = sections.find((s) => s.id === activeSectionId) || fallback
    if (current.id !== activeSectionId) setActiveSectionId(current.id)
    if (!current.pages.some((p) => p.id === activePageId)) {
      setActivePageId(current.pages[0]?.id ?? null)
    }
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

  const run = async (fn) => {
    try { await fn(); setError('') }
    catch (e) { setError(e.message) }
    await refresh()
  }

  const addSection = () => run(async () => {
    const s = await api.createSection('New section')
    setActiveSectionId(s.id)
    setActivePageId(null)
  })

  const addPage = (kind) => run(async () => {
    const created = await api.createPage(
      activeSectionId, kind === 'drawing' ? 'Untitled drawing' : 'Untitled Page', kind
    )
    setActivePageId(created.id)
    setPage(created)
    // A brand new page is the one moment the sidebar is not what you want to
    // look at, but hiding it here would also hide the page you just made in
    // its list — so it stays, and the first tap in the body maximizes.
  })

  const deleteSection = (s) => {
    if (!confirm(`Delete “${s.name}” and every page in it?`)) return
    run(() => api.deleteSection(s.id))
  }

  const deletePage = (p) => {
    if (!confirm(`Delete “${p.title}”?`)) return
    run(async () => {
      await api.deletePage(p.id)
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
  const renamePage = async (p, title) => {
    try {
      const updated = await api.updatePage(p.id, { title })
      if (p.id === activePageId) { setActivePageId(updated.id); setPage(updated) }
      setError('')
    } catch (e) {
      // e.g. a 409 when another page already owns that filename — surface it
      // instead of leaving the sidebar silently out of step with the title.
      setError(e.message)
    }
    await refresh()
  }

  const renameSection = (s, name) => run(async () => {
    const updated = await api.updateSection(s.id, { name })
    if (s.id === activeSectionId) setActiveSectionId(updated.id)
  })

  const recolorSection = (s, color) => run(() => api.updateSection(s.id, { color }))

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
