import { useCallback, useRef, useState } from 'react'
import { moveItem } from './tasks.js'

// Movement before a press counts as a drag. Under this the press is left
// alone, so tap-to-edit on the mobile list and double-click-to-edit on the
// calendar still survive the wobble of a finger or a mouse.
const THRESHOLD = 5

// How long after a real drag a click is still treated as its tail end.
const CLICK_GRACE_MS = 300

/**
 * Drag-to-reorder for one vertical list.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, which has never
 * fired on iOS Safari — the platform this was asked for. Pointer events also
 * collapse mouse, touch and pen into a single code path.
 *
 * Nothing is reordered in the DOM mid-drag. The list's geometry is measured
 * once at pointerdown and each row is offset with a transform written straight
 * to the node, which buys two things:
 *   - the rects the drop index is computed from cannot shift underneath the
 *     pointer as rows rearrange, which is what makes the target index stable;
 *   - React never re-renders during the drag, so a re-render (the 5 s poll, a
 *     sibling day updating) cannot interrupt one in flight.
 * The transforms are cleared and the new order committed in the same pointerup
 * handler; React 18 flushes that state update before the next paint, so the
 * rows never flash back through their old order.
 *
 * @param ids       the list's ids, in the order currently rendered
 * @param onCommit  called with the new id order, only when it actually changed
 * @param onActive  called with true/false as a drag starts and ends
 */
export function useDragOrder(ids, onCommit, onActive) {
  const [draggingId, setDraggingId] = useState(null)
  const nodes = useRef(new Map())
  const drag = useRef(null)
  const draggedAt = useRef(0)

  // Ref callback per row. Rows unmount on every sync, so the map is keyed by
  // id and cleaned up on detach rather than rebuilt.
  const setItemRef = useCallback(
    (id) => (el) => {
      if (el) nodes.current.set(id, el)
      else nodes.current.delete(id)
    },
    []
  )

  const clearTransforms = (session) => {
    for (const id of session.ids) {
      const el = nodes.current.get(id)
      if (el) el.style.transform = ''
    }
  }

  const finish = (session) => {
    drag.current = null
    clearTransforms(session)
    if (!session.active) return
    setDraggingId(null)
    onActive?.(false)
    draggedAt.current = Date.now()
  }

  const onPointerDown = (e, id) => {
    // Left button only; touch and pen both report button 0.
    if (e.button > 0) return
    if (ids.length < 2) return
    const from = ids.indexOf(id)
    if (from < 0) return

    // Freeze every row's box now. Bail if the list is mid-mount and a node is
    // missing, rather than dragging against a half-measured list.
    const rects = new Map()
    for (const rowId of ids) {
      const el = nodes.current.get(rowId)
      if (!el) return
      const r = el.getBoundingClientRect()
      rects.set(rowId, { top: r.top, height: r.height })
    }

    // The rows are evenly spaced, so one gap describes the whole list; it is
    // the margin/border between rows that a naive height-only relayout drops.
    const a = rects.get(ids[0])
    const b = rects.get(ids[1])
    const gap = Math.max(0, b.top - (a.top + a.height))

    drag.current = {
      id, from, rects, gap,
      ids: [...ids],
      order: [...ids],
      startY: e.clientY,
      pointerId: e.pointerId,
      node: e.currentTarget,
      active: false,
    }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.startY

    if (!d.active) {
      if (Math.abs(dy) < THRESHOLD) return
      d.active = true
      // Captured only now, so a plain tap never redirects its own click.
      d.node.setPointerCapture?.(d.pointerId)
      setDraggingId(d.id)
      onActive?.(true)
    }

    const self = d.rects.get(d.id)
    const center = self.top + dy + self.height / 2

    // Target slot = how many of the *other* frozen rows now sit above the
    // dragged row's centre. Counting rather than hit-testing means the result
    // is defined even when the pointer runs off the end of the list.
    let to = 0
    for (let i = 0; i < d.ids.length; i++) {
      if (i === d.from) continue
      const r = d.rects.get(d.ids[i])
      if (r.top + r.height / 2 < center) to++
    }

    d.order = moveItem(d.ids, d.from, to)

    // Re-lay the frozen boxes out in preview order and offset each row to the
    // slot it would occupy. The dragged row instead tracks the pointer exactly,
    // so it stays under the finger no matter where its slot has moved to.
    let y = d.rects.get(d.ids[0]).top
    for (const rowId of d.order) {
      const r = d.rects.get(rowId)
      const el = nodes.current.get(rowId)
      if (el) {
        el.style.transform =
          rowId === d.id ? `translateY(${dy}px)` : `translateY(${y - r.top}px)`
      }
      y += r.height + d.gap
    }
  }

  const onPointerUp = () => {
    const d = drag.current
    if (!d) return
    const changed = d.active && d.order.some((id, i) => id !== d.ids[i])
    finish(d)
    if (changed) onCommit(d.order)
  }

  // pointercancel is the normal exit when the browser claims the gesture for a
  // scroll, so it has to unwind cleanly rather than leave rows transformed.
  const onPointerCancel = () => {
    const d = drag.current
    if (d) finish(d)
  }

  // True if a real drag just ended. Guards the click/dblclick that a pointerup
  // still emits, which would otherwise open the task that was being dragged.
  const wasDragged = useCallback(
    () => Date.now() - draggedAt.current < CLICK_GRACE_MS,
    []
  )

  const dragProps = (id) => ({
    onPointerDown: (e) => onPointerDown(e, id),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  })

  return { setItemRef, dragProps, draggingId, wasDragged }
}
