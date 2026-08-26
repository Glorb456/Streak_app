// The .draw.json wire format.
//
// A drawing is a JSON envelope — readable, diffable, and the same "one file per
// page" the markdown side gets — but the sample stream inside each stroke is
// packed, because that is where essentially all of the bytes are. A minute of
// drawing is tens of thousands of samples; as JSON numbers that is hundreds of
// kilobytes per page, which would make every save and every cross-device pull
// noticeably slow.
//
// Packing, in order:
//   1. quantise x/y to 1/16 px and pressure to 1/255 — far below what a 3x
//      iPad can resolve, so nothing visible survives the round trip
//   2. delta against the previous sample — consecutive pen samples are
//      typically under 2 px apart, so the deltas are tiny
//   3. zigzag, so small negatives are small unsigned ints
//   4. LEB128 varint, so a typical delta costs one byte
//   5. base64, so it survives inside JSON
//
// Net effect is roughly 3 bytes per sample against ~30 for the naive encoding,
// and it stays lossless to within the quantisation step.

export const FORMAT = 'streaknotes.draw'
export const VERSION = 1
export const ENCODING = 'q16d1' // quantised 1/16, delta, varint — bump if changed

const XY_SCALE = 16
const P_SCALE = 255

const zigzag = (n) => (n << 1) ^ (n >> 31)
const unzigzag = (n) => (n >>> 1) ^ -(n & 1)

function writeVarint(bytes, value) {
  let v = value >>> 0
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  bytes.push(v)
}

function readVarint(bytes, cursor) {
  let result = 0
  let shift = 0
  for (;;) {
    const b = bytes[cursor.i++]
    if (b === undefined) throw new Error('truncated stroke data')
    result |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
    if (shift > 35) throw new Error('malformed stroke data')
  }
  return result >>> 0
}

const toBase64 = (bytes) => {
  let s = ''
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a long
  // stroke, which is exactly the case this format exists for.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.slice(i, i + 0x8000))
  }
  return btoa(s)
}

const fromBase64 = (b64) => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Pack a sample list into the base64 payload stored on a stroke element. */
export function encodePoints(points) {
  const bytes = []
  let px = 0
  let py = 0
  let pp = 0
  for (const p of points) {
    const x = Math.round(p.x * XY_SCALE)
    const y = Math.round(p.y * XY_SCALE)
    const pr = Math.max(0, Math.min(P_SCALE, Math.round((p.p ?? 0.5) * P_SCALE)))
    writeVarint(bytes, zigzag(x - px))
    writeVarint(bytes, zigzag(y - py))
    writeVarint(bytes, zigzag(pr - pp))
    px = x
    py = y
    pp = pr
  }
  return toBase64(bytes)
}

/** Unpack a payload back into samples. Throws on a corrupt payload rather than
 *  returning half a stroke, so the caller can drop that one element and still
 *  open the page. */
export function decodePoints(b64) {
  const bytes = fromBase64(b64)
  const cursor = { i: 0 }
  const out = []
  let x = 0
  let y = 0
  let p = 0
  while (cursor.i < bytes.length) {
    x += unzigzag(readVarint(bytes, cursor))
    y += unzigzag(readVarint(bytes, cursor))
    p += unzigzag(readVarint(bytes, cursor))
    out.push({ x: x / XY_SCALE, y: y / XY_SCALE, p: p / P_SCALE })
  }
  return out
}

// ------------------------------------------------------------------ ids

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Element id: random, not sequential.
 *
 *  Two devices drawing on the same page while both are offline must not mint
 *  the same id, or the merge would treat two different strokes as one. 72 bits
 *  of randomness makes that not worth thinking about again. */
export function newId() {
  const bytes = new Uint8Array(9)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  let s = ''
  for (const b of bytes) s += ALPHABET[b % 36]
  return s
}

// ------------------------------------------------------------- envelope

export const emptyDoc = (w = 1240, h = 1754) => ({
  format: FORMAT,
  version: VERSION,
  page: { w, h },
  rev: 0,
  elements: [],
  deleted: {},
})

/** Read a .draw.json body.
 *
 *  Tolerant on purpose: '{}' is what create_page writes for a new drawing, an
 *  empty file is what a half-finished sync leaves, and either has to open as a
 *  blank page rather than an error. A single unreadable stroke is dropped and
 *  the rest of the page still opens. */
export function parseDoc(text) {
  let raw
  try { raw = JSON.parse(text || '{}') } catch { raw = {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {}
  const doc = emptyDoc(raw.page?.w, raw.page?.h)
  doc.rev = Number.isFinite(raw.rev) ? raw.rev : 0
  doc.deleted = (raw.deleted && typeof raw.deleted === 'object') ? { ...raw.deleted } : {}
  const seen = new Set()
  for (const el of Array.isArray(raw.elements) ? raw.elements : []) {
    const parsed = parseElement(el)
    // A duplicate id would make deletes and moves ambiguous; first wins.
    if (!parsed || seen.has(parsed.id) || doc.deleted[parsed.id]) continue
    seen.add(parsed.id)
    doc.elements.push(parsed)
  }
  return doc
}

function parseElement(el) {
  if (!el || typeof el !== 'object' || typeof el.id !== 'string') return null
  if (el.type === 'stroke') {
    if (el.enc !== ENCODING || typeof el.points !== 'string') return null
    let points
    try { points = decodePoints(el.points) } catch { return null }
    if (!points.length) return null
    return {
      id: el.id,
      type: 'stroke',
      color: typeof el.color === 'string' ? el.color : '#ffffff',
      size: Number.isFinite(el.size) ? el.size : 3,
      opacity: Number.isFinite(el.opacity) ? el.opacity : 1,
      // ct orders the page (z-order, never changes); mt resolves a conflict
      // when two devices edited the same element.
      ct: Number.isFinite(el.ct) ? el.ct : 0,
      mt: Number.isFinite(el.mt) ? el.mt : 0,
      points,
    }
  }
  if (el.type === 'image') {
    if (typeof el.asset !== 'string') return null
    const num = (v, d) => (Number.isFinite(v) ? v : d)
    return {
      id: el.id,
      type: 'image',
      asset: el.asset,
      x: num(el.x, 0),
      y: num(el.y, 0),
      w: Math.max(1, num(el.w, 100)),
      h: Math.max(1, num(el.h, 100)),
      ct: num(el.ct, 0),
      mt: num(el.mt, 0),
    }
  }
  return null
}

export function serializeElement(el) {
  if (el.type === 'stroke') {
    return {
      id: el.id,
      type: 'stroke',
      color: el.color,
      size: Number(el.size.toFixed(2)),
      opacity: el.opacity === 1 ? undefined : Number(el.opacity.toFixed(2)),
      ct: el.ct,
      mt: el.mt,
      enc: ENCODING,
      points: encodePoints(el.points),
    }
  }
  const r = (v) => Number(v.toFixed(2))
  return {
    id: el.id,
    type: 'image',
    asset: el.asset,
    x: r(el.x), y: r(el.y), w: r(el.w), h: r(el.h),
    ct: el.ct,
    mt: el.mt,
  }
}

export function serializeDoc(doc) {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    page: doc.page,
    rev: doc.rev,
    elements: doc.elements.map(serializeElement),
    deleted: doc.deleted,
  })
}
