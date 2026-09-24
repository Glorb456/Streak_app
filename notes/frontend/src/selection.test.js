import { describe, expect, it } from 'vitest'
import { pickSelection } from './selection.js'

const sticky = { id: 'sticky', sticky: true, pages: [{ id: 'note-1' }] }
const work = { id: 'work', pages: [{ id: 'w-1' }, { id: 'w-2' }] }
const ideas = { id: 'ideas', pages: [] }

describe('pickSelection', () => {
  it('empties the selection for an empty notebook', () => {
    expect(pickSelection([], 'work', 'w-1')).toEqual({ sectionId: null, pageId: null })
  })

  it('skips Sticky Notes when nothing is selected yet', () => {
    // Sticky Notes is pinned first by the server, so "first section" and
    // "the section to open on" are deliberately different answers.
    expect(pickSelection([sticky, work], null, null))
      .toEqual({ sectionId: 'work', pageId: 'w-1' })
  })

  it('falls back to Sticky Notes only when it is the whole notebook', () => {
    expect(pickSelection([sticky], null, null))
      .toEqual({ sectionId: 'sticky', pageId: 'note-1' })
  })

  it('leaves a section the user chose alone, sticky included', () => {
    expect(pickSelection([sticky, work], 'sticky', 'note-1'))
      .toEqual({ sectionId: 'sticky', pageId: 'note-1' })
  })

  it('keeps a valid selection untouched', () => {
    expect(pickSelection([sticky, work], 'work', 'w-2'))
      .toEqual({ sectionId: 'work', pageId: 'w-2' })
  })

  it('repairs a page id that no longer exists', () => {
    expect(pickSelection([sticky, work], 'work', 'deleted'))
      .toEqual({ sectionId: 'work', pageId: 'w-1' })
  })

  it('repairs a section id that no longer exists, still skipping sticky', () => {
    expect(pickSelection([sticky, work], 'gone', 'w-1'))
      .toEqual({ sectionId: 'work', pageId: 'w-1' })
  })

  it('selects no page in an empty section', () => {
    expect(pickSelection([sticky, ideas], 'ideas', null))
      .toEqual({ sectionId: 'ideas', pageId: null })
  })
})
