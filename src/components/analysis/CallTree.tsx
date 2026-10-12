import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Database, Search } from 'lucide-react'
import type { ParsedTrace } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { fmtMs } from '../../lib/analyze.ts'
import { Bar, KindChip, VirtualList, msClass } from '../ui.tsx'

type Row = { scope: true; id: number; depth: number } | { scope: false; id: number; depth: number }

const ROW_H = 30

export function CallTree({
  parsed,
  nav,
  target,
  selected,
}: {
  parsed: ParsedTrace
  nav: Nav
  target: { ref: number; nonce: number } | null
  selected: number | null
}) {
  const { scopes, statements } = parsed
  const [expanded, setExpanded] = useState<Set<number>>(() => initialExpanded(parsed))
  const [showStmts, setShowStmts] = useState(true)
  const [showGuides, setShowGuides] = useState(true)
  const [query, setQuery] = useState('')
  const [onlySql, setOnlySql] = useState(false)
  const [minMs, setMinMs] = useState(0)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number } | null>(null)

  const filtering = query.trim() !== '' || onlySql || minMs > 0

  // Statements and scopes matching the active filters, plus every ancestor scope that leads to them
  const filter = useMemo(() => {
    if (!filtering) return null
    const q = query.trim().toUpperCase()
    const keep = new Uint8Array(scopes.length)
    const stmt = new Uint8Array(statements.length)
    const mark = (scopeId: number) => {
      for (let s = scopeId; s >= 0 && !keep[s]; s = scopes[s].parent) keep[s] = 1
    }
    for (const st of statements) {
      if (onlySql && !st.sql) continue
      if (minMs > 0 && st.ms < minMs) continue
      if (q && !st.code.toUpperCase().includes(q) && !(st.sql?.resolved?.toUpperCase().includes(q) ?? false)) continue
      stmt[st.id] = 1
      mark(st.scopeId)
    }
    if (q && !onlySql && minMs === 0) for (const s of scopes) if (s.name.toUpperCase().includes(q)) mark(s.id)
    return { keep, stmt }
  }, [filtering, query, onlySql, minMs, scopes, statements])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (scopeId: number, depth: number) => {
      // Explicit stack keeps very deep traces from overflowing the call stack
      const stack: { kids: number[]; i: number; depth: number }[] = [{ kids: scopes[scopeId].kids, i: 0, depth }]
      while (stack.length) {
        const f = stack[stack.length - 1]
        if (f.i >= f.kids.length) {
          stack.pop()
          continue
        }
        const k = f.kids[f.i++]
        if (k < 0) {
          const id = ~k
          if (filter && !filter.keep[id]) continue
          out.push({ scope: true, id, depth: f.depth })
          const open = filter ? !expanded.has(~id) : expanded.has(id)
          if (open) stack.push({ kids: scopes[id].kids, i: 0, depth: f.depth + 1 })
        } else {
          if (filter ? !filter.stmt[k] : !showStmts) continue
          out.push({ scope: false, id: k, depth: f.depth })
        }
      }
    }
    walk(0, 0)
    return out
  }, [scopes, expanded, showStmts, filter])

  // Reveal a statement or scope requested from another view
  useEffect(() => {
    if (!target) return
    const ref = target.ref
    const scopeId = ref < 0 ? ~ref : statements[ref].scopeId
    setQuery('')
    setOnlySql(false)
    setMinMs(0)
    if (ref >= 0) setShowStmts(true)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let s = ref < 0 ? scopes[scopeId].parent : scopeId; s > 0; s = scopes[s].parent) next.add(s)
      if (ref < 0) next.add(scopeId)
      return next
    })
    setHighlight(ref)
  }, [target, scopes, statements])

  useEffect(() => {
    if (highlight === null) return
    const idx = rows.findIndex((r) => (highlight < 0 ? r.scope && r.id === ~highlight : !r.scope && r.id === highlight))
    if (idx >= 0) setScrollTo({ index: idx, nonce: Date.now() })
  }, [rows, highlight])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      // While filtering everything is open by default; "~id" records an explicit collapse
      const key = filter ? ~id : id
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandToDepth = (d: number) => {
    const next = new Set<number>()
    for (const s of scopes) if (s.id > 0 && s.depth <= d) next.add(s.id)
    setExpanded(next)
  }

  const rootTotal = scopes[0].totalMs || 1

  return (
    <div className="card flex min-h-[320px] flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-8" placeholder="Metot, tablo veya kod ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={showStmts} onChange={(e) => setShowStmts(e.target.checked)} disabled={filtering} /> Satırlar
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} /> Çizgiler
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={onlySql} onChange={(e) => setOnlySql(e.target.checked)} /> Sadece SQL
        </label>
        <select className="input w-auto py-1 text-xs" value={minMs} onChange={(e) => setMinMs(Number(e.target.value))}>
          <option value={0}>Tüm süreler</option>
          <option value={1}>≥ 1 ms</option>
          <option value={10}>≥ 10 ms</option>
          <option value={100}>≥ 100 ms</option>
          <option value={1000}>≥ 1 sn</option>
        </select>
        <div className="flex gap-1">
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => expandToDepth(1)} title="2 seviye aç">
            <ChevronsUpDown className="h-3.5 w-3.5" /> 2 seviye
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => expandToDepth(Infinity)}>
            Tümünü aç
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setExpanded(new Set())}>
            <ChevronsDownUp className="h-3.5 w-3.5" /> Kapat
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60">
        <span className="flex-1">Çağrı / satır</span>
        <span className="hidden w-28 sm:block">Payı</span>
        <span className="w-16 text-right">Süre</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Eşleşen kayıt yok.</div>
      ) : (
        <VirtualList
          className="flex-1"
          items={rows}
          rowHeight={ROW_H}
          scrollTo={scrollTo}
          render={(r) => {
            const pad = { paddingLeft: 8 + r.depth * 16 }
            if (r.scope) {
              const s = scopes[r.id]
              const open = filter ? !expanded.has(~r.id) : expanded.has(r.id)
              const hasKids = s.kids.length > 0
              const hl = highlight === ~r.id
              return (
                <div
                  className={`relative flex h-full cursor-pointer items-center gap-2 border-b border-slate-50 pr-3 text-sm hover:bg-slate-50 dark:border-slate-800/40 dark:hover:bg-slate-800/40 ${
                    hl ? 'bg-brand-50 dark:bg-brand-900/30' : ''
                  }`}
                  style={pad}
                  onClick={() => hasKids && toggle(r.id)}
                  title={s.name}
                >
                  {showGuides && <Guides depth={r.depth} />}
                  <span className="w-4 shrink-0 text-slate-400">
                    {hasKids && (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                  </span>
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-[13px] font-semibold text-slate-900 dark:text-white">{s.label}</span>
                    <span className="ml-2 font-mono text-xs text-slate-500">{s.owner}</span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {s.totalSqlCount > 0 && (
                      <span className="chip bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Bu çağrı ve alt çağrılarındaki SQL">
                        <Database className="h-3 w-3" />
                        {s.totalSqlCount}
                      </span>
                    )}
                    <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Bu çağrı ve alt çağrılarındaki satırlar">
                      {s.totalStmtCount.toLocaleString('tr-TR')}
                    </span>
                  </span>
                  <span className="hidden w-28 shrink-0 sm:block">
                    <Bar value={s.totalMs} max={rootTotal} />
                  </span>
                  <span className={`w-16 shrink-0 text-right text-xs tabular-nums ${msClass(s.totalMs)}`}>{fmtMs(s.totalMs)}</span>
                </div>
              )
            }
            const st = statements[r.id]
            const hl = highlight === r.id || selected === r.id
            return (
              <div
                className={`relative flex h-full cursor-pointer items-center gap-2 border-b border-slate-50 pr-3 text-xs hover:bg-slate-50 dark:border-slate-800/40 dark:hover:bg-slate-800/40 ${
                  hl ? 'bg-brand-50 dark:bg-brand-900/30' : ''
                }`}
                style={pad}
                onClick={() => nav.select(st.id)}
              >
                {showGuides && <Guides depth={r.depth} />}
                <span className="w-4 shrink-0" />
                <span className="w-10 shrink-0 text-right font-mono text-[11px] text-slate-400">{st.srcLine}</span>
                <KindChip kind={st.kind} />
                <span className="min-w-0 flex-1 truncate font-mono text-slate-700 dark:text-slate-300">{st.code.split('\n')[0]}</span>
                {st.sql?.cached && <span className="chip shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">cache</span>}
                {st.sql?.rows !== undefined && <span className="shrink-0 text-[11px] text-slate-400">{st.sql.rows} satır</span>}
                {st.iterations !== undefined && st.iterations > 0 && <span className="shrink-0 text-[11px] text-amber-600">{st.iterations}×</span>}
                <span className="hidden w-28 shrink-0 sm:block" />
                <span className={`w-16 shrink-0 text-right tabular-nums ${msClass(st.ms)}`}>{fmtMs(st.ms)}</span>
              </div>
            )
          }}
        />
      )}
      <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-800">
        {rows.length.toLocaleString('tr-TR')} satır görünüyor · Süreler alt çağrıları da içerir
      </div>
    </div>
  )
}

/** Vertical lines under each ancestor's chevron plus a short tick into the row, so parent/child levels line up. */
function Guides({ depth }: { depth: number }) {
  if (depth === 0) return null
  const lines = []
  for (let d = 0; d < depth; d++) {
    lines.push(
      <span
        key={d}
        className={`pointer-events-none absolute top-0 bottom-0 border-l ${
          d === depth - 1 ? 'border-slate-300 dark:border-slate-600' : 'border-slate-200 dark:border-slate-700/70'
        }`}
        style={{ left: 16 + d * 16 }}
      />,
    )
  }
  lines.push(<span key="tick" className="pointer-events-none absolute top-1/2 h-px w-2 bg-slate-300 dark:bg-slate-600" style={{ left: 16 + (depth - 1) * 16 }} />)
  return <>{lines}</>
}

function initialExpanded(p: ParsedTrace): Set<number> {
  const set = new Set<number>()
  const limit = p.scopes.length < 60 ? Infinity : 1
  for (const s of p.scopes) if (s.id > 0 && s.depth <= limit) set.add(s.id)
  return set
}
