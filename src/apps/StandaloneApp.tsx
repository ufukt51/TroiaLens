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
          TroiaLens · Trace dosyaları yalnızca tarayıcınızda işlenir, hiçbir sunucuya gönderilmez.
        </footer>
      )}
    </div>
  )
}
