// Markdown just far enough for a notes app, in two layers.
//
// The editor is line-based: the document *is* the .md text, the line holding
// the caret is a raw <textarea>, and every other line renders formatted. So
// what this module has to answer is (a) what kind of line is this, (b) how do
// its inline spans render, and (c) which source character sits under a click
// on the rendered text — (c) is what makes clicking into the middle of a
// **bold** word land the caret where the user aimed rather than at the end.

// ---------------------------------------------------------------- blocks

// Order matters: a todo item is also a bullet, and a fence line inside a
// heading-looking string is still a fence.
const BLOCKS = [
  { type: 'fence', re: /^\s*(?:```|~~~)(.*)$/ },
  { type: 'divider', re: /^\s*(?:---+|\*\*\*+|___+)\s*$/ },
  { type: 'heading', re: /^(#{1,6})\s+(.*)$/ },
  { type: 'todo', re: /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/ },
  { type: 'bullet', re: /^(\s*)[-*+]\s+(.*)$/ },
  { type: 'ordered', re: /^(\s*)\d+[.)]\s+(.*)$/ },
  { type: 'quote', re: /^\s*>\s?(.*)$/ },
]

const INDENT = 2 // spaces per nesting level in a list

/** Classify one source line. `body` is always a suffix of `raw`, which is what
 *  lets every caller recover the marker length as raw.length - body.length. */
export function classifyLine(raw) {
  for (const b of BLOCKS) {
    const m = raw.match(b.re)
    if (!m) continue
    const body = m[m.length - 1] ?? ''
    const line = {
      type: b.type,
      body,
      // The prefix is whatever the marker consumed. Derived rather than
      // re-matched so "##   spaced" and "-\t item" can't drift.
      prefixLen: raw.length - body.length,
      level: 0,
      indent: 0,
      done: false,
    }
    if (b.type === 'heading') line.level = m[1].length
    if (b.type === 'todo') line.done = m[1].toLowerCase() === 'x'
    if (b.type === 'bullet' || b.type === 'ordered') {
      line.indent = Math.floor(m[1].length / INDENT)
    }
    return line
  }
  return { type: 'paragraph', body: raw, prefixLen: 0, level: 0, indent: 0, done: false }
}

/** Classify a whole document, carrying fenced-code state across lines.
 *  Lines inside a fence are returned verbatim as `code` — a '# ' in a shell
 *  snippet is a comment, not a heading. */
export function parseDoc(text) {
  const out = []
  let fenced = false
  for (const raw of text.split('\n')) {
    const line = classifyLine(raw)
    if (line.type === 'fence') {
      fenced = !fenced
      out.push({ ...line, raw, fenceOpen: fenced })
    } else if (fenced) {
      out.push({ type: 'code', body: raw, prefixLen: 0, level: 0, indent: 0, done: false, raw })
    } else {
      out.push({ ...line, raw })
    }
  }
  return out
}

/** What pressing Enter at the end of `raw` should start the next line with.
 *  Continues a list, and an ordered list counts on; anything else starts
 *  plain, which is how a list is ended (Enter twice). */
export function continuationPrefix(raw) {
  const m = raw.match(/^(\s*)([-*+])\s+\[[ xX]\]\s+(.*)$/)
  if (m) return m[3] === '' ? '' : `${m[1]}${m[2]} [ ] `
  const b = raw.match(/^(\s*)([-*+])\s+(.*)$/)
  if (b) return b[3] === '' ? '' : `${b[1]}${b[2]} `
  const o = raw.match(/^(\s*)(\d+)([.)])\s+(.*)$/)
  if (o) return o[4] === '' ? '' : `${o[1]}${Number(o[2]) + 1}${o[3]} `
  const q = raw.match(/^(\s*)>\s?(.*)$/)
  if (q) return q[2] === '' ? '' : `${q[1]}> `
  return ''
}

/** Flip a '- [ ]' line to '- [x]' and back. */
export function toggleTodo(raw) {
  return raw.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_, a, c, b) =>
    `${a}${c.toLowerCase() === 'x' ? ' ' : 'x'}${b}`
  )
}

// ---------------------------------------------------------------- inline

// `leaf` spans render their captured text literally and are not re-scanned,
// so `**not bold**` inside backticks stays literal. `open` is how many source
// characters precede the captured content, which is what the click map counts.
const SPANS = [
  { type: 'code', re: /^`([^`]+)`/, open: 1, leaf: true },
  { type: 'link', re: /^\[([^\]\n]*)\]\(([^)\s]*)\)/, open: 1, leaf: true },
  { type: 'bold', re: /^\*\*([\s\S]+?)\*\*/, open: 2 },
  { type: 'bold', re: /^__([\s\S]+?)__/, open: 2, wordGuard: true },
  { type: 'strike', re: /^~~([\s\S]+?)~~/, open: 2 },
  { type: 'italic', re: /^\*([^*\n]+?)\*/, open: 1 },
  { type: 'italic', re: /^_([^_\n]+?)_/, open: 1, wordGuard: true },
]

/** Split a line body into a token tree.
 *
 *  `start` is absolute in `text`, and `contentStart` is where the captured
 *  content begins — together they are what maps a click back to a source
 *  offset. `base` is only ever set by the recursive calls.
 */
export function parseInline(text, base = 0) {
  const out = []
  let buf = ''
  let bufStart = 0
  let i = 0
  const flush = () => {
    if (!buf) return
    out.push({ type: 'text', text: buf, start: base + bufStart, contentStart: base + bufStart })
    buf = ''
  }
  while (i < text.length) {
    const rest = text.slice(i)
    let hit = null
    for (const rule of SPANS) {
      // '_' inside snake_case is not emphasis. '*' has no such problem, and
      // guarding it would break '**bold**' butted against punctuation.
      if (rule.wordGuard && i > 0 && /\w/.test(text[i - 1])) continue
      const m = rest.match(rule.re)
      if (m) { hit = { rule, m }; break }
    }
    if (!hit) {
      if (!buf) bufStart = i
      buf += text[i]
      i += 1
      continue
    }
    flush()
    const { rule, m } = hit
    const start = base + i
    const contentStart = start + rule.open
    if (rule.type === 'link') {
      out.push({ type: 'link', text: m[1], href: m[2], start, contentStart })
    } else if (rule.leaf) {
      out.push({ type: rule.type, text: m[1], start, contentStart })
    } else {
      out.push({
        type: rule.type,
        children: parseInline(m[1], contentStart),
        start,
        contentStart,
      })
    }
    i += m[0].length
  }
  flush()
  return out
}

/** Per-rendered-character source indices for one line body.
 *
 *  The rendered text drops markers, so rendered offset N and source offset N
 *  are different numbers the moment a line contains any formatting. Handing
 *  back one index per rendered character keeps the mapping exact instead of
 *  approximate. */
export function inlineMap(body) {
  const map = []
  const walk = (tokens) => {
    for (const t of tokens) {
      if (t.children) { walk(t.children); continue }
      for (let k = 0; k < t.text.length; k++) map.push(t.contentStart + k)
    }
  }
  walk(parseInline(body))
  return map
}

/** Source offset in `raw` for a click at `renderedOffset` in its rendered text. */
export function sourceOffset(raw, renderedOffset) {
  const { body, prefixLen } = classifyLine(raw)
  const map = inlineMap(body)
  if (renderedOffset >= map.length) return raw.length
  return prefixLen + (map[renderedOffset] ?? 0)
}

// javascript: and data: URLs are the one way a note could execute something
// when a *different* device opens it, so anything but a plain web or mail
// link renders as inert text.
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#|\.{0,2}\/)/i

export function safeHref(href) {
  return SAFE_HREF.test(href.trim()) ? href.trim() : null
}
