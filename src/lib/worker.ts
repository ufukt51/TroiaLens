import { parseTrace } from './parser.ts'
import { analyze } from './analyze.ts'
import type { TraceResult } from './types.ts'

self.onmessage = (e: MessageEvent<{ text: string }>) => {
  try {
    const t0 = performance.now()
    const parsed = parseTrace(e.data.text)
    const analysis = analyze(parsed)
    const result: TraceResult = { parsed, analysis, parseMs: performance.now() - t0 }
    self.postMessage({ ok: true, result })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
