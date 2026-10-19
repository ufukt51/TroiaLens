import { TraceParser } from './parser.ts'
import { analyze } from './analyze.ts'
import { displayText, displayWidth, eachLine, NotUtf8, type TraceEncoding } from './lines.ts'
import type { TraceResult } from './types.ts'

export type WorkerRequest =
  /** A file (or text) in the browser, read with its line index for the raw and source views */
  | { kind: 'analyze'; blob: Blob }
  /** The Notepad++ document, as UTF-8; the editor shows its lines, so no index */
  | { kind: 'analyze'; stream: ReadableStream<Uint8Array> }
  | { kind: 'search'; blob: Blob; encoding: TraceEncoding; query: string; limit: number }

export interface Analyzed {
  result: TraceResult
  encoding: TraceEncoding
  size: number
  /** Byte offset where each line starts, and the columns it takes in a view (only for a blob) */
  offsets?: Uint32Array | Float64Array
  widths?: Uint32Array
}

/** Growable list of line starts and widths */
class LineIndex {
  offsets: Uint32Array | Float64Array
  widths = new Uint32Array(1 << 16)
  n = 0

  constructor(private readonly big: boolean) {
    this.offsets = big ? new Float64Array(1 << 16) : new Uint32Array(1 << 16)
  }

  add(offset: number, width: number) {
    if (this.n === this.widths.length) {
      const offsets = this.big ? new Float64Array(this.n * 2) : new Uint32Array(this.n * 2)
      offsets.set(this.offsets)
      this.offsets = offsets
      const widths = new Uint32Array(this.n * 2)
      widths.set(this.widths)
      this.widths = widths
    }
    this.offsets[this.n] = offset
    this.widths[this.n++] = width
  }
}

async function analyzeTrace(req: Extract<WorkerRequest, { kind: 'analyze' }>): Promise<Analyzed> {
  const t0 = performance.now()
  const blob = 'blob' in req ? req.blob : null
  // Canias writes traces as UTF-8; older setups may use the Turkish Windows code page
  let encoding: TraceEncoding = 'utf-8'
  for (;;) {
    const parser = new TraceParser()
    const index = blob ? new LineIndex(blob.size >= 2 ** 32) : null
    try {
      const size = await eachLine(
        blob ? blob.stream() : (req as { stream: ReadableStream<Uint8Array> }).stream,
        encoding,
        (text, start, hiddenCr, cut) => {
          parser.push(text, hiddenCr)
          index?.add(start, displayWidth(displayText(text, cut)))
        },
        // The plugin sends UTF-8 and cannot send it again
        !!blob && encoding === 'utf-8',
      )
      const parsed = parser.finish()
      const analysis = analyze(parsed)
      return {
        result: { parsed, analysis, parseMs: performance.now() - t0 },
        encoding,
        size,
        offsets: index?.offsets.slice(0, index.n),
        widths: index?.widths.slice(0, index.n),
      }
    } catch (e) {
      if (e instanceof NotUtf8 && encoding === 'utf-8') {
        encoding = 'windows-1254'
        continue
      }
      throw e
    }
  }
}

/** Lines whose text contains the query (any case), in file order */
async function search(req: Extract<WorkerRequest, { kind: 'search' }>): Promise<Uint32Array> {
  const q = req.query.toLowerCase()
  const out: number[] = []
  let i = 0
  await eachLine(
    req.blob.stream(),
    req.encoding,
    (text) => {
      if (text.toLowerCase().includes(q)) out.push(i)
      i++
      return out.length < req.limit
    },
    false,
  )
  return Uint32Array.from(out)
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.kind === 'search') {
      const lines = await search(e.data)
      self.postMessage({ ok: true, lines }, { transfer: [lines.buffer] })
    } else {
      const r = await analyzeTrace(e.data)
      const transfer = r.offsets && r.widths ? [r.offsets.buffer, r.widths.buffer] : []
      self.postMessage({ ok: true, ...r }, { transfer })
    }
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
