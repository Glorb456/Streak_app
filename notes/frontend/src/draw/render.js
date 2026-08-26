// Canvas painting.
//
// Two layers, and the split is the whole latency story: the base layer holds
// every committed element and is only repainted when something structural
// changes (scroll, erase, move, undo), while the stroke under the pen is
// repainted alone on the live layer every frame. Repainting the document on
// every pointermove is what makes a browser drawing app feel laggy, and this
// never does it.

import { boxesOverlap, outline, resample, smooth } from './geometry.js'
import { elementBox } from './doc.js'

/** Path2D for a committed stroke, cached on the element.
 *
 *  Every mutation makes a new element object, so the cache invalidates itself:
 *  a moved or split stroke arrives as a different object and rebuilds. */
export function strokePath(el) {
  if (el._path) return el._path
  const poly = outline(resample(el.points, 1.5), el.size)
  const path = new Path2D()
  if (poly.length) {
    path.moveTo(poly[0][0], poly[0][1])
    for (let i = 1; i < poly.length; i++) path.lineTo(poly[i][0], poly[i][1])
    path.closePath()
  }
  Object.defineProperty(el, '_path', { value: path, enumerable: false, configurable: true })
  return path
}

/** Outline for the stroke currently under the pen.
 *
 *  Smoothed but not resampled or simplified: those run once on commit, and
 *  paying for them 120 times a second would show up as exactly the lag this
 *  file exists to avoid. */
export function livePath(points, size) {
  const poly = outline(smooth(points), size)
  const path = new Path2D()
  if (!poly.length) return path
  path.moveTo(poly[0][0], poly[0][1])
  for (let i = 1; i < poly.length; i++) path.lineTo(poly[i][0], poly[i][1])
  path.closePath()
  return path
}

export function drawElement(ctx, el, getImage) {
  if (el.type === 'image') {
    const img = getImage?.(el.asset)
    if (img) {
      ctx.drawImage(img, el.x, el.y, el.w, el.h)
    } else {
      // The bitmap is still loading (or the asset is missing): hold its place
      // so the page doesn't reflow under the pen when it arrives.
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.setLineDash([6, 6])
      ctx.strokeRect(el.x, el.y, el.w, el.h)
      ctx.restore()
    }
    return
  }
  ctx.save()
  ctx.globalAlpha = el.opacity ?? 1
  ctx.fillStyle = el.color
  ctx.fill(strokePath(el))
  ctx.restore()
}

/** Set up the device-pixel transform for a view.
 *
 *  Document coordinates are page units at zoom 1; this is the only place they
 *  become device pixels. Keeping the geometry resolution-independent is what
 *  lets the same file render crisp on a 3x iPad and a 1x monitor — nothing is
 *  ever rasterised into the stored format. */
export function applyView(ctx, { dpr, scale, scrollY }) {
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -scrollY * scale * dpr)
}

export function clearLayer(ctx, canvas) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

/** Repaint the base layer, drawing only what the viewport can see.
 *
 *  Culling by bounds is what keeps scrolling a long page at frame rate: a
 *  thousand-stroke page costs a thousand cheap box tests, not a thousand
 *  path fills. */
export function drawDoc(ctx, canvas, doc, view, getImage, skip) {
  clearLayer(ctx, canvas)
  applyView(ctx, view)
  const visible = {
    x: -1e6,
    y: view.scrollY - 40,
    w: 2e6,
    h: canvas.height / (view.dpr * view.scale) + 80,
  }
  let drawn = 0
  for (const el of doc.elements) {
    // `skip` holds the elements being dragged: they are painted on the live
    // layer at the pointer's offset instead, so a lasso move repaints only
    // what is moving rather than the whole page every frame.
    if (skip && skip.has(el.id)) continue
    if (!boxesOverlap(elementBox(el), visible)) continue
    drawElement(ctx, el, getImage)
    drawn++
  }
  return drawn
}

/** Selection chrome: the lasso being drawn, and the box around what it caught.
 *  Lives on the live layer so it costs nothing to clear. */
export function drawLasso(ctx, poly) {
  if (poly.length < 2) return
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.setLineDash([7, 5])
  ctx.strokeStyle = '#b39bff'
  ctx.fillStyle = 'rgba(179,155,255,0.10)'
  ctx.beginPath()
  ctx.moveTo(poly[0][0], poly[0][1])
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

export function drawSelectionBox(ctx, box, pad = 6) {
  if (!box) return
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = '#b39bff'
  ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2)
  ctx.restore()
}

/** The eraser's own outline, so its size is visible while it is being used. */
export function drawEraserCursor(ctx, p, radius) {
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}
