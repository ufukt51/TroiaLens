import type { TraceResult } from './types.ts'

/** Parses and analyses a trace in a Web Worker so large files don't freeze the page. */
export function analyzeInWorker(text: string): Promise<TraceResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.result)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Analiz sırasında hata oluştu'))
    }
    worker.postMessage({ text })
  })
}

/** Canias writes traces as UTF-8; older setups may use the Turkish Windows code page. */
export async function readTraceFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1254').decode(buf)
  }
}

/** "user_TRANSACTION_PID_YYYY_MM_0DD_HH_MM_SS_MS.txt" → parts */
export function parseFileName(name: string): { user?: string; transaction?: string; date?: string } {
  const m = name.match(/^(.+?)_([A-Z0-9]+)_\d+_(\d{4})_(\d{1,2})_0?(\d{1,2})_(\d{2})_(\d{2})_(\d{2})/i)
  if (!m) return {}
  const [, user, transaction, y, mo, d, h, mi, s] = m
  return { user, transaction: transaction.toUpperCase(), date: `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${y} ${h}:${mi}:${s}` }
}
