import { describe, expect, it } from 'vitest'
import { parseNotes, serializeNotes } from './notes.js'

describe('parseNotes', () => {
  it('empty text yields a single empty text line', () => {
    expect(parseNotes('')).toEqual([{ type: 'text', done: false, text: '' }])
  })

  it('parses plain lines as text', () => {
    expect(parseNotes('hello\nworld')).toEqual([
      { type: 'text', done: false, text: 'hello' },
      { type: 'text', done: false, text: 'world' },
    ])
  })

  it('parses unchecked and checked items', () => {
    expect(parseNotes('- [ ] milk\n- [x] eggs')).toEqual([
      { type: 'check', done: false, text: 'milk' },
      { type: 'check', done: true, text: 'eggs' },
    ])
  })

  it('parses an empty checkbox line', () => {
    expect(parseNotes('- [ ] ')).toEqual([{ type: 'check', done: false, text: '' }])
  })

  it('mixes text and check lines', () => {
    expect(parseNotes('shopping:\n- [ ] milk\ndone')).toEqual([
      { type: 'text', done: false, text: 'shopping:' },
      { type: 'check', done: false, text: 'milk' },
      { type: 'text', done: false, text: 'done' },
    ])
  })
})

describe('serializeNotes', () => {
  it('round-trips mixed content', () => {
    const text = 'shopping:\n- [ ] milk\n- [x] eggs\nplain tail'
    expect(serializeNotes(parseNotes(text))).toBe(text)
  })

  it('round-trips an empty checkbox', () => {
    const lines = [{ type: 'check', done: false, text: '' }]
    expect(parseNotes(serializeNotes(lines))).toEqual(lines)
  })

  it('marks done items with x', () => {
    expect(serializeNotes([{ type: 'check', done: true, text: 'eggs' }])).toBe('- [x] eggs')
  })
})
