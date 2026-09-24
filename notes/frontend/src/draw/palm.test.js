import { describe, expect, it } from 'vitest'
import { CHROME_PALM_MS, PALM_MS, PALM_SIZE, contactSize, isPalm } from './palm.js'

describe('contactSize', () => {
  it('reads a raw Touch by its radius, doubled to a diameter', () => {
    expect(contactSize({ radiusX: 24, radiusY: 9 })).toBe(48)
  })

  it('prefers the radius even when the pointer pair is also present', () => {
    // iOS reports width/height of 1 for every touch while filling in a real
    // radius; trusting width here is what used to let palms through.
    expect(contactSize({ radiusX: 30, radiusY: 30, width: 1, height: 1 })).toBe(60)
  })

  it('falls back to PointerEvent width/height', () => {
    expect(contactSize({ width: 12, height: 40 })).toBe(40)
  })

  it('answers 0 for an event carrying neither', () => {
    expect(contactSize({})).toBe(0)
    expect(contactSize(null)).toBe(0)
  })
})

describe('isPalm', () => {
  const tap = { size: 18, sincePen: 60_000, penDown: false, busy: false }

  it('lets a deliberate fingertip tap through', () => {
    expect(isPalm(tap)).toBe(false)
  })

  it('refuses anything while the pen tip is down', () => {
    expect(isPalm({ ...tap, penDown: true })).toBe(true)
  })

  it('refuses a palm-sized contact patch on its own', () => {
    expect(isPalm({ ...tap, size: PALM_SIZE + 1 })).toBe(true)
    expect(isPalm({ ...tap, size: PALM_SIZE })).toBe(false)
  })

  it('refuses a touch inside the window after pen contact', () => {
    expect(isPalm({ ...tap, sincePen: PALM_MS - 1 })).toBe(true)
    expect(isPalm({ ...tap, sincePen: PALM_MS })).toBe(false)
  })

  it('holds chrome locked longer than the canvas', () => {
    const settling = { ...tap, sincePen: PALM_MS + 100 }
    expect(isPalm(settling)).toBe(false)
    expect(isPalm({ ...settling, windowMs: CHROME_PALM_MS })).toBe(true)
  })

  it('refuses a second contact while a gesture already has an owner', () => {
    expect(isPalm({ ...tap, busy: true })).toBe(true)
  })

  it('treats an unmeasured touch with no pen history as a tap', () => {
    // A mouse-only browser reports neither a radius nor pen contact; the
    // gate must not quietly deaden the whole page there.
    expect(isPalm({})).toBe(false)
  })
})
