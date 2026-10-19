/**
 * Reads a trace as a stream of lines without ever holding the whole file as one string (browsers cannot make a
 * string much longer than 512 MB, and a trace may be larger). Each line is decoded on its own, so a string kept
 * from it keeps only that line alive, not a chunk of the file.
 */

export type TraceEncoding = 'utf-8' | 'windows-1254'

/** The bytes are not valid UTF-8; read again as windows-1254 */
export class NotUtf8 extends Error {}

/** Longer lines are cut: only their beginning matters to the parser and the views */
export const MAX_LINE_BYTES = 1 << 20

/** Raw and source views show at most this many characters of a line */
export const DISPLAY_CAP = 10000
export const DISPLAY_CUT = ' … [satırın devamı gösterilmiyor]'

export type ByteSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>

async function* chunks(source: ByteSource): AsyncGenerator<Uint8Array> {
  if ('getReader' in source) {
    const reader = source.getReader()
    let done = false
    try {
      for (;;) {
        const r = await reader.read()
        if (r.done) {
          done = true
          return
        }
        if (r.value.length) yield r.value
      }
    } finally {
      // Stopped early: the rest is not needed
      if (!done) void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } else {
    for await (const c of source) if (c.length) yield c
  }
}

function countCr(b: Uint8Array, from: number, to: number): number {
  let n = 0
  for (let i = b.indexOf(13, from); i !== -1 && i < to; i = b.indexOf(13, i + 1)) n++
  return n
}

/** Start of the UTF-8 character at or before i, so a cut never splits one */
export function charStart(b: Uint8Array, i: number): number {
  while (i > 0 && (b[i] & 0xc0) === 0x80) i--
  return i
}

/**
 * Calls onLine for every line, split like text.split(/\r?\n/): the CR of a CRLF goes, bare CRs stay in the line.
 * A line cut at MAX_LINE_BYTES reports the bare CRs of its dropped part in hiddenCr; onLine returning false stops
 * the reading. Returns the bytes read. UTF-8 is read strictly when strict is set: the first invalid line throws NotUtf8.
 */
export async function eachLine(
  source: ByteSource,
  encoding: TraceEncoding,
  onLine: (text: string, start: number, hiddenCr: number, cut: boolean) => void | boolean,
  strict = encoding === 'utf-8',
): Promise<number> {
  let stopped = false
  const decoder = new TextDecoder(encoding, { fatal: strict, ignoreBOM: true })
  let first = true
  // Current line when it spans chunks: its kept bytes, and what was dropped past MAX_LINE_BYTES
  let carry = new Uint8Array(1 << 16)
  let carried = 0
  let dropped = 0
  let droppedCr = 0
  let droppedLast = -1
  let start = 0
  let pos = 0

  const emit = (kept: Uint8Array, cut: boolean, hiddenCr: number) => {
    let bytes = kept
    if (cut) bytes = kept.subarray(0, charStart(kept, kept.length))
    else if (bytes.length && bytes[bytes.length - 1] === 13) bytes = bytes.subarray(0, bytes.length - 1)
    let text: string
    try {
      text = decoder.decode(bytes)
    } catch {
      throw new NotUtf8('UTF-8 değil')
    }
    if (first) {
      first = false
      if (encoding === 'utf-8' && text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    }
    if (onLine(text, start, hiddenCr, cut) === false) stopped = true
  }

  const keep = (b: Uint8Array, from: number, to: number) => {
    const room = MAX_LINE_BYTES - carried
    const take = Math.min(room, to - from)
    if (take > 0) {
      if (carried + take > carry.length) {
        const next = new Uint8Array(Math.min(MAX_LINE_BYTES, Math.max(carry.length * 2, carried + take)))
        next.set(carry.subarray(0, carried))
        carry = next
      }
      carry.set(b.subarray(from, from + take), carried)
      carried += take
    }
    if (take < to - from) {
      dropped += to - from - take
      droppedCr += countCr(b, from + take, to)
      droppedLast = b[to - 1]
    }
  }

  const flushCarry = () => {
    const cut = dropped > 0
    // The CR of a CRLF ends the dropped part; it is not a bare CR
    emit(carry.subarray(0, carried), cut, cut ? droppedCr - (droppedLast === 13 ? 1 : 0) : 0)
    carried = dropped = droppedCr = 0
    droppedLast = -1
  }

  for await (const chunk of chunks(source)) {
    let p = 0
    while (p < chunk.length) {
      const nl = chunk.indexOf(10, p)
      const end = nl < 0 ? chunk.length : nl
      if (nl >= 0 && carried === 0 && dropped === 0) {
        // Whole line inside this chunk
        const len = end - p
        if (len > MAX_LINE_BYTES) {
          const hidden = countCr(chunk, p + MAX_LINE_BYTES, end) - (chunk[end - 1] === 13 ? 1 : 0)
          emit(chunk.subarray(p, p + MAX_LINE_BYTES), true, hidden)
        } else emit(chunk.subarray(p, end), false, 0)
      } else {
        keep(chunk, p, end)
        if (nl >= 0) flushCarry()
      }
      if (stopped) return pos + p
      if (nl < 0) break
      start = pos + nl + 1
      p = nl + 1
    }
    pos += chunk.length
  }
  // The last piece is a line too, even when empty (as split gives it)
  flushCarry()
  return pos
}

/** Text a raw or source view shows for a line */
export function displayText(text: string, cut: boolean): string {
  return cut || text.length > DISPLAY_CAP ? text.slice(0, DISPLAY_CAP) + DISPLAY_CUT : text
}

/** Columns a line takes with tabs expanded every 8 columns (as the source view lays it out) */
export function displayWidth(text: string): number {
  if (!text.includes('\t')) return text.length
  let col = 0
  for (const ch of text) col += ch === '\t' ? 8 - (col % 8) : ch.length
  return col
}
