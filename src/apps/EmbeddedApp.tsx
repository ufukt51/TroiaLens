import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FileQuestion, FileSearch, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { AnalysisPage } from '../pages/AnalysisPage.tsx'
import { analyzeBlob, analyzeUrl, type AnalyzedTrace } from '../lib/run.ts'
import { onHostMessage, postToHost, setTheme } from '../lib/host.ts'
import { DocStateContext, DocStore, packState, unpackState, type Packed } from '../lib/docState.ts'
import type { LoadedTrace, TraceResult } from '../lib/types.ts'

type View =
  | { kind: 'waiting' }
  | { kind: 'busy'; name: string }
  | { kind: 'notTrace'; name: string }
  | { kind: 'error'; name: string; message: string }
  | { kind: 'ready'; trace: LoadedTrace; store: DocStore }

/** View state of a document whose analysis is no longer kept; fp tells whether its row ids still fit */
interface Snapshot {
  fp: string
  packed: Promise<Packed>
}

/** A kept analysis, shown again at once while the document's text stays at version gen */
interface Kept {
  gen: number
  fp: string
  trace: LoadedTrace
  store: DocStore
  weight: number
}

// Analyses kept for documents the user may come back to, at most this much heap in all; the shown one always
// stays. Measured about 650 bytes per statement: a 31 MB trace takes ~50 MB, a 700 MB one ~300 MB.
const KEEP_BUDGET = 640 * 1024 * 1024
const weightOf = (r: TraceResult) => r.parsed.statements.length * 700 + (1 << 20)

// Snapshots are a few hundred bytes; the oldest go beyond this many documents
const MAX_SNAPSHOTS = 200

/** The same analysis, so statement and scope ids mean the same rows */
const fingerprint = ({ parsed, analysis }: TraceResult) =>
  `${parsed.lineCount}:${parsed.statements.length}:${parsed.scopes.length}:${analysis.totals.totalMs}`

/** The document changed: rows, lines and scroll positions no longer fit, the open tab still does */
const tabOnly = (values: Map<string, unknown>) => new Map([...values].filter(([k]) => k === 'tab'))

/**
 * Notepad++ panel: the plugin sends the active document, the page reports clicked lines back. Analyses of recent
 * documents are kept, so switching back to one is instant; the others keep only a snapshot of their view state.
 */
export function EmbeddedApp() {
  const [view, setView] = useState<View>({ kind: 'waiting' })
  const [slideOver, setSlideOver] = useState(false)
  // Every load gets a ticket; results of an older load are dropped when the user switches tabs quickly
  const ticket = useRef(0)
  // Most recently shown last
  const kept = useRef(new Map<string, Kept>())
  const snapshots = useRef(new Map<string, Snapshot>())

  const keep = useCallback((doc: string, k: Kept) => {
    const all = kept.current
    all.delete(doc)
    all.set(doc, k)
    let total = 0
    for (const x of all.values()) total += x.weight
    for (const [d, x] of all) {
      if (total <= KEEP_BUDGET) break
      if (d === doc) continue
      all.delete(d)
      total -= x.weight
      if (x.store.values.size === 0) continue
      const snaps = snapshots.current
      snaps.set(d, { fp: x.fp, packed: packState(x.store.values) })
      for (const old of snaps.keys()) {
        if (snaps.size <= MAX_SNAPSHOTS) break
        snaps.delete(old)
      }
    }
  }, [])

  const load = useCallback(
    async (name: string, doc: string | undefined, gen: number | undefined, analyzeIt: () => Promise<AnalyzedTrace>) => {
      const my = ++ticket.current
      setView({ kind: 'busy', name })
      try {
        const { result, size } = await analyzeIt()
        if (my !== ticket.current) return
        if (result.parsed.statements.length === 0) {
          setView({ kind: 'notTrace', name })
          return
        }
        const fp = fingerprint(result)
        // The view state of an older version, kept or packed
        let values = new Map<string, unknown>()
        const prev = doc === undefined ? undefined : kept.current.get(doc)
        const snapshot = doc === undefined ? undefined : snapshots.current.get(doc)
        if (prev) values = prev.fp === fp ? prev.store.values : tabOnly(prev.store.values)
        else if (snapshot) {
          try {
            values = await unpackState(await snapshot.packed)
          } catch {
            // Starts over then
          }
          if (my !== ticket.current) return
          if (snapshot.fp !== fp) values = tabOnly(values)
        }
        const store = new DocStore(values)
        // The editor shows the lines; the page keeps only the analysis
        const trace: LoadedTrace = { id: my, name, size, source: null, result }
        if (doc !== undefined && gen !== undefined) {
          snapshots.current.delete(doc)
          keep(doc, { gen, fp, trace, store, weight: weightOf(result) })
        }
        setView({ kind: 'ready', trace, store })
      } catch (e) {
        if (my === ticket.current) setView({ kind: 'error', name, message: e instanceof Error ? e.message : String(e) })
      }
    },
    [keep],
  )

  useEffect(() => {
    const off = onHostMessage((msg) => {
      switch (msg.type) {
        case 'theme':
          setTheme(msg.dark)
          break
        case 'prefs':
          setSlideOver(msg.detailSlideOver)
          break
        case 'show': {
          // A load still running for another document is dropped either way
          ticket.current++
          const k = kept.current.get(msg.doc)
          if (k && k.gen === msg.gen) {
            keep(msg.doc, k)
            setView({ kind: 'ready', trace: k.trace, store: k.store })
            break
          }
          setView({ kind: 'busy', name: msg.name })
          postToHost({ type: 'need', doc: msg.doc, gen: msg.gen })
          break
        }
        case 'load':
          void load(msg.name, undefined, undefined, () => analyzeBlob(new Blob([msg.text], { type: 'text/plain' })))
          break
        case 'loadUrl':
          void load(msg.name, msg.doc, msg.gen, () => analyzeUrl(msg.url))
          break
        case 'notTrace':
          ticket.current++
          setView({ kind: 'notTrace', name: msg.name })
          break
        case 'empty':
          ticket.current++
          setView({ kind: 'waiting' })
          break
        case 'forget':
          kept.current.delete(msg.doc)
          snapshots.current.delete(msg.doc)
          break
      }
    })
    postToHost({ type: 'ready' })
    return off
  }, [load, keep])

  switch (view.kind) {
    case 'ready':
      return (
        <div className="h-dvh">
          <DocStateContext.Provider value={view.store}>
            <AnalysisPage key={view.trace.id} trace={view.trace} embedded detailSlideOver={slideOver} />
          </DocStateContext.Provider>
        </div>
      )
    case 'busy':
      return (
        <Center icon={<Loader2 className="h-7 w-7 animate-spin text-brand-500" />} title="Analiz ediliyor…">
          <span className="font-mono text-xs break-all">{view.name}</span>
        </Center>
      )
    case 'notTrace':
      return (
        <Center icon={<FileQuestion className="h-7 w-7" />} title="Bu bir Troia trace dosyası değil">
          <span className="font-mono text-xs break-all">{view.name}</span>
          <div className="mt-2">Troia trace dosyası ".trace" uzantılıdır ya da "TROIA CODE EXECUTION TRACE" satırıyla başlar.</div>
        </Center>
      )
    case 'error':
      return (
        <Center icon={<TriangleAlert className="h-7 w-7 text-rose-500" />} title="Analiz başarısız">
          <span className="font-mono text-xs break-all">{view.name}</span>
          <div className="mt-2 text-rose-600 dark:text-rose-400">{view.message}</div>
          <button className="btn-outline mt-4" onClick={() => postToHost({ type: 'reload' })}>
            <RefreshCw className="h-4 w-4" /> Tekrar dene
          </button>
        </Center>
      )
    default:
      return (
        <Center icon={<FileSearch className="h-7 w-7" />} title="TroiaLens">
          Notepad++'ta bir Troia trace dosyası (.trace) açın; analiz burada görünür.
        </Center>
      )
  }
}

function Center({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="text-slate-400">{icon}</div>
      <div className="font-medium text-slate-900 dark:text-white">{title}</div>
      {children && <div className="flex max-w-sm flex-col items-center text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </div>
  )
}
