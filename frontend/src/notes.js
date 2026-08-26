// Notes are stored as plain text; checklist lines are encoded markdown-style
// ("- [ ] milk", "- [x] eggs") so the backend/schema stay unchanged and the
// checkboxes only ever render inside the notes editor.
const CHECK_RE = /^- \[( |x)\]\s?(.*)$/

export function parseNotes(text) {
  if (!text) return [{ type: 'text', done: false, text: '' }]
  return text.split('\n').map((line) => {
    const m = line.match(CHECK_RE)
    if (m) return { type: 'check', done: m[1] === 'x', text: m[2] }
    return { type: 'text', done: false, text: line }
  })
}

export function serializeNotes(lines) {
  return lines
    .map((l) => (l.type === 'check' ? `- [${l.done ? 'x' : ' '}] ${l.text}` : l.text))
    .join('\n')
}
