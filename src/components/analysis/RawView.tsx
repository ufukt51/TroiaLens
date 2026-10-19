import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react'
import type { ParsedTrace } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import type { LineSource } from '../../lib/source.ts'
import { searchLines } from '../../lib/run.ts'
import { editorLine, traceLine } from '../../lib/locate.ts'
import { VirtualList } from '../ui.tsx'

const ROW_H = 20
const MAX_MATCHES = 50000

/** Lines are trace lines; the gutter numbers them like an editor does (bare CRs break lines there) */
export function RawView({ source, parsed, nav, target }: { source: LineSource; parsed: ParsedTrace; nav: Nav; target: { line: number; nonce: number } | null }) {
  useSyncExternalStore(source.subscribe, source.getVersion)
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number } | null>(null)
  const [goto, setGoto] = useState('')
  const [matches, setMatches] = useState<Uint32Array>(() => new Uint32Array(0))
  const [searching, setSearching] = useState(false)

  // The file is searched in a worker, a moment after typing stops
  useEffect(() => {
    const q = query.trim()
    setMatches(new Uint32Array(0))
    if (q.length < 2) return
    let job: ReturnType<typeof searchLines> | null = null
    const timer = setTimeout(() => {
      setSearching(true)
      job = searchLines(source, q, MAX_MATCHES)
      job.promise.then(setMatches, () => {}).finally(() => setSearching(false))
    }, 250)
    return () => {
      clearTimeout(timer)
      job?.cancel()
    }
  }, [source, query])

  const jump = (index: number) => {
    setActive(index)
    setScrollTo({ index, nonce: Date.now() })
  }

  useEffect(() => {
    if (target) jump(target.line - 1)
  }, [target])

  useEffect(() => {
    setHit(0)
    if (matches.length) jump(matches[0])
  }, [matches])

  const step = (d: number) => {
    if (!matches.length) return
    const n = (hit + d + matches.length) % matches.length
    setHit(n)
    jump(matches[n])
  }

  const onRange = useCallback((from: number, to: number) => source.load(from, to), [source])
  const q = query.trim()

  return (
    <div className="card flex min-h-[320px] flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-8"
            placeholder="Dosyada ara (en az 2 karakter)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && step(e.shiftKey ? -1 : 1)}
          />
        </div>
        <span className="flex items-center gap-1 text-xs tabular-nums text-slate-500">
          {searching ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aranıyor…
            </>
          ) : q.length >= 2 ? (
            matches.length ? `${hit + 1} / ${matches.length.toLocaleString('tr-TR')}${matches.length >= MAX_MATCHES ? '+' : ''}` : 'Sonuç yok'
          ) : (
            ''
          )}
        </span>
        <button className="btn-ghost p-1.5" onClick={() => step(-1)} aria-label="Önceki">
          <ChevronUp className="h-4 w-4" />
        </button>
        <button className="btn-ghost p-1.5" onClick={() => step(1)} aria-label="Sonraki">
          <ChevronDown className="h-4 w-4" />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const n = parseInt(goto, 10)
            if (n > 0) jump(Math.min(source.count, traceLine(parsed, n)) - 1)
          }}
        >
          <input className="input w-28 py-1 text-xs" placeholder="Satıra git" value={goto} onChange={(e) => setGoto(e.target.value.replace(/\D/g, ''))} />
        </form>
      </div>
      <VirtualList
        className="flex-1 bg-white dark:bg-slate-950"
        items={source.widths}
        rowHeight={ROW_H}
        scrollTo={scrollTo}
        onRange={onRange}
        render={(_, i) => {
          const line = source.get(i) ?? ''
          const isStmt = nav.stmtAtLine(i + 1) >= 0
          return (
            <div
              className={`flex h-full items-center font-mono text-xs whitespace-pre ${active === i ? 'bg-amber-100 dark:bg-amber-500/20' : ''} ${isStmt ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900' : ''}`}
              onClick={() => {
                const id = nav.stmtAtLine(i + 1)
                if (id >= 0) nav.select(id)
              }}
            >
              <span className="sticky left-0 w-16 shrink-0 bg-slate-50 pr-3 text-right text-[11px] text-slate-400 select-none dark:bg-slate-900">{editorLine(parsed, i + 1)}</span>
              <span className="pl-3 text-slate-700 dark:text-slate-300">{q.length >= 2 ? <Highlight text={line} q={q} /> : line}</span>
            </div>
          )
        }}
      />
      <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-800">
        {source.count.toLocaleString('tr-TR')} satır · trace satırına tıklayınca ayrıntısı açılır
      </div>
    </div>
  )
}

function Highlight({ text, q }: { text: string; q: string }) {
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  for (let j = lower.indexOf(ql); j !== -1; j = lower.indexOf(ql, i)) {
    parts.push(text.slice(i, j), <mark key={j} className="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-500/40">{text.slice(j, j + q.length)}</mark>)
    i = j + q.length
  }
  parts.push(text.slice(i))
  return <>{parts}</>
}
