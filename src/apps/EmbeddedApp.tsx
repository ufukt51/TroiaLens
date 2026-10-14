import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FileQuestion, FileSearch, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { AnalysisPage } from '../pages/AnalysisPage.tsx'
import { analyzeInWorker } from '../lib/run.ts'
import { onHostMessage, postToHost, setTheme } from '../lib/host.ts'
import type { LoadedTrace } from '../lib/types.ts'

type View =
  | { kind: 'waiting' }
  | { kind: 'busy'; name: string }
  | { kind: 'notTrace'; name: string }
  | { kind: 'error'; name: string; message: string }
  | { kind: 'ready'; trace: LoadedTrace }

/** Notepad++ panel: the plugin sends the active document, the page reports clicked lines back. */
export function EmbeddedApp() {
  const [view, setView] = useState<View>({ kind: 'waiting' })
  const [slideOver, setSlideOver] = useState(false)
  // Every load gets a ticket; results of an older load are dropped when the user switches tabs quickly
  const ticket = useRef(0)

  const load = useCallback(async (name: string, getText: () => Promise<string>) => {
    const my = ++ticket.current
    setView({ kind: 'busy', name })
    try {
      const text = await getText()
      const result = await analyzeInWorker(text)
      if (my !== ticket.current) return
      if (result.parsed.statements.length === 0) {
        setView({ kind: 'notTrace', name })
        return
      }
      setView({ kind: 'ready', trace: { id: my, name, size: new Blob([text]).size, text, result } })
    } catch (e) {
      if (my === ticket.current) setView({ kind: 'error', name, message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  useEffect(() => {
    const off = onHostMessage((msg) => {
      switch (msg.type) {
        case 'theme':
          setTheme(msg.dark)
          break
        case 'prefs':
          setSlideOver(msg.detailSlideOver)
          break
        case 'load':
          void load(msg.name, async () => msg.text)
          break
        case 'loadUrl':
          void load(msg.name, async () => {
            const res = await fetch(msg.url)
            if (!res.ok) throw new Error(`Dosya okunamadı (${res.status})`)
            return res.text()
          })
          break
        case 'notTrace':
          ticket.current++
          setView({ kind: 'notTrace', name: msg.name })
          break
        case 'empty':
          ticket.current++
          setView({ kind: 'waiting' })
          break
      }
    })
    postToHost({ type: 'ready' })
    return off
  }, [load])

  switch (view.kind) {
    case 'ready':
      return (
        <div className="h-dvh">
          <AnalysisPage key={view.trace.id} trace={view.trace} embedded detailSlideOver={slideOver} />
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
