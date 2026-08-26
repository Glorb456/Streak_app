import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import DrawToolbar from './DrawToolbar.jsx'
import { parseDoc, serializeDoc } from '../draw/codec.js'
import {
  addElements, elementBox, growPage, makeImage, makeStroke, mergeDocs,
  removeElements, replaceElement, selectInLasso, selectionBox, translateElements,
} from '../draw/doc.js'
import { objectErase, pixelEraseStroke } from '../draw/erase.js'
import { boxContains, simplify } from '../draw/geometry.js'
import {
  applyView, clearLayer, drawDoc, drawElement, drawEraserCursor, drawLasso,
  drawSelectionBox, livePath,
} from '../draw/render.js'
import { activePencil, loadTools, saveTools } from '../draw/tools.js'

const SAVE_DELAY = 900
const UNDO_LIMIT = 60
const MAX_DPR = 3      // an iPhone reports 3; above that is all cost, no gain
const GROW_MARGIN = 240

const IDLE = { kind: '', text: '' }

export default function DrawingPage({
  page, sidebarOpen, onSave, onReload, onUploadImage, assetUrl, onRename,
}) {
  const [doc, setDoc] = useState(() => parseDoc(page.content))
  const [tools, setTools] = useState(loadTools)
  const [selection, setSelection] = useState([])
  const [status, setStatus] = useState(IDLE)
  const [title, setTitle] = useState(page.title)
  const [depth, setDepth] = useState({ undo: 0, redo: 0 })

  const stageRef = useRef(null)
  const baseRef = useRef(null)
  const liveRef = useRef(null)
  const baseCtx = useRef(null)
  const liveCtx = useRef(null)

  // The document, the view and the in-flight gesture all live in refs: pointer
  // handlers run at the pen's sample rate and must never wait on a React
  // render to see the current state.
  const docRef = useRef(doc)
  const viewRef = useRef({ dpr: 1, scale: 1, scrollY: 0, vw: 0, vh: 0 })
  const gestureRef = useRef(null)
  const hiddenRef = useRef(new Set())
  const selectionRef = useRef([])
  const toolsRef = useRef(tools)
  const imagesRef = useRef(new Map())
  const undoRef = useRef([])
  const redoRef = useRef([])
  const etagRef = useRef(page.etag)
  const savedRef = useRef(serializeDoc(doc))
  const timerRef = useRef(null)
  const rafRef = useRef(0)
  const savingRef = useRef(false)

  docRef.current = doc
  selectionRef.current = selection
  toolsRef.current = tools

  useEffect(() => { saveTools(tools) }, [tools])

  // ---------------------------------------------------------- painting

  const getImage = useCallback((asset) => {
    const cache = imagesRef.current
    let img = cache.get(asset)
    if (!img) {
      img = new Image()
      // Repaint when it lands: the element already holds its place on the
      // page, so the bitmap arriving must not shift anything.
      img.onload = () => redrawBase()
      img.src = assetUrl(asset)
      cache.set(asset, img)
    }
    return img.complete && img.naturalWidth ? img : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetUrl])

  const redrawBase = useCallback(() => {
    const canvas = baseRef.current
    const ctx = baseCtx.current
    if (!canvas || !ctx) return
    drawDoc(ctx, canvas, docRef.current, viewRef.current, getImage, hiddenRef.current)
  }, [getImage])

  const paintOverlay = useCallback(() => {
    const canvas = liveRef.current
    const ctx = liveCtx.current
    if (!canvas || !ctx) return
    clearLayer(ctx, canvas)
    applyView(ctx, viewRef.current)
    const g = gestureRef.current

    if (g?.kind === 'draw' && g.points.length) {
      const pencil = g.pencil
      ctx.save()
      ctx.globalAlpha = pencil.opacity ?? 1
      ctx.fillStyle = pencil.color
      // Predicted samples are drawn but never committed: they put ink under
      // the pen tip a frame or two before the real samples arrive, which is
      // most of the perceived latency on a touch device.
      ctx.fill(livePath(g.points.concat(g.predicted), pencil.size))
      ctx.restore()
    }
    if (g?.kind === 'lasso') drawLasso(ctx, g.poly)
    if (g?.kind === 'move') {
      const ids = new Set(g.ids)
      ctx.save()
      ctx.translate(g.dx, g.dy)
      for (const el of docRef.current.elements) {
        if (ids.has(el.id)) drawElement(ctx, el, getImage)
      }
      ctx.restore()
      const box = selectionBox(docRef.current, ids)
      if (box) drawSelectionBox(ctx, { ...box, x: box.x + g.dx, y: box.y + g.dy })
    }
    if (g?.kind === 'erase' && g.mode === 'pixel' && g.at) {
      drawEraserCursor(ctx, g.at, g.radius)
    }
    if (!g && selectionRef.current.length) {
      drawSelectionBox(ctx, selectionBox(docRef.current, selectionRef.current))
    }
  }, [getImage])

  /** Coalesce every repaint request in a frame into one. */
  const scheduleOverlay = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      paintOverlay()
    })
  }, [paintOverlay])

  // ------------------------------------------------------------- view

  const clampScroll = useCallback((y) => {
    const v = viewRef.current
    const viewH = v.scale ? v.vh / v.scale : 0
    return Math.min(Math.max(0, docRef.current.page.h - viewH), Math.max(0, y))
  }, [])

  const setScroll = useCallback((y) => {
    const v = viewRef.current
    const next = clampScroll(y)
    if (next === v.scrollY) return
    v.scrollY = next
    redrawBase()
    scheduleOverlay()
    setDepth((d) => ({ ...d })) // repaint the scrollbar thumb
  }, [clampScroll, redrawBase, scheduleOverlay])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    baseCtx.current = baseRef.current.getContext('2d')
    liveCtx.current = liveRef.current.getContext('2d')

    const resize = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      const w = stage.clientWidth
      const h = stage.clientHeight
      if (!w || !h) return
      for (const c of [baseRef.current, liveRef.current]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        c.style.width = `${w}px`
        c.style.height = `${h}px`
      }
      // Page units are fixed; the view scales to fit. This is what makes the
      // same file open crisp on a 3x iPad and a 1x monitor — the document is
      // never rasterised, only the view is.
      viewRef.current = { ...viewRef.current, dpr, scale: w / docRef.current.page.w, vw: w, vh: h }
      viewRef.current.scrollY = clampScroll(viewRef.current.scrollY)
      redrawBase()
      paintOverlay()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(stage)
    resize()

    // Non-passive: the wheel has to be prevented, or the page behind the
    // canvas scrolls instead of the drawing.
    const onWheel = (e) => {
      e.preventDefault()
      setScroll(viewRef.current.scrollY + e.deltaY / viewRef.current.scale)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      stage.removeEventListener('wheel', onWheel)
    }
  }, [clampScroll, paintOverlay, redrawBase, setScroll])

  // ------------------------------------------------------- doc changes

  const pushUndo = useCallback(() => {
    undoRef.current.push(docRef.current)
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()
    redoRef.current = []
  }, [])

  const scheduleSave = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flushRef.current(), SAVE_DELAY)
  }, [])

  const applyDoc = useCallback((next, { save = true } = {}) => {
    docRef.current = next
    setDoc(next)
    redrawBase()
    scheduleOverlay()
    if (save) scheduleSave()
  }, [redrawBase, scheduleOverlay, scheduleSave])

  const undo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(docRef.current)
    setSelection([])
    applyDoc(prev)
    setDepth({ undo: undoRef.current.length, redo: redoRef.current.length })
  }, [applyDoc])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(docRef.current)
    setSelection([])
    applyDoc(next)
    setDepth({ undo: undoRef.current.length, redo: redoRef.current.length })
  }, [applyDoc])

  const commit = useCallback((next) => {
    applyDoc(next)
    setDepth({ undo: undoRef.current.length, redo: redoRef.current.length })
  }, [applyDoc])

  // ------------------------------------------------------------- sync

  // A ref, so the debounce timer and the event listeners below always call the
  // current version without re-registering on every document change.
  const flushRef = useRef(async () => {})
  flushRef.current = async () => {
    const text = serializeDoc(docRef.current)
    if (text === savedRef.current || savingRef.current) return
    savingRef.current = true
    setStatus({ kind: 'busy', text: 'saving…' })
    let payload = text
    try {
      // Three attempts, because each conflict resolves one competing save and
      // a fourth in the same second means something else is wrong.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const updated = await onSave(payload, etagRef.current)
          etagRef.current = updated.etag
          savedRef.current = payload
          setStatus(IDLE)
          return
        } catch (e) {
          if (!e.current) throw e
          // Another device saved first. Merge rather than overwrite, and try
          // again at the etag it just told us about.
          const merged = mergeDocs(docRef.current, parseDoc(e.current.content))
          etagRef.current = e.current.etag
          docRef.current = merged
          setDoc(merged)
          redrawBase()
          payload = serializeDoc(merged)
        }
      }
      setStatus({ kind: 'error', text: 'still syncing…' })
    } catch (e) {
      setStatus({ kind: 'error', text: e.message })
    } finally {
      savingRef.current = false
    }
  }

  // Pull on focus rather than on a timer. A drawing open in a background tab
  // costs nothing, and the main Streak app's own 5 s poll is untouched by any
  // of this — different app, different backend, no shared loop.
  useEffect(() => {
    const sync = async () => {
      if (document.visibilityState !== 'visible') return
      await flushRef.current()
      try {
        const fresh = await onReload()
        if (!fresh || fresh.etag === etagRef.current) return
        const merged = mergeDocs(docRef.current, parseDoc(fresh.content))
        etagRef.current = fresh.etag
        docRef.current = merged
        setDoc(merged)
        redrawBase()
        scheduleOverlay()
        // Push the merge back so the other device converges too.
        scheduleSave()
      } catch { /* offline: the local copy stands, and saves again on return */ }
    }
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [onReload, redrawBase, scheduleOverlay, scheduleSave])

  useEffect(() => {
    const bail = () => flushRef.current()
    window.addEventListener('pagehide', bail)
    return () => {
      window.removeEventListener('pagehide', bail)
      clearTimeout(timerRef.current)
      flushRef.current()
    }
  }, [])

  // ---------------------------------------------------------- pointers

  const toPage = useCallback((e) => {
    const r = stageRef.current.getBoundingClientRect()
    const v = viewRef.current
    return {
      x: (e.clientX - r.left) / v.scale,
      y: (e.clientY - r.top) / v.scale + v.scrollY,
    }
  }, [])

  /** Pressure for a sample.
   *
   *  A pencil reports it directly. A mouse and a finger do not, so width comes
   *  from speed instead — a fast flick thins out the way a real pen does, and
   *  a slow deliberate line stays full width. */
  const pressureOf = (e, g, point) => {
    if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure
    const last = g.points[g.points.length - 1]
    if (!last) return 0.7
    const speed = Math.hypot(point.x - last.x, point.y - last.y)
    const target = Math.max(0.35, Math.min(1, 1 - speed * 0.02))
    return last.p + (target - last.p) * 0.3
  }

  const applyErase = useCallback((from, to) => {
    const t = toolsRef.current
    let next = docRef.current
    if (t.eraserMode === 'object') {
      const ids = objectErase(next, from, to, t.eraserSize / 2)
      if (ids.length) next = removeElements(next, ids)
    } else {
      const radius = t.eraserSize / 2
      for (const el of [...next.elements]) {
        const pieces = pixelEraseStroke(el, from, to, radius)
        if (pieces === null) continue
        next = replaceElement(next, el.id, pieces)
      }
    }
    if (next !== docRef.current) applyDoc(next)
  }, [applyDoc])

  const onPointerDown = (e) => {
    const stage = stageRef.current
    // Fingers scroll, the pencil draws — which is also the palm rejection:
    // a palm arrives as pointerType 'touch' and can only ever pan.
    if (e.pointerType === 'touch') {
      gestureRef.current = {
        kind: 'pan', id: e.pointerId, startY: e.clientY, startScroll: viewRef.current.scrollY,
      }
      stage.setPointerCapture(e.pointerId)
      return
    }
    e.preventDefault()
    stage.setPointerCapture(e.pointerId)
    const p = toPage(e)
    const t = toolsRef.current

    if (t.kind === 'lasso') {
      const box = selectionRef.current.length
        ? selectionBox(docRef.current, selectionRef.current)
        : null
      // Starting inside an existing selection moves it; anywhere else starts
      // a new loop. Same gesture split every lasso tool uses.
      if (box && boxContains({ x: box.x - 8, y: box.y - 8, w: box.w + 16, h: box.h + 16 }, p)) {
        pushUndo()
        hiddenRef.current = new Set(selectionRef.current)
        gestureRef.current = {
          kind: 'move', id: e.pointerId, ids: selectionRef.current, from: p, dx: 0, dy: 0,
        }
        redrawBase()
        scheduleOverlay()
        return
      }
      setSelection([])
      selectionRef.current = []
      gestureRef.current = { kind: 'lasso', id: e.pointerId, poly: [[p.x, p.y]] }
      scheduleOverlay()
      return
    }

    if (t.kind === 'eraser') {
      pushUndo()
      gestureRef.current = {
        kind: 'erase', id: e.pointerId, last: p, at: p, mode: t.eraserMode, radius: t.eraserSize / 2,
      }
      applyErase(p, p)
      scheduleOverlay()
      return
    }

    const pencil = activePencil(t)
    gestureRef.current = {
      kind: 'draw',
      id: e.pointerId,
      pencil,
      points: [{ x: p.x, y: p.y, p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.7 }],
      predicted: [],
    }
    scheduleOverlay()
  }

  const onPointerMove = (e) => {
    const g = gestureRef.current
    if (!g || g.id !== e.pointerId) return

    if (g.kind === 'pan') {
      setScroll(g.startScroll - (e.clientY - g.startY) / viewRef.current.scale)
      return
    }
    e.preventDefault()

    if (g.kind === 'draw') {
      // Every sample the digitiser took since the last frame, not just the one
      // the event loop surfaced. An Apple Pencil reports far faster than the
      // display refreshes, and dropping the rest visibly corners the curves.
      const batch = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
      for (const sample of batch.length ? batch : [e]) {
        const point = toPage(sample)
        g.points.push({ x: point.x, y: point.y, p: pressureOf(sample, g, point) })
      }
      g.predicted = (e.getPredictedEvents ? e.getPredictedEvents() : []).map((s) => {
        const point = toPage(s)
        return { x: point.x, y: point.y, p: g.points[g.points.length - 1].p }
      })
      scheduleOverlay()
      return
    }

    if (g.kind === 'erase') {
      const p = toPage(e)
      applyErase(g.last, p)
      g.last = p
      g.at = p
      scheduleOverlay()
      return
    }

    if (g.kind === 'lasso') {
      const p = toPage(e)
      const last = g.poly[g.poly.length - 1]
      // Thin the loop: a lasso is a hit-test polygon, and a point every pixel
      // makes the point-in-polygon test tens of times more expensive for a
      // shape the user cannot see the difference in.
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 2) g.poly.push([p.x, p.y])
      scheduleOverlay()
      return
    }

    if (g.kind === 'move') {
      const p = toPage(e)
      g.dx = p.x - g.from.x
      g.dy = p.y - g.from.y
      scheduleOverlay()
    }
  }

  const onPointerUp = (e) => {
    const g = gestureRef.current
    if (!g || g.id !== e.pointerId) return
    gestureRef.current = null
    try { stageRef.current.releasePointerCapture(e.pointerId) } catch { /* already gone */ }

    if (g.kind === 'pan') return

    if (g.kind === 'draw') {
      // Simplify once, here. The samples are drawn raw for feel and stored
      // thinned for size; doing it the other way round would mean paying for
      // the fit on every frame and still storing every sample.
      const points = simplify(g.points, 0.35)
      if (points.length) {
        pushUndo()
        const el = makeStroke(points, g.pencil)
        const box = elementBox(el)
        let next = addElements(docRef.current, [el])
        next = growPage(next, box.y + box.h + GROW_MARGIN)
        commit(next)
      }
      clearLayer(liveCtx.current, liveRef.current)
      return
    }

    if (g.kind === 'erase') {
      setDepth({ undo: undoRef.current.length, redo: redoRef.current.length })
      scheduleOverlay()
      return
    }

    if (g.kind === 'lasso') {
      const ids = selectInLasso(docRef.current, g.poly)
      setSelection(ids)
      selectionRef.current = ids
      scheduleOverlay()
      return
    }

    if (g.kind === 'move') {
      hiddenRef.current = new Set()
      if (g.dx || g.dy) {
        const next = translateElements(docRef.current, g.ids, g.dx, g.dy)
        commit(growPage(next, (selectionBox(next, g.ids)?.y ?? 0) + GROW_MARGIN))
      } else {
        redrawBase()
        setDepth({ undo: undoRef.current.length, redo: redoRef.current.length })
      }
      scheduleOverlay()
    }
  }

  // ------------------------------------------------------------ images

  const insertImage = async (file) => {
    setStatus({ kind: 'busy', text: 'uploading…' })
    try {
      const asset = await onUploadImage(file)
      const img = await new Promise((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = () => reject(new Error('could not read that image'))
        i.src = assetUrl(asset.id)
      })
      imagesRef.current.set(asset.id, img)
      const v = viewRef.current
      const pageW = docRef.current.page.w
      // Land it at a comfortable size in the middle of what is on screen,
      // rather than at its own pixel size — a 12 MP photo is wider than the
      // page and would otherwise arrive mostly off the edge.
      const scale = Math.min(1, (pageW * 0.6) / img.naturalWidth)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      const x = (pageW - w) / 2
      const y = v.scrollY + Math.max(24, (v.vh / v.scale - h) / 2)
      pushUndo()
      commit(growPage(addElements(docRef.current, [makeImage(asset.id, { x, y, w, h })]), y + h + GROW_MARGIN))
      setStatus(IDLE)
    } catch (e) {
      setStatus({ kind: 'error', text: e.message })
    }
  }

  const deleteSelection = () => {
    if (!selection.length) return
    pushUndo()
    commit(removeElements(docRef.current, selection))
    setSelection([])
    selectionRef.current = []
    scheduleOverlay()
  }

  const saveTitle = async () => {
    const clean = title.trim()
    if (!clean || clean === page.title) { setTitle(page.title); return }
    clearTimeout(timerRef.current)
    await flushRef.current()
    try { await onRename(clean) }
    catch (e) { setStatus({ kind: 'error', text: e.message }); setTitle(page.title) }
  }

  // Scrollbar thumb geometry, recomputed on render (depth changes on scroll).
  const v = viewRef.current
  const viewH = v.scale ? v.vh / v.scale : 0
  const thumb = viewH && doc.page.h > viewH
    ? { size: Math.max(8, (viewH / doc.page.h) * 100), at: (v.scrollY / doc.page.h) * 100 }
    : null

  return (
    <div className={`draw-page ${sidebarOpen ? '' : 'wide'}`}>
      <input
        className="md-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
      />

      <DrawToolbar
        tools={tools}
        onTools={setTools}
        onInsertImage={insertImage}
        onUndo={undo}
        onRedo={redo}
        canUndo={depth.undo > 0}
        canRedo={depth.redo > 0}
        selectionCount={selection.length}
        onDeleteSelection={deleteSelection}
        status={status}
      />

      {/* touch-action:none because the pencil must draw rather than scroll;
          scrolling is handled above, from touch pointers and the wheel. */}
      <div
        className={`draw-stage tool-${tools.kind}`}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={baseRef} className="draw-layer" />
        <canvas ref={liveRef} className="draw-layer" />
        {thumb && (
          <div className="draw-scrollbar" aria-hidden="true">
            <div className="draw-thumb" style={{ height: `${thumb.size}%`, top: `${thumb.at}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
