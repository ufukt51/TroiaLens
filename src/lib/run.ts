import type { TraceResult } from './types.ts'
import type { Analyzed, WorkerRequest } from './worker.ts'
import { LineSource } from './source.ts'

export interface AnalyzedTrace {
  result: TraceResult
  /** Lines for the raw and source views; null in Notepad++, where the editor shows them */
  source: LineSource | null
  size: number
}

/** Runs one request in its own Web Worker, so large files don't freeze the page; cancel stops it */
function inWorker<T>(req: WorkerRequest, transfer: Transferable[] = []): { promise: Promise<T>; cancel: () => void } {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  let cancel = () => worker.terminate()
  const promise = new Promise<T>((resolve, reject) => {
    cancel = () => {
      worker.terminate()
      reject(new Error('İptal edildi'))
    }
    worker.onmessage = (e) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data as T)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Analiz sırasında hata oluştu'))
    }
    worker.postMessage(req, transfer)
  })
  return { promise, cancel }
}

/** A file, or pasted text as a Blob: read in pieces, never as one string */
export async function analyzeBlob(blob: Blob): Promise<AnalyzedTrace> {
  const r = await inWorker<Analyzed>({ kind: 'analyze', blob }).promise
  return { result: r.result, size: r.size, source: new LineSource(blob, r.encoding, r.offsets!, r.widths!) }
}

/** The document the Notepad++ plugin serves; its body streams straight into the worker */
export async function analyzeUrl(url: string): Promise<AnalyzedTrace> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(`Dosya okunamadı (${res.status})`)
  const r = await inWorker<Analyzed>({ kind: 'analyze', stream: res.body }, [res.body]).promise
  return { result: r.result, size: r.size, source: null }
}

/** Lines containing the query (any case), at most limit of them */
export function searchLines(source: LineSource, query: string, limit: number): { promise: Promise<Uint32Array>; cancel: () => void } {
  const job = inWorker<{ lines: Uint32Array }>({ kind: 'search', blob: source.blob, encoding: source.encoding, query, limit })
  return { promise: job.promise.then((r) => r.lines), cancel: job.cancel }
}

/** "user_TRANSACTION_PID_YYYY_MM_0DD_HH_MM_SS_MS.txt" → parts */
export function parseFileName(name: string): { user?: string; transaction?: string; date?: string } {
  const m = name.match(/^(.+?)_([A-Z0-9]+)_\d+_(\d{4})_(\d{1,2})_0?(\d{1,2})_(\d{2})_(\d{2})_(\d{2})/i)
  if (!m) return {}
  const [, user, transaction, y, mo, d, h, mi, s] = m
  return { user, transaction: transaction.toUpperCase(), date: `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${y} ${h}:${mi}:${s}` }
}
