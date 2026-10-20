import { useCallback, useEffect, useRef, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { Home } from '../pages/Home.tsx'
import { History } from '../pages/History.tsx'
import { AnalysisPage } from '../pages/AnalysisPage.tsx'
import { analyzeBlob, parseFileName } from '../lib/run.ts'
import { saveHistory } from '../lib/storage.ts'
import type { LoadedTrace } from '../lib/types.ts'

type Route = 'home' | 'analysis' | 'history'

function routeFromHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  if (h.startsWith('analiz')) return 'analysis'
  if (h.startsWith('gecmis')) return 'history'
  return 'home'
}

/** Browser app: upload or paste a trace, keep a history in IndexedDB. */
export function StandaloneApp() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [trace, setTrace] = useState<LoadedTrace | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loads = useRef(0)

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((r: Route) => {
    location.hash = r === 'analysis' ? '/analiz' : r === 'history' ? '/gecmis' : '/'
  }, [])

  const load = useCallback(
    async (name: string, file: Blob, opts: { remember?: boolean } = {}) => {
      setError(null)
      setBusy(name)
      try {
        const { result, source, size } = await analyzeBlob(file)
        if (result.parsed.statements.length === 0) {
          throw new Error('Dosyada Troia trace satırı bulunamadı. Canias\'ta "TROIA CODE EXECUTION TRACE" olarak alınmış bir .txt dosyası seçin.')
        }
        setTrace({ id: ++loads.current, name, size, source, result })
        if (opts.remember !== false) {
          const fromName = parseFileName(name)
          const info = result.analysis.info
          void saveHistory(
            {
              name,
              size,
              addedAt: Date.now(),
              transaction: info['Transaction'] ?? fromName.transaction,
              user: info['User Name'] ?? fromName.user,
              score: result.analysis.score,
              statements: result.analysis.totals.statements,
              sql: result.analysis.totals.sql,
            },
            file,
          )
        }
        navigate('analysis')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [navigate],
  )

  const effectiveRoute = route === 'analysis' && !trace ? 'home' : route

  return (
    <div className="flex min-h-dvh flex-col">
      <Header route={effectiveRoute} hasTrace={!!trace} navigate={navigate} />
      <main className="flex-1">
        {effectiveRoute === 'home' && <Home onLoad={load} busy={busy} error={error} onDismissError={() => setError(null)} navigate={navigate} />}
        {effectiveRoute === 'history' && <History onLoad={load} busy={busy} />}
        {effectiveRoute === 'analysis' && trace && (
          // Header is h-14 plus a 1px border; the analysis page fills the rest of the window
          <div className="h-[calc(100dvh-3.5rem-1px)]">
            <AnalysisPage key={trace.id} trace={trace} embedded={false} />
          </div>
        )}
      </main>
      {effectiveRoute !== 'analysis' && (
        <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-500">
          TroiaLens v{__APP_VERSION__} · Trace dosyaları yalnızca tarayıcınızda işlenir, hiçbir sunucuya gönderilmez. ·{' '}
          <a
            href="https://github.com/ufukt51/TroiaLens"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 align-middle underline-offset-2 hover:text-slate-700 hover:underline dark:hover:text-slate-300"
          >
            {/* lucide-react no longer ships brand icons; this is the GitHub mark (Octicons) */}
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-3.5">
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
            GitHub
          </a>
        </footer>
      )}
    </div>
  )
}
