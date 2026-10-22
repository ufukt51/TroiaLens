import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Database, Info, Search, X } from 'lucide-react'
import type { ParsedTrace } from '../../lib/types.ts'
import type { Cursor, Nav } from '../../pages/AnalysisPage.tsx'
import { fmtMs } from '../../lib/analyze.ts'
import { Bar, KindChip, VirtualList, msClass } from '../ui.tsx'
import { Code } from '../SyntaxText.tsx'
import { usePersisted } from '../../lib/docState.ts'

type Row = { scope: true; id: number; depth: number } | { scope: false; id: number; depth: number }

const ROW_H = 30
const PAGE = 15

const rowRef = (r: Row) => (r.scope ? ~r.id : r.id)

export function CallTree({ parsed, nav, cursor }: { parsed: ParsedTrace; nav: Nav; cursor: Cursor | null }) {
  const { scopes, statements } = parsed
  // Levels below the root: the deepest call's own rows are one more; small traces start fully open, larger ones with two
  const maxLevel = useMemo(() => scopes.reduce((m, s) => Math.max(m, s.depth + 1), 1), [scopes])
  const [level, setLevel] = usePersisted('tree.level', () => (scopes.length < 60 ? maxLevel : Math.min(2, maxLevel)))
  const [expanded, setExpanded] = usePersisted<Set<number>>('tree.open', () => openAbove(parsed, level))
  const [showStmts, setShowStmts] = usePersisted('tree.stmts', true)
  const [showGuides, setShowGuides] = usePersisted('tree.guides', true)
  const [query, setQuery] = usePersisted('tree.query', '')
  const [onlySql, setOnlySql] = usePersisted('tree.sql', false)
  const [minMs, setMinMs] = usePersisted('tree.minMs', 0)
  const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number } | null>(null)
  // Row to scroll to as soon as it is listed (its ancestors may still be opening)
  const pending = useRef<number | null>(null)

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

  // While filtering everything is open by default; "~id" records an explicit collapse
  const isOpen = (id: number) => (filter ? !expanded.has(~id) : expanded.has(id))

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

  // Reveal the selected row: open its ancestors and drop filters that would hide it
  useEffect(() => {
    if (!cursor) return
    const ref = cursor.ref
    const scopeId = ref < 0 ? ~ref : statements[ref].scopeId
    const hidden = filter ? !(ref < 0 ? filter.keep[scopeId] : filter.stmt[ref]) : ref >= 0 && !showStmts
    const filtered = filter !== null && !hidden
    if (hidden) {
      setQuery('')
      setOnlySql(false)
      setMinMs(0)
      if (ref >= 0) setShowStmts(true)
    }
    setExpanded((prev) => {
      const open = (s: number) => (filtered ? !prev.has(~s) : prev.has(s))
      const need: number[] = []
      for (let s = ref < 0 ? scopes[scopeId].parent : scopeId; s > 0; s = scopes[s].parent) if (!open(s)) need.push(s)
      if (ref < 0 && cursor.open && !open(scopeId)) need.push(scopeId)
      if (!need.length) return prev
      const next = new Set(prev)
      for (const s of need) {
        if (filtered) next.delete(~s)
        else next.add(s)
      }
      return next
    })
    pending.current = ref
    // Only a new selection reveals; later filter or expand changes leave the view where the user put it
  }, [cursor])

  useEffect(() => {
    const ref = pending.current
    if (ref === null) return
    const idx = rows.findIndex((r) => rowRef(r) === ref)
    if (idx < 0) return
    pending.current = null
    setScrollTo({ index: idx, nonce: Date.now() })
  }, [rows, cursor])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      const key = filter ? ~id : id
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Opens the scopes whose depth passes `open` and closes the rest */
  const openOnly = (open: (depth: number) => boolean) => {
    const next = new Set<number>()
    for (const s of scopes) {
      if (s.id === 0) continue
      // While filtering everything is open unless collapsed as ~id
      if (filter) {
        if (!open(s.depth)) next.add(~s.id)
      } else if (open(s.depth)) next.add(s.id)
    }
    setExpanded(next)
  }

  /** Shows n levels of calls: scopes above level n are open */
  const showLevels = (n: number) => {
    const l = Math.max(1, Math.min(maxLevel, n))
    setLevel(l)
    openOnly((depth) => depth < l)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return
    const cur = cursor ? rows.findIndex((r) => rowRef(r) === cursor.ref) : -1
    const row = cur >= 0 ? rows[cur] : null
    const go = (i: number) => nav.pick(rowRef(rows[Math.max(0, Math.min(rows.length - 1, i))]))
    switch (e.key) {
      case 'ArrowDown':
        go(cur + 1)
        break
      case 'ArrowUp':
        go(cur - 1)
        break
      case 'PageDown':
        go(cur + PAGE)
        break
      case 'PageUp':
        go(cur - PAGE)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(rows.length - 1)
        break
      case 'ArrowRight':
        if (row?.scope && scopes[row.id].kids.length) {
          if (isOpen(row.id)) go(cur + 1)
          else toggle(row.id)
        }
        break
      case 'ArrowLeft': {
        if (!row) break
        if (row.scope && scopes[row.id].kids.length && isOpen(row.id)) {
          toggle(row.id)
          break
        }
        const parent = row.scope ? scopes[row.id].parent : statements[row.id].scopeId
        if (parent > 0) nav.pick(~parent)
        break
      }
      case 'Enter':
        if (!row) break
        if (row.scope) toggle(row.id)
        else nav.select(row.id)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const rootTotal = scopes[0].totalMs || 1

  return (
    <div className="card flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden">
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
          <div className="flex items-center rounded-lg text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <div className="flex flex-col py-0.5 pl-1">
              <button
                className="rounded px-0.5 text-slate-400 hover:text-brand-600 disabled:opacity-30 dark:hover:text-brand-300"
                onClick={() => showLevels(level + 1)}
                disabled={level >= maxLevel}
                title="Bir seviye daha aç"
                aria-label="Bir seviye daha aç"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                className="rounded px-0.5 text-slate-400 hover:text-brand-600 disabled:opacity-30 dark:hover:text-brand-300"
                onClick={() => showLevels(level - 1)}
                disabled={level <= 1}
                title="Bir seviye daralt"
                aria-label="Bir seviye daralt"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <button
              className="py-1 pr-2 pl-1 font-medium tabular-nums"
              onClick={() => showLevels(level)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                showLevels(level + (e.key === 'ArrowUp' ? 1 : -1))
              }}
              title={`${level} seviye aç (↑↓ ile değiştir, en çok ${maxLevel})`}
            >
              {level} seviye
            </button>
          </div>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => showLevels(maxLevel)} title="Tüm çağrıları aç">
            <ChevronsUpDown className="h-3.5 w-3.5" /> Tümünü aç
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => showLevels(1)} title="Yalnız en üst çağrılar kalsın">
            <ChevronsDownUp className="h-3.5 w-3.5" /> Daralt
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
        <div className="flex min-h-0 flex-1 flex-col outline-none" tabIndex={0} onKeyDown={onKey} aria-label="Çağrı ağacı">
          <VirtualList
            className="flex-1"
            items={rows}
            rowHeight={ROW_H}
            scrollTo={scrollTo}
            scrollKey="tree.y"
            render={(r) => {
              const pad = { paddingLeft: 8 + r.depth * 16 }
              const sel = cursor?.ref === rowRef(r)
              const rowCls = `group relative flex h-full cursor-pointer items-center gap-2 border-b border-slate-50 pr-3 dark:border-slate-800/40 ${
                sel
                  ? 'bg-brand-100/70 shadow-[inset_3px_0_0_var(--color-brand-500)] dark:bg-brand-500/20'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`
              if (r.scope) {
                const s = scopes[r.id]
                const open = isOpen(r.id)
                const hasKids = s.kids.length > 0
                return (
                  <div
                    className={`${rowCls} text-sm`}
                    style={pad}
                    onClick={() => {
                      nav.pick(~r.id)
                      if (hasKids) toggle(r.id)
                    }}
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
              return (
                <div className={`${rowCls} text-xs`} style={pad} onClick={() => nav.pick(st.id)} onDoubleClick={() => nav.select(st.id)}>
                  {showGuides && <Guides depth={r.depth} />}
                  <span className="w-4 shrink-0" />
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-slate-400">{st.srcLine}</span>
                  <KindChip kind={st.kind} />
                  <span className="min-w-0 flex-1 truncate font-mono text-slate-700 dark:text-slate-300">
                    <Code text={st.code.split('\n')[0]} />
                  </span>
                  {st.sql?.cached && <span className="chip shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">cache</span>}
                  {st.sql?.rows !== undefined && <span className="shrink-0 text-[11px] text-slate-400">{st.sql.rows} satır</span>}
                  {st.iterations !== undefined && st.iterations > 0 && <span className="shrink-0 text-[11px] text-amber-600">{st.iterations}×</span>}
                  <button
                    className={`shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-brand-600 dark:hover:bg-slate-700 dark:hover:text-brand-300 ${
                      sel ? '' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      nav.select(st.id)
                    }}
                    title="Ayrıntı (Enter / çift tık)"
                    aria-label="Ayrıntı"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                  <span className="hidden w-28 shrink-0 sm:block" />
                  <span className={`w-16 shrink-0 text-right tabular-nums ${msClass(st.ms)}`}>{fmtMs(st.ms)}</span>
                </div>
              )
            }}
          />
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-800">
        <span className="min-w-0 flex-1 truncate">
          {rows.length.toLocaleString('tr-TR')} satır görünüyor · Süreler alt çağrıları da içerir · ↑↓ ←→ gezin, Enter ayrıntı
        </span>
        {cursor && (
          <button className="flex shrink-0 items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200" onClick={nav.unpick} title="Seçimi ve vurgulamayı kaldır">
            <X className="h-3 w-3" /> Seçimi kaldır
          </button>
        )}
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

/** Scopes open so that `level` levels of calls show */
function openAbove(p: ParsedTrace, level: number): Set<number> {
  const set = new Set<number>()
  for (const s of p.scopes) if (s.id > 0 && s.depth < level) set.add(s.id)
  return set
}
