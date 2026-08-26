import { describe, expect, it } from 'vitest'
import {
  classifyLine, continuationPrefix, inlineMap, parseDoc, parseInline,
  safeHref, sourceOffset, toggleTodo,
} from './md.js'

const kinds = (text) => parseDoc(text).map((l) => l.type)

describe('classifyLine', () => {
  it('reads headings and their level', () => {
    expect(classifyLine('## Skulk idea')).toMatchObject({
      type: 'heading', level: 2, body: 'Skulk idea', prefixLen: 3,
    })
  })

  it('reads a todo and its state', () => {
    expect(classifyLine('- [x] eggs')).toMatchObject({ type: 'todo', done: true, body: 'eggs' })
    expect(classifyLine('- [ ] milk')).toMatchObject({ type: 'todo', done: false, body: 'milk' })
  })

  it('prefers todo over bullet, since a todo is also a bullet', () => {
    expect(classifyLine('- [ ] milk').type).toBe('todo')
  })

  it('reads list nesting from the indent', () => {
    expect(classifyLine('- top')).toMatchObject({ type: 'bullet', indent: 0 })
    expect(classifyLine('    - nested')).toMatchObject({ type: 'bullet', indent: 2 })
  })

  it('treats anything else as a paragraph, including a blank line', () => {
    expect(classifyLine('just words').type).toBe('paragraph')
    expect(classifyLine('')).toMatchObject({ type: 'paragraph', body: '', prefixLen: 0 })
    expect(classifyLine('#nospace').type).toBe('paragraph')
  })

  it('always leaves body as a suffix of the raw line', () => {
    for (const raw of ['# h', '- b', '1. o', '> q', '- [x] t', 'plain', '', '   - deep']) {
      const { body, prefixLen } = classifyLine(raw)
      expect(raw.slice(prefixLen)).toBe(body)
    }
  })
})

describe('parseDoc', () => {
  it('carries fence state so code is never re-read as markdown', () => {
    expect(kinds('intro\n```\n# not a heading\n- not a bullet\n```\ndone')).toEqual([
      'paragraph', 'fence', 'code', 'code', 'fence', 'paragraph',
    ])
  })

  it('leaves an unterminated fence open rather than dropping the rest', () => {
    expect(kinds('```\nstill code\nand more')).toEqual(['fence', 'code', 'code'])
  })

  it('keeps one entry per source line', () => {
    const text = 'a\n\nb\n'
    expect(parseDoc(text)).toHaveLength(4)
    expect(parseDoc(text).map((l) => l.raw).join('\n')).toBe(text)
  })
})

describe('continuationPrefix', () => {
  it('continues a bullet, a todo and a quote', () => {
    expect(continuationPrefix('- milk')).toBe('- ')
    expect(continuationPrefix('- [x] eggs')).toBe('- [ ] ')
    expect(continuationPrefix('> quoted')).toBe('> ')
  })

  it('counts an ordered list on', () => {
    expect(continuationPrefix('3. third')).toBe('4. ')
  })

  it('preserves the indent of a nested item', () => {
    expect(continuationPrefix('    - nested')).toBe('    - ')
  })

  it('ends the list when Enter is pressed on an empty item', () => {
    expect(continuationPrefix('- ')).toBe('')
    expect(continuationPrefix('- [ ] ')).toBe('')
    expect(continuationPrefix('1. ')).toBe('')
  })

  it('starts plain after a heading or a paragraph', () => {
    expect(continuationPrefix('# Title')).toBe('')
    expect(continuationPrefix('words')).toBe('')
  })
})

describe('toggleTodo', () => {
  it('flips both ways and leaves the text alone', () => {
    expect(toggleTodo('- [ ] milk')).toBe('- [x] milk')
    expect(toggleTodo('- [x] milk')).toBe('- [ ] milk')
  })

  it('ignores a line that is not a todo', () => {
    expect(toggleTodo('- milk')).toBe('- milk')
  })
})

const flat = (tokens) =>
  tokens.map((t) => (t.children ? { [t.type]: flat(t.children) } : { [t.type]: t.text }))

describe('parseInline', () => {
  it('reads the basic spans', () => {
    expect(flat(parseInline('a **b** c'))).toEqual([
      { text: 'a ' }, { bold: [{ text: 'b' }] }, { text: ' c' },
    ])
    expect(flat(parseInline('`code`'))).toEqual([{ code: 'code' }])
    expect(flat(parseInline('~~gone~~'))).toEqual([{ strike: [{ text: 'gone' }] }])
  })

  it('nests emphasis', () => {
    expect(flat(parseInline('**bold _and thin_**'))).toEqual([
      { bold: [{ text: 'bold ' }, { italic: [{ text: 'and thin' }] }] },
    ])
  })

  it('does not re-read markdown inside code', () => {
    expect(flat(parseInline('`**literal**`'))).toEqual([{ code: '**literal**' }])
  })

  it('leaves underscores inside a word alone', () => {
    expect(flat(parseInline('call snake_case_name now'))).toEqual([
      { text: 'call snake_case_name now' },
    ])
  })

  it('reads a link into text and href', () => {
    expect(parseInline('see [docs](https://x.dev/a)')[1]).toMatchObject({
      type: 'link', text: 'docs', href: 'https://x.dev/a',
    })
  })

  it('leaves an unclosed span as literal text', () => {
    expect(flat(parseInline('**not closed'))).toEqual([{ text: '**not closed' }])
  })
})

describe('sourceOffset', () => {
  // This is what makes clicking into a formatted line land the caret where
  // the user aimed instead of at the end of the line.
  it('is the identity on a plain line', () => {
    expect(sourceOffset('plain words', 6)).toBe(6)
  })

  it('skips the block marker', () => {
    // "## Title": rendered offset 0 is the 'T' at source offset 3.
    expect(sourceOffset('## Title', 0)).toBe(3)
    expect(sourceOffset('- [ ] milk', 0)).toBe(6)
  })

  it('skips inline markers', () => {
    // "a **bc** d" renders as "a bc d"; rendered 2 is 'b' at source 4.
    expect(sourceOffset('a **bc** d', 2)).toBe(4)
    // rendered 5 is 'd', which follows the closing '**'.
    expect(sourceOffset('a **bc** d', 5)).toBe(9)
  })

  it('clamps a click past the end of the rendered text', () => {
    expect(sourceOffset('# Hi', 99)).toBe(4)
  })

  it('agrees with the rendered length for every offset', () => {
    const raw = '- [x] a `b` **c _d_** [e](https://f.g)'
    const map = inlineMap(classifyLine(raw).body)
    for (let i = 0; i < map.length; i++) {
      expect(sourceOffset(raw, i)).toBeLessThanOrEqual(raw.length)
    }
  })
})

describe('safeHref', () => {
  it('allows web, mail and relative links', () => {
    expect(safeHref('https://x.dev')).toBe('https://x.dev')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeHref('/notes/x')).toBe('/notes/x')
  })

  it('refuses anything that could execute when someone else opens the note', () => {
    expect(safeHref('javascript:alert(1)')).toBe(null)
    expect(safeHref('  JavaScript:alert(1)')).toBe(null)
    expect(safeHref('data:text/html,<script>')).toBe(null)
  })
})
