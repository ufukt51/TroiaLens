import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, CornerLeftUp, Database, Info, Search, Undo2, X } from 'lucide-react'
import type { ParsedTrace } from '../../lib/types.ts'
import type { Cursor, Nav } from '../../pages/AnalysisPage.tsx'
import type { ParentView } from '../../lib/host.ts'
import { fmtMs } from '../../lib/analyze.ts'
import { editorLine } from '../../lib/locate.ts'
import { Bar, KindChip, VirtualList, msClass } from '../ui.tsx'
import { Code } from '../SyntaxText.tsx'
import { usePersisted } from '../../lib/docState.ts'

type Row = { scope: true; id: number; depth: number } | { scope: false; id: number; depth: number }

const ROW_H = 30
const PAGE = 15
// Sticky parents beyond this keep the outermost and the nearest ones
const MAX_STICKY = 5
// Rows the "back" button remembers
const MAX_TRAIL = 50

/** Names also used by the Notepad++ menu (Plugin.cs) */
export const PARENT_VIEWS: { value: ParentView; label: string }[] = [
  { value: 'off', label: 'Kapalı' },
  { value: 'sticky', label: 'Yapışkan başlıklar' },
  { value: 'guides', label: 'Tıklanır kılavuz çizgileri' },
  { value: 'jump', label: 'Üste git, geri dön' },
]

const rowRef = (r: Row) => (r.scope ? ~r.id : r.id)

export function CallTree({
  parsed,
  nav,
  cursor,
  rowHighlight,
  onRowHighlight,
  parentView,
  onParentView,
}: {
  parsed: ParsedTrace
  nav: Nav
  cursor: Cursor | null
  /** The editor's tint of the selected row and its method; undefined outside Notepad++, where there is no editor */
  rowHighlight?: boolean
  onRowHighlight?: (on: boolean) => void
  parentView: ParentView
  onParentView: (v: ParentView) => void
}) {
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

  const { rows, rowOfScope } = useMemo(() => {
    const out: Row[] = []
    // Row index of each listed scope, -1 when hidden
    const at = new Int32Array(scopes.length).fill(-1)
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
          at[id] = out.length
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
    return { rows: out, rowOfScope: at }
  }, [scopes, expanded, showStmts, filter])

  /** Scope holding the row: a scope's caller, a statement's method; 0 (the trace root) for top-level rows */
  const parentOf = (r: Row) => (r.scope ? scopes[r.id].parent : statements[r.id].scopeId)
  /** Parent calls of the row, outermost first; one per level of indent */
  const ancestors = (r: Row) => {
    const out: number[] = []
    for (let s = parentOf(r); s > 0; s = scopes[s].parent) out.push(s)
    return out.reverse()
  }

  // Content offset of the list's top edge; the sticky parents and the guide peek follow it
  const [viewTop, setViewTop] = useState(0)
  const onView = useCallback((top: number) => setViewTop(top), [])

  // Sticky parents: the calls holding the first row under them, so each stays in sight while its rows scroll by
  const sticky = useMemo(() => {
    if (parentView !== 'sticky' || !rows.length) return null
    let ids: number[] = []
    let hidden = 0
    // The stack covers rows, which may change the row under it; a few rounds settle it
    for (let round = 0; round < 6; round++) {
      const under = rows[Math.min(rows.length - 1, Math.floor(viewTop / ROW_H) + ids.length)]
      const all = ancestors(under)
      const next = all.length > MAX_STICKY ? [all[0], ...all.slice(all.length - MAX_STICKY + 1)] : all
      hidden = all.length - next.length
      if (next.length === ids.length && next.every((id, k) => id === ids[k])) break
      ids = next
    }
    return ids.length ? { ids, hidden } : null
  }, [parentView, rows, viewTop])

  // Guides: the call whose guide line is under the mouse
  const [hotGuide, setHotGuide] = useState<number | null>(null)
  const guidesLive = parentView === 'guides'
  useEffect(() => setHotGuide(null), [guidesLive, rows])

  // Jump: rows left by going up, newest last; "back" returns to them
  const [trail, setTrail] = useState<number[]>([])
  useEffect(() => setTrail([]), [parentView])
  const goParent = (r: Row) => {
    const parent = parentOf(r)
    if (parent <= 0) return
    if (parentView === 'jump') setTrail((t) => [...t.slice(1 - MAX_TRAIL), rowRef(r)])
    nav.pick(~parent)
  }
  const goBack = () => {
    const ref = trail[trail.length - 1]
    if (ref === undefined) return
    setTrail(trail.slice(0, -1))
    nav.pick(ref)
  }
  const refName = (ref: number) => {
    if (ref < 0) return scopes[~ref].label
    const st = statements[ref]
    return `${scopes[st.scopeId].label} : ${st.srcLine}`
  }

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
        if (e.altKey) {
          goBack()
          break
        }
        if (!row) break
        if (row.scope && scopes[row.id].kids.length && isOpen(row.id)) {
          toggle(row.id)
          break
        }
        goParent(row)
        break
      }
      case 'Backspace':
        goBack()
        break
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

  const rowCls = (sel: boolean) =>
    `group relative flex h-full cursor-pointer items-center gap-2 border-b border-slate-50 pr-3 dark:border-slate-800/40 ${
      sel ? 'bg-brand-100/70 shadow-[inset_3px_0_0_var(--color-brand-500)] dark:bg-brand-500/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
    }`

  /** A call's row: in the list, and stuck to the top as a sticky parent */
  const scopeRow = (
    id: number,
    depth: number,
    o: { sel: boolean; open: boolean; owner?: boolean; guides?: ReactNode; up?: ReactNode; extra?: ReactNode; onClick: () => void },
  ) => {
    const s = scopes[id]
    const first = editorLine(parsed, s.startLine)
    const last = editorLine(parsed, s.endLine)
    return (
      <div
        className={`${rowCls(o.sel)} text-sm ${o.owner ? 'ring-1 ring-brand-500 ring-inset' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={o.onClick}
        title={s.name}
      >
        {o.guides}
        <span className="w-4 shrink-0 text-slate-400">
          {s.kids.length > 0 && (o.open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
        </span>
        <span className="min-w-0 truncate">
          {o.extra}
          <span className="font-mono text-[13px] font-semibold text-slate-900 dark:text-white">{s.label}</span>
          <span className="ml-2 font-mono text-xs text-slate-500">{s.owner}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {o.up}
          {s.totalSqlCount > 0 && (
            <span className="chip bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Bu çağrı ve alt çağrılarındaki SQL">
              <Database className="h-3 w-3" />
              {s.totalSqlCount}
            </span>
          )}
          <span
            className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            title={`${s.totalStmtCount.toLocaleString('tr-TR')} çalışan satır (bu çağrı ve alt çağrıları)`}
          >
            ▶ {s.totalStmtCount.toLocaleString('tr-TR')}
          </span>
          <span
            className="chip hidden border border-dashed border-slate-300 text-slate-500 sm:inline-flex dark:border-slate-600 dark:text-slate-400"
            title={`Dosyada ${first.toLocaleString('tr-TR')}–${last.toLocaleString('tr-TR')}. satırlar (${(last - first + 1).toLocaleString('tr-TR')} satır)`}
          >
            {first.toLocaleString('tr-TR')}–{last.toLocaleString('tr-TR')}
          </span>
        </span>
        <span className="hidden w-28 shrink-0 sm:block">
          <Bar value={s.totalMs} max={rootTotal} />
        </span>
        <span className={`w-16 shrink-0 text-right text-xs tabular-nums ${msClass(s.totalMs)}`}>{fmtMs(s.totalMs)}</span>
      </div>
    )
  }

  // Guides: the selected row's own call keeps its line lit
  const cursorParent = guidesLive && cursor ? (cursor.ref < 0 ? scopes[~cursor.ref].parent : statements[cursor.ref]?.scopeId ?? null) : null
  const pickGuide = (id: number) => {
    setHotGuide(null)
    nav.pick(~id)
  }
  const guideName = (id: number) => `${scopes[id].label} · ${scopes[id].owner}`

  // Drawn over the top of the list: the sticky parents, or the call of the hovered guide line when it is above the view
  let overlay: ReactNode = null
  if (sticky) {
    overlay = (
      <div className="bg-white shadow-[0_6px_8px_-6px_rgb(15_23_42/0.35)] dark:bg-slate-900 dark:shadow-[0_6px_8px_-6px_rgb(0_0_0/0.8)]">
        {sticky.ids.map((id, k) => (
          <div key={id} style={{ height: ROW_H }} className="bg-slate-50 dark:bg-slate-800/60">
            {scopeRow(id, scopes[id].depth - 1, {
              sel: cursor?.ref === ~id,
              open: true,
              guides: showGuides && <Guides depth={scopes[id].depth - 1} />,
              extra: k === 1 && sticky.hidden > 0 && (
                <span className="mr-2 font-mono text-[11px] text-slate-400" title={`${sticky.hidden} üst çağrı daha var`}>
                  ⋯{sticky.hidden}
                </span>
              ),
              onClick: () => nav.pick(~id),
            })}
          </div>
        ))}
      </div>
    )
  } else if (guidesLive && hotGuide !== null && rowOfScope[hotGuide] * ROW_H < viewTop) {
    const s = scopes[hotGuide]
    const above = Math.ceil((viewTop - rowOfScope[hotGuide] * ROW_H) / ROW_H)
    overlay = (
      <div
        className="pointer-events-none flex items-center gap-2 bg-brand-600 px-3 text-xs text-white shadow-md dark:bg-brand-500"
        style={{ height: ROW_H }}
      >
        <span className="min-w-0 truncate font-mono">
          ↑ <span className="font-semibold">{s.label}</span> {s.owner} · ▶ {s.totalStmtCount.toLocaleString('tr-TR')} · {fmtMs(s.totalMs)}
        </span>
        <span className="ml-auto shrink-0 opacity-80">{above.toLocaleString('tr-TR')} satır yukarıda · tıkla</span>
      </div>
    )
  }

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
          <input type="checkbox" checked={showGuides || guidesLive} onChange={(e) => setShowGuides(e.target.checked)} disabled={guidesLive} /> Çizgiler
        </label>
        {rowHighlight !== undefined && (
          <label
            className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"
            title="Seçili satırın metodunu ve kendisini editörde sarı zeminle gösterir; kapalıyken yalnızca soldaki çubuk kalır (eklenti menüsündeki ayarla aynı)"
          >
            <input type="checkbox" checked={rowHighlight} onChange={(e) => onRowHighlight?.(e.target.checked)} /> Blok rengi
          </label>
        )}
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
        <label
          className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"
          title="Satırın bağlı olduğu üst çağrıyı nasıl göstereceği (eklenti menüsündeki ayarla aynı)"
        >
          Üst öğe
          <select className="input w-auto py-1 text-xs" value={parentView} onChange={(e) => onParentView(e.target.value as ParentView)}>
            {PARENT_VIEWS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
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
        <div className="relative flex min-h-0 flex-1 flex-col outline-none" tabIndex={0} onKeyDown={onKey} aria-label="Çağrı ağacı">
          <VirtualList
            className="flex-1"
            items={rows}
            rowHeight={ROW_H}
            scrollTo={scrollTo}
            scrollKey="tree.y"
            onView={onView}
            overlay={overlay}
            render={(r) => {
              const sel = cursor?.ref === rowRef(r)
              const anc = guidesLive ? ancestors(r) : null
              const guides = (showGuides || guidesLive) && (
                <Guides depth={r.depth} anc={anc} hot={hotGuide} active={cursorParent} onHot={setHotGuide} onPick={pickGuide} name={guideName} />
              )
              const up = parentView === 'jump' && r.depth > 0 && (
                <button
                  className={`shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-brand-600 dark:hover:bg-slate-700 dark:hover:text-brand-300 ${
                    sel ? '' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    goParent(r)
                  }}
                  title="Üst çağrıya git (←); Alt+← ile geri dönülür"
                  aria-label="Üst çağrıya git"
                >
                  <CornerLeftUp className="h-3.5 w-3.5" />
                </button>
              )
              if (r.scope) {
                const hasKids = scopes[r.id].kids.length > 0
                return scopeRow(r.id, r.depth, {
                  sel,
                  open: isOpen(r.id),
                  owner: guidesLive && hotGuide === r.id,
                  guides,
                  up,
                  onClick: () => {
                    nav.pick(~r.id)
                    if (hasKids) toggle(r.id)
                  },
                })
              }
              const st = statements[r.id]
              return (
                <div
                  className={`${rowCls(sel)} text-xs`}
                  style={{ paddingLeft: 8 + r.depth * 16 }}
                  onClick={() => nav.pick(st.id)}
                  onDoubleClick={() => nav.select(st.id)}
                >
                  {guides}
                  <span className="w-4 shrink-0" />
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-slate-400">{st.srcLine}</span>
                  <KindChip kind={st.kind} />
                  <span className="min-w-0 flex-1 truncate font-mono text-slate-700 dark:text-slate-300">
                    <Code text={st.code.split('\n')[0]} />
                  </span>
                  {st.sql?.cached && <span className="chip shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">cache</span>}
                  {st.sql?.rows !== undefined && <span className="shrink-0 text-[11px] text-slate-400">{st.sql.rows} satır</span>}
                  {st.iterations !== undefined && st.iterations > 0 && <span className="shrink-0 text-[11px] text-amber-600">{st.iterations}×</span>}
                  {up}
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
          {parentView === 'jump' && trail.length > 0 && (
            <button
              className="absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-full bg-slate-800 py-1.5 pr-3 pl-2.5 text-xs text-white shadow-lg hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
              onClick={goBack}
              title="Üst çağrıya gitmeden önceki satıra döner (Alt+← ya da Backspace)"
            >
              <Undo2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                Geri dön: <span className="font-mono">{refName(trail[trail.length - 1])}</span>
              </span>
              <kbd className="shrink-0 rounded border border-current px-1 font-mono text-[10px] opacity-60">Alt+←</kbd>
            </button>
          )}
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

/**
 * Vertical lines under each ancestor's chevron plus a short tick into the row, so parent/child levels line up.
 * Given the row's ancestors (anc), each line belongs to one: hovering lights it along every row and clicking goes
 * to that call; the line of the selected row's call (active) stays lit.
 */
function Guides({
  depth,
  anc,
  hot,
  active,
  onHot,
  onPick,
  name,
}: {
  depth: number
  anc?: number[] | null
  hot?: number | null
  active?: number | null
  onHot?: (id: number | null) => void
  onPick?: (id: number) => void
  name?: (id: number) => string
}) {
  if (depth === 0) return null
  const lines = []
  for (let d = 0; d < depth; d++) {
    const own = anc?.[d]
    const line =
      own !== undefined && own === hot
        ? 'border-l-2 border-brand-500'
        : own !== undefined && own === active
          ? 'border-l-2 border-brand-400/70 dark:border-brand-400/60'
          : d === depth - 1
            ? 'border-l border-slate-300 dark:border-slate-600'
            : 'border-l border-slate-200 dark:border-slate-700/70'
    if (own === undefined) {
      lines.push(<span key={d} className={`pointer-events-none absolute top-0 bottom-0 ${line}`} style={{ left: 16 + d * 16 }} />)
      continue
    }
    // A wider strip than the line itself, so it is easy to hit
    lines.push(
      <span
        key={d}
        className={`absolute top-0 bottom-0 z-[1] w-2.5 cursor-pointer ${own === hot ? 'bg-brand-500/10' : ''}`}
        style={{ left: 16 + d * 16 - 4 }}
        onMouseEnter={() => onHot?.(own)}
        onMouseLeave={() => onHot?.(null)}
        onClick={(e) => {
          e.stopPropagation()
          onPick?.(own)
        }}
        title={name ? `${name(own)}: başına git` : undefined}
      >
        <span className={`pointer-events-none absolute top-0 bottom-0 left-1 ${line}`} />
      </span>,
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
