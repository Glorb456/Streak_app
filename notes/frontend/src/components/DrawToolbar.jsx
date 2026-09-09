import React, { useEffect, useRef, useState } from 'react'
import ColorSwatch from './ColorSwatch.jsx'
import {
  ERASER_MAX, ERASER_MIN, PENCIL_COUNT, SIZE_MAX, SIZE_MIN,
} from '../draw/tools.js'

// A slot's nib, drawn at the size and colour it will actually put down — the
// preview is the setting, so there is nothing to read.
function Nib({ pencil }) {
  const d = Math.max(4, Math.min(20, pencil.size * 1.6))
  return (
    <span className="nib" aria-hidden="true">
      <span
        className="nib-dot"
        style={{ width: d, height: d, background: pencil.color, opacity: pencil.opacity ?? 1 }}
      />
    </span>
  )
}

function Slider({ label, value, min, max, step = 0.5, onChange }) {
  return (
    <label className="tool-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b>{Math.round(value)}</b>
    </label>
  )
}

/** Closes the open settings popover on any click outside it. */
function usePopoverDismiss(open, close) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    // 'click', not 'mousedown', so the range input's own drag isn't cut short
    // — the same reason the task app's settings menu listens on click.
    const away = (e) => {
      if (!e.target.isConnected) return
      if (ref.current && !ref.current.contains(e.target)) close()
    }
    const esc = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('click', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('click', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open, close])
  return ref
}

export default function DrawToolbar({
  tools, onTools, onInsertImage, onUndo, onRedo, canUndo, canRedo,
  selectionCount, onDeleteSelection, status,
}) {
  // Which popover is open: a pencil index, 'eraser', or null. A tool is
  // selected by tapping it, and its settings open by tapping it again — the
  // gesture every pen app uses, and it keeps the bar one row tall.
  const [panel, setPanel] = useState(null)
  const ref = usePopoverDismiss(panel !== null, () => setPanel(null))
  const fileRef = useRef(null)

  const set = (patch) => onTools({ ...tools, ...patch })
  const setPencil = (i, patch) =>
    set({ pencils: tools.pencils.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  const pickPencil = (i) => {
    if (tools.kind === 'pen' && tools.pencil === i) setPanel(panel === i ? null : i)
    else { set({ kind: 'pen', pencil: i }); setPanel(null) }
  }

  const pickEraser = () => {
    if (tools.kind === 'eraser') setPanel(panel === 'eraser' ? null : 'eraser')
    else { set({ kind: 'eraser' }); setPanel(null) }
  }

  return (
    // Clicks stop here: the editor collapses the sidebar when its body is
    // tapped, and reaching for a pencil is not tapping the page. Pointer-downs
    // on the buttons are prevented so a tap never leaves one focused — a
    // focused button keeps its highlight after the hand moves back to the
    // page, which reads as the toolbar lighting up on its own. The click
    // itself still fires; sliders and colour wells are left alone.
    <div
      className="draw-toolbar"
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => { if (e.target.closest('button')) e.preventDefault() }}
    >
      <div className="tool-group pencils">
        {tools.pencils.slice(0, PENCIL_COUNT).map((pencil, i) => (
          <button
            key={i}
            type="button"
            className={`tool pencil ${tools.kind === 'pen' && tools.pencil === i ? 'on' : ''}`}
            title={`Pencil ${i + 1}`}
            aria-pressed={tools.kind === 'pen' && tools.pencil === i}
            onClick={() => pickPencil(i)}
          >
            <Nib pencil={pencil} />
          </button>
        ))}
      </div>

      <div className="tool-group">
        <button
          type="button"
          className={`tool ${tools.kind === 'eraser' ? 'on' : ''}`}
          title="Eraser"
          aria-pressed={tools.kind === 'eraser'}
          onClick={pickEraser}
        >
          ⌫
        </button>
        <button
          type="button"
          className={`tool ${tools.kind === 'lasso' ? 'on' : ''}`}
          title="Lasso — circle strokes to move them"
          aria-pressed={tools.kind === 'lasso'}
          onClick={() => { set({ kind: 'lasso' }); setPanel(null) }}
        >
          ✧
        </button>
        <button
          type="button"
          className="tool"
          title="Insert an image"
          onClick={() => fileRef.current?.click()}
        >
          ⬚
        </button>
        {/* accept="image/*" is what makes iOS offer Photo Library, Take Photo
            and Files rather than a bare document browser. */}
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // so re-picking the same photo fires again
            if (file) onInsertImage(file)
          }}
        />
      </div>

      <div className="tool-group">
        <button type="button" className="tool" title="Undo" disabled={!canUndo} onClick={onUndo}>⟲</button>
        <button type="button" className="tool" title="Redo" disabled={!canRedo} onClick={onRedo}>⟳</button>
      </div>

      {selectionCount > 0 && (
        <div className="tool-group selection-group">
          <span className="tool-note">{selectionCount} selected</span>
          <button type="button" className="tool danger" title="Delete selection" onClick={onDeleteSelection}>
            ✕
          </button>
        </div>
      )}

      <span className={`draw-status ${status.kind}`}>{status.text}</span>

      {typeof panel === 'number' && (
        <div className="tool-popover" style={{ left: `calc(${panel} * 44px)` }}>
          <div className="tool-popover-title">Pencil {panel + 1}</div>
          <div className="tool-row">
            <ColorSwatch
              className="pencil-swatch"
              title="Pencil colour"
              value={tools.pencils[panel].color}
              onChange={(color) => setPencil(panel, { color })}
            />
            <Slider
              label="Size"
              min={SIZE_MIN}
              max={SIZE_MAX}
              value={tools.pencils[panel].size}
              onChange={(size) => setPencil(panel, { size })}
            />
          </div>
          <Slider
            label="Opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={tools.pencils[panel].opacity ?? 1}
            onChange={(opacity) => setPencil(panel, { opacity })}
          />
        </div>
      )}

      {panel === 'eraser' && (
        <div className="tool-popover eraser-popover">
          <div className="tool-popover-title">Eraser</div>
          <div className="tool-modes">
            <button
              type="button"
              className={tools.eraserMode === 'pixel' ? 'on' : ''}
              onClick={() => set({ eraserMode: 'pixel' })}
            >
              Pixel
              <small>Rubs a hole, splitting the stroke</small>
            </button>
            <button
              type="button"
              className={tools.eraserMode === 'object' ? 'on' : ''}
              onClick={() => set({ eraserMode: 'object' })}
            >
              Object
              <small>Removes the whole stroke</small>
            </button>
          </div>
          {tools.eraserMode === 'pixel' && (
            <Slider
              label="Size"
              min={ERASER_MIN}
              max={ERASER_MAX}
              value={tools.eraserSize}
              onChange={(eraserSize) => set({ eraserSize })}
            />
          )}
        </div>
      )}
    </div>
  )
}
