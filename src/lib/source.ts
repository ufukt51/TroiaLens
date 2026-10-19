import { charStart, DISPLAY_CAP, displayText, type TraceEncoding } from './lines.ts'

const BLOCK = 256
/** A block whose lines take at most this many bytes is read in one go */
const BLOCK_BYTES = 4 << 20
/** Bytes of a line read for a view: enough for DISPLAY_CAP characters */
const LINE_BYTES = DISPLAY_CAP * 4
/** Characters of read lines kept in memory; the oldest blocks go first */
const KEEP_CHARS = 16_000_000

/**
 * Lines of a trace file for the raw and source views, read from the file as they come into view: only an index
 * (where each line starts, how wide it is) stays in memory, so the file may be larger than a string can be.
 */
export class LineSource {
  readonly count: number
  /** Changes whenever lines arrive */
  version = 0
  private readonly blocks = new Map<number, string[]>()
  private readonly loading = new Set<number>()
  private readonly listeners = new Set<() => void>()
  private chars = 0

  constructor(
    readonly blob: Blob,
    readonly encoding: TraceEncoding,
    private readonly offsets: ArrayLike<number>,
    /** Columns each line takes in a view, tabs expanded */
    readonly widths: Uint32Array,
  ) {
    this.count = widths.length
  }

  /** Text shown for a line, undefined until it has been read */
  get(i: number): string | undefined {
    return this.blocks.get(Math.floor(i / BLOCK))?.[i % BLOCK]
  }

  /** Reads lines from..to (exclusive) that are not in memory; subscribers hear when they arrive */
  load(from: number, to: number) {
    const end = Math.min(to, this.count)
    for (let b = Math.max(0, Math.floor(from / BLOCK)); b * BLOCK < end; b++) {
      if (this.blocks.has(b) || this.loading.has(b)) continue
      this.loading.add(b)
      this.read(b)
        .then((lines) => {
          this.blocks.set(b, lines)
          for (const l of lines) this.chars += l.length
          for (const [k, old] of this.blocks) {
            if (this.chars <= KEEP_CHARS || k === b) break
            this.blocks.delete(k)
            for (const l of old) this.chars -= l.length
          }
          this.version++
          for (const fn of this.listeners) fn()
        })
        .catch(() => {
          // The file is gone (e.g. replaced on disk); its lines stay empty
        })
        .finally(() => this.loading.delete(b))
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = (): number => this.version

  private start(i: number): number {
    return this.offsets[i]
  }

  /** End of a line, its LF included */
  private end(i: number): number {
    return i + 1 < this.count ? this.offsets[i + 1] : this.blob.size
  }

  private async read(b: number): Promise<string[]> {
    const first = b * BLOCK
    const last = Math.min(this.count, first + BLOCK)
    const decoder = new TextDecoder(this.encoding, { ignoreBOM: true })
    const lines: string[] = []
    const from = this.start(first)
    const to = this.end(last - 1)
    if (to - from <= BLOCK_BYTES) {
      const bytes = new Uint8Array(await this.blob.slice(from, to).arrayBuffer())
      for (let i = first; i < last; i++) lines.push(this.text(bytes.subarray(this.start(i) - from, this.end(i) - from), i, decoder))
    } else {
      // Very long lines: only as much of each as a view shows
      for (let i = first; i < last; i++) {
        const s = this.start(i)
        const bytes = new Uint8Array(await this.blob.slice(s, s + Math.min(this.end(i) - s, LINE_BYTES + 1)).arrayBuffer())
        lines.push(this.text(bytes, i, decoder))
      }
    }
    return lines
  }

  /** A line's text as the analysis index measured it (see displayText) */
  private text(bytes: Uint8Array, i: number, decoder: TextDecoder): string {
    let b = bytes
    if (i + 1 < this.count && b.length && b[b.length - 1] === 10) b = b.subarray(0, b.length - 1)
    let cut = false
    if (b.length > LINE_BYTES) {
      cut = true
      b = b.subarray(0, LINE_BYTES)
      if (this.encoding === 'utf-8') b = b.subarray(0, charStart(b, b.length))
    } else if (b.length && b[b.length - 1] === 13) b = b.subarray(0, b.length - 1)
    let t = decoder.decode(b)
    if (i === 0 && this.encoding === 'utf-8' && t.charCodeAt(0) === 0xfeff) t = t.slice(1)
    return displayText(t, cut)
  }
}
