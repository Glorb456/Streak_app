import { describe, expect, it } from 'vitest'
import { ago, connState, entryAsset, shortHost, STATES } from './syncstate.js'

const S = (o) => connState({ online: true, fromCache: false, lastSyncAt: null, error: null, ...o })

describe('connState', () => {
  it('is ok once data has landed and nothing is failing', () => {
    expect(S({ lastSyncAt: 1 })).toBe('ok')
  })

  it('is connecting before the first answer', () => {
    expect(S({})).toBe('connecting')
  })

  it('is stale when the poll fails after data had landed', () => {
    expect(S({ lastSyncAt: 1, error: 'boom' })).toBe('stale')
  })

  it('is down when it fails and nothing ever landed', () => {
    expect(S({ error: 'boom' })).toBe('down')
  })

  it('reports the cached shell ahead of a plain failure', () => {
    expect(S({ error: 'boom', fromCache: true })).toBe('cached')
    // Even a tab that later managed one successful poll: the page itself
    // still came from the cache, and that is the more useful thing to say.
    expect(S({ error: 'boom', fromCache: true, lastSyncAt: 1 })).toBe('cached')
  })

  it('lets a cached shell that reconnected read as healthy', () => {
    expect(S({ fromCache: true, lastSyncAt: 1 })).toBe('ok')
  })

  it('puts being offline ahead of everything else', () => {
    expect(S({ online: false, error: 'boom', fromCache: true })).toBe('offline')
  })

  it('names a copy for every state it can return', () => {
    for (const st of ['ok', 'connecting', 'stale', 'down', 'cached', 'offline']) {
      expect(STATES[st]).toBeTruthy()
      expect(STATES[st].title).toBeTruthy()
      expect(STATES[st].tone).toBeTruthy()
    }
  })
})

describe('ago', () => {
  const t = Date.parse('2026-09-19T12:00:00Z')
  const at = (secondsEarlier) => ago(t - secondsEarlier * 1000, t)

  it('says never without a timestamp', () => {
    expect(ago(null, t)).toBe('never')
    expect(ago(Date.parse('nonsense'), t)).toBe('never')
  })

  it('reads in seconds, minutes, hours then days', () => {
    expect(at(2)).toBe('just now')
    expect(at(12)).toBe('12s ago')
    expect(at(90)).toBe('1 min ago')
    expect(at(3600)).toBe('1 h ago')
    expect(at(86400 * 3)).toBe('3 d ago')
  })

  it('never counts backwards from a clock skew', () => {
    expect(ago(t + 5000, t)).toBe('just now')
  })
})

describe('entryAsset', () => {
  it('pulls the hashed bundle out of a built index.html', () => {
    const html = '<script type="module" crossorigin src="/assets/index-BkaRkn-L.js"></script>'
    expect(entryAsset(html)).toBe('/assets/index-BkaRkn-L.js')
  })

  it('is null when there is nothing to compare', () => {
    expect(entryAsset('<html></html>')).toBe(null)
    expect(entryAsset('')).toBe(null)
    expect(entryAsset(null)).toBe(null)
  })
})

describe('shortHost', () => {
  it('keeps the host and drops the rest', () => {
    expect(shortHost('https://host.tail1234.ts.net/api')).toBe('host.tail1234.ts.net')
  })

  it('hands back anything it cannot parse', () => {
    expect(shortHost('not a url')).toBe('not a url')
  })
})
