import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  classifyLine, continuationPrefix, parseDoc, parseInline, safeHref, sourceOffset, toggleTodo,
} from '../md.js'

const SAVE_DELAY = 700 // ms of quiet before the .md file is written
const INDENT = '  '

function autoGrow(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// ---- rendering -------------------------------------------------------

function Inline({ tokens }) {
  return tokens.map((t, i) => {
    if (t.type === 'text') return <React.Fragment key={i}>{t.text}</React.Fragment>
    if (t.type === 'code') return <code key={i}>{t.text}</code>
    if (t.type === 'link') {
      const href = safeHref(t.href)
      // An unsafe scheme renders as plain text rather than a dead link, so a
      // note that came from elsewhere can never be one click from executing.
      if (!href) return <React.Fragment key={i}>{t.text}</React.Fragment>
      return (
        <a key={i} href={href} target="_blank" rel="noreferrer noopener">{t.text}</a>
      )
    }
    const Tag = { bold: 'strong', italic: 'em', strike: 's' }[t.type]
    return <Tag key={i}><Inline tokens={t.children} /></Tag>
  })
}

// One formatted line. The body sits in its own element so a click can be
// measured against the rendered *text* alone, with the bullet and the
// checkbox — which have no source characters — left out of the count.
function RenderedLine({ line, onPick, onToggle }) {
  const body = <span className="line-body"><Inline tokens={parseInline(line.body)} /></span>

  if (line.type === 'divider') return <hr className="md-divider" onClick={() => onPick(0)} />
  if (line.type === 'fence') {
    return <div className="md-fence" onClick={() => onPick(0)}>{line.raw || '```'}</div>
  }
  if (line.type === 'code') {
    return <pre className="md-code" onClick={(e) => onPick(pointOffset(e))}><code>{line.body}</code></pre>
  }
  if (line.type === 'heading') {
    const H = `h${line.level}`
    return <H className="md-h" onClick={(e) => onPick(pointOffset(e))}>{body}</H>
  }
  if (line.type === 'todo') {
    return (
      <div className={`md-todo ${line.done ? 'done' : ''}`}>
        <button
          type="button"
          className={`check-circle ${line.done ? 'checked' : ''}`}
          // The checkbox is a toggle, not a way into the text: without this the
          // mousedown would move the caret here and the click would both tick
          // the box and open the line for editing.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggle}
          aria-label="toggle item"
        />
        <span className="md-todo-text" onClick={(e) => onPick(pointOffset(e))}>{body}</span>
      </div>
    )
  }
  if (line.type === 'bullet' || line.type === 'ordered') {
    return (
      <div
        className={`md-item ${line.type}`}
        style={{ paddingLeft: `${line.indent * 18}px` }}
        onClick={(e) => onPick(pointOffset(e))}
      >
        <span className="md-marker">{line.type === 'bullet' ? '•' : line.raw.trim().split(/\s/)[0]}</span>
        {body}
      </div>
    )
  }
  if (line.type === 'quote') {
    return <blockquote className="md-quote" onClick={(e) => onPick(pointOffset(e))}>{body}</blockquote>
  }
  return (
    <p className="md-p" onClick={(e) => onPick(pointOffset(e))}>
      {line.body ? body : <span className="md-blank">&nbsp;</span>}
    </p>
  )
}

/** Character offset of a click inside the clicked line's rendered text.
 *
 *  Paired with sourceOffset() this is what puts the caret where the user
 *  aimed; without it, clicking into a formatted line can only land at one
 *  end of it. Browsers disagree on the API and either may be missing, in
 *  which case 0 is a safe answer (caret to the start of the body). */
function pointOffset(e) {
  const host = e.currentTarget.querySelector('.line-body') || e.currentTarget
  let node = null
  let offset = 0
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY)
    if (r) { node = r.startContainer; offset = r.startOffset }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(e.clientX, e.clientY)
    if (p) { node = p.offsetNode; offset = p.offset }
  }
  if (!node || !host.contains(node)) return 0
  const range = document.createRange()
  range.selectNodeContents(host)
  try { range.setEnd(node, offset) } catch { return 0 }
  return range.toString().length
}

// ---- the page --------------------------------------------------------

// Live-rendered markdown, in the Notion/Outline shape: the line holding the
// caret is its raw source in a textarea, every other line is rendered. The
// document is the .md text itself, so there is no separate model to keep in
// step with the file on disk.
export default function MarkdownPage({ page, onSave, onRename, sidebarOpen }) {
  const [text, setText] = useState(page.content)
  const [focused, setFocused] = useState(null)
  const [title, setTitle] = useState(page.title)
  const [error, setError] = useState('')
  const refs = useRef([])
  const pendingCaret = useRef(null)
  const savedText = useRef(page.content)
  const timer = useRef(null)

  const lines = text.split('\n')
  const doc = parseDoc(text)

  // The current text and save handler live in a ref so flush() can be stable.
  // With `text` in its dependency list the unmount-flush effect below would
  // tear down and re-run on every keystroke, saving each one and defeating the
  // debounce entirely.
  const latest = useRef({ text, onSave })
  latest.current = { text, onSave }

  const flush = useCallback(async (value) => {
    const next = value ?? latest.current.text
    if (next === savedText.current) return
    savedText.current = next
    try { await latest.current.onSave(next); setError('') }
    catch (e) { setError(e.message) }
  }, [])

  // Debounced autosave. A ref, not state, so restarting the timer on every
  // keystroke doesn't re-render the whole document.
  const schedule = (next) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(next), SAVE_DELAY)
  }

  // Unmount is a page switch or a tab close, and either would otherwise drop
  // whatever was typed inside the last SAVE_DELAY.
  useEffect(() => {
    const bail = () => flush()
    window.addEventListener('pagehide', bail)
    return () => {
      window.removeEventListener('pagehide', bail)
      clearTimeout(timer.current)
      flush()
    }
  }, [flush])

  // Layout effect, not effect: splitting or merging a line remounts textareas,
  // and moving the caret after a paint would show it in the old spot first.
  useLayoutEffect(() => {
    const p = pendingCaret.current
    if (!p) return
    pendingCaret.current = null
    const el = refs.current[p.index]
    if (!el) return
    el.focus()
    const pos = Math.max(0, Math.min(p.pos, el.value.length))
    el.setSelectionRange(pos, pos)
    autoGrow(el)
  })

  const apply = (next, caret) => {
    if (caret) pendingCaret.current = caret
    setText(next)
    schedule(next)
  }

  const setLine = (i, value) => {
    const next = [...lines]
    next[i] = value
    apply(next.join('\n'))
  }

  const openLine = (i, renderedOffset) => {
    pendingCaret.current = { index: i, pos: sourceOffset(lines[i], renderedOffset) }
    setFocused(i)
  }

  const onKeyDown = (e, i) => {
    const el = e.target
    const raw = lines[i]
    if (e.key === 'Enter') {
      e.preventDefault()
      const at = el.selectionStart
      const prefix = continuationPrefix(raw)
      // Enter on an empty list item ends the list instead of adding another
      // bullet — the same escape hatch every outliner has.
      const head = prefix === '' && classifyLine(raw).body === '' && classifyLine(raw).prefixLen > 0
        ? ''
        : raw.slice(0, at)
      const next = [
        ...lines.slice(0, i),
        head,
        prefix + raw.slice(at),
        ...lines.slice(i + 1),
      ]
      setFocused(i + 1)
      apply(next.join('\n'), { index: i + 1, pos: prefix.length })
      return
    }
    if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      const { prefixLen } = classifyLine(raw)
      if (i === 0 && prefixLen === 0) return
      if (i > 0) {
        e.preventDefault()
        const prev = lines[i - 1]
        const next = [...lines.slice(0, i - 1), prev + raw, ...lines.slice(i + 1)]
        setFocused(i - 1)
        apply(next.join('\n'), { index: i - 1, pos: prev.length })
      }
      return
    }
    // Caret at the head of a list item's text: strip the marker rather than
    // merging into the line above, which is what a list user expects first.
    if (e.key === 'Backspace') {
      const { prefixLen, body } = classifyLine(raw)
      if (prefixLen > 0 && el.selectionStart === prefixLen && el.selectionEnd === prefixLen) {
        e.preventDefault()
        setLine(i, body)
        pendingCaret.current = { index: i, pos: 0 }
      }
      return
    }
    if (e.key === 'Tab') {
      const { type } = classifyLine(raw)
      if (type !== 'bullet' && type !== 'ordered' && type !== 'todo') return
      e.preventDefault()
      const at = el.selectionStart
      const out = e.shiftKey
      if (out && !raw.startsWith(INDENT)) return
      const value = out ? raw.slice(INDENT.length) : INDENT + raw
      setLine(i, value)
      pendingCaret.current = { index: i, pos: at + (out ? -INDENT.length : INDENT.length) }
      return
    }
    if (e.key === 'ArrowUp' && el.selectionStart === 0 && i > 0) {
      e.preventDefault()
      setFocused(i - 1)
      pendingCaret.current = { index: i - 1, pos: lines[i - 1].length }
      return
    }
    if (e.key === 'ArrowDown' && el.selectionStart === raw.length && i < lines.length - 1) {
      e.preventDefault()
      setFocused(i + 1)
      pendingCaret.current = { index: i + 1, pos: 0 }
    }
  }

  const saveTitle = async () => {
    const clean = title.trim()
    if (!clean || clean === page.title) { setTitle(page.title); return }
    // The title is the filename, so renaming issues a new id — flush the body
    // first or the pending write would land on the path that no longer exists.
    clearTimeout(timer.current)
    await flush()
    try { await onRename(clean); setError('') }
    catch (e) { setError(e.message); setTitle(page.title) }
  }

  return (
    <div className={`md-page ${sidebarOpen ? '' : 'wide'}`}>
      <input
        className="md-title"
        value={title}
        placeholder="Untitled Page"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
      />
      {error && <div className="md-error">{error}</div>}

      <div className="md-body">
        {doc.map((line, i) =>
          i === focused ? (
            <textarea
              key={i}
              // Typed by line kind so a heading keeps its size while it is
              // being edited — the caret entering a line should not resize it.
              className={`md-input k-${line.type} lvl${line.level}`}
              ref={(el) => { refs.current[i] = el; autoGrow(el) }}
              rows={1}
              value={line.raw}
              spellCheck
              onChange={(e) => { autoGrow(e.target); setLine(i, e.target.value) }}
              onKeyDown={(e) => onKeyDown(e, i)}
              onBlur={() => { setFocused((f) => (f === i ? null : f)); flush() }}
            />
          ) : (
            <RenderedLine
              key={i}
              line={line}
              onPick={(offset) => openLine(i, offset)}
              onToggle={() => setLine(i, toggleTodo(line.raw))}
            />
          )
        )}
      </div>

      {/* Clicking under the last line continues the note, the way an empty
          page in any editor does, instead of doing nothing. */}
      <div
        className="md-tail"
        onClick={() => {
          const last = lines.length - 1
          if (lines[last] === '') { setFocused(last); pendingCaret.current = { index: last, pos: 0 } }
          else {
            setFocused(lines.length)
            apply(`${text}\n`, { index: lines.length, pos: 0 })
          }
        }}
      />
    </div>
  )
}
