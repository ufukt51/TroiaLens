import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, CircleAlert, GitBranch, Search } from 'lucide-react'
import type { IssueKind, ParsedTrace, TraceResult } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { issueText } from '../../lib/analyze.ts'
import { editorLine, markFor, refAtLine, type Mark } from '../../lib/locate.ts'
import { Empty } from '../ui.tsx'
import { SourcePane } from './SourcePane.tsx'

/** One place to go to: a trace issue, or an error / warning MESSAGE statement */
interface Entry {
  key: string
  kind: IssueKind
  fileLine: number
  /** Last line that belongs to the entry (lines listed under "Errors:") */
  lineEnd: number
  scopeId: number
  stmtId: number
  text: string
  details: string[]
  /** MESSAGE number (module, type, number) for MESSAGE statements */
  message?: string
}

/** Missing parameters of one method, grouped by parameter name */
interface Group {
  key: string
  scopeId: number
  name: string
  entries: Entry[]
}

type Filter = 'all' | IssueKind

const SECTIONS: { kind: IssueKind; title: string; empty: string; badge: string }[] = [
  { kind: 'error', title: 'Hatalar', empty: 'Hata yok.', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  { kind: 'warning', title: 'Uyarılar', empty: 'Uyarı yok.', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  {
    kind: 'missingParam',
    title: 'Eksik parametreler',
    empty: 'Eksik parametre yok.',
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
]

function collect(parsed: ParsedTrace, messages: number[]): Entry[] {
  const out: Entry[] = parsed.issues.map((i) => ({
    key: `i${i.fileLine}`,
    kind: i.kind,
    fileLine: i.fileLine,
    lineEnd: i.lineEnd,
    scopeId: i.scopeId,
    stmtId: i.stmtId,
    text: issueText(i),
    details: i.text ? i.details : i.details.slice(0, -1),
  }))
  for (const id of messages) {
    const st = parsed.statements[id]
    const m = st.message!
    if (m.type !== 'E' && m.type !== 'W') continue
    out.push({
      key: `m${id}`,
      kind: m.type === 'E' ? 'error' : 'warning',
      fileLine: st.fileLine,
      lineEnd: st.fileLine,
      scopeId: st.scopeId,
      stmtId: id,
      text: m.text.replace(/\s+/g, ' ') || st.code.split('\n')[0],
      details: [],
      message: `${m.module} ${m.type}${m.number}`,
    })
  }
  return out.sort((a, b) => a.fileLine - b.fileLine)
}

function matches(parsed: ParsedTrace, e: Entry, q: string): boolean {
  if (!q) return true
  const hay = `${e.text}\n${parsed.scopes[e.scopeId].name}\n${e.details.join('\n')}\n${e.message ?? ''}`
  return hay.toLowerCase().includes(q)
}

/**
 * Runtime errors and warnings ("Errors:" lines, error / warning MESSAGEs) and missing parameters, each a
 * link to its line: the editor in Notepad++, a source pane beside the list in the browser.
 */
export function IssuesView({ result, nav, lines, embedded }: { result: TraceResult; nav: Nav; lines: string[]; embedded: boolean }) {
  const { parsed, analysis } = result
  const all = useMemo(() => collect(parsed, analysis.messages), [parsed, analysis.messages])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [pane, setPane] = useState<{ mark: Mark; nonce: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => all.filter((e) => (filter === 'all' || e.kind === filter) && matches(parsed, e, q)), [all, filter, q, parsed])
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, missingParam: 0 }
    for (const e of all) c[e.kind]++
    return c
  }, [all])

  const groups = useMemo(() => {
    const map = new Map<string, Group>()
    for (const e of shown) {
      if (e.kind !== 'missingParam') continue
      const name = e.text.replace(/\[.*$/s, '')
      const key = `${parsed.scopes[e.scopeId].name}|${name}`
      let g = map.get(key)
      if (!g) map.set(key, (g = { key, scopeId: e.scopeId, name, entries: [] }))
      g.entries.push(e)
    }
    return [...map.values()]
  }, [shown, parsed])

  // Order the arrows (and keys) step through: errors, warnings, then every missing parameter group by group
  const order = useMemo(
    () => [...shown.filter((e) => e.kind === 'error'), ...shown.filter((e) => e.kind === 'warning'), ...groups.flatMap((g) => g.entries)],
    [shown, groups],
  )
  const groupOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups) for (const e of g.entries) m.set(e.key, g.key)
    return m
  }, [groups])

  const go = (e: Entry) => {
    setActive(e.key)
    const g = groupOf.get(e.key)
    if (g && !open.has(g) && groups.find((x) => x.key === g)!.entries[0] !== e) setOpen((s) => new Set(s).add(g))
    const m: Mark = { ...markFor(parsed, ~e.scopeId), line: e.fileLine, lineEnd: e.lineEnd }
    if (embedded) nav.showInEditor(m)
    // Narrow browser windows have no room for the source pane
    else if (matchMedia('(min-width: 1024px)').matches) setPane({ mark: m, nonce: Date.now() })
    else nav.openRaw(e.fileLine)
  }

  const index = active ? order.findIndex((e) => e.key === active) : -1
  const step = (d: number) => {
    if (!order.length) return
    const n = index < 0 ? (d > 0 ? 0 : order.length - 1) : (index + d + order.length) % order.length
    go(order[n])
  }

  // Keep the active row in view while stepping
  useEffect(() => {
    if (active) listRef.current?.querySelector(`[data-key="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    step(e.key === 'ArrowDown' ? 1 : -1)
  }

  if (all.length === 0) {
    return (
      <Empty icon={<CircleAlert className="h-8 w-8" />} title="Hata veya uyarı yok">
        Trace'te çalışma hatası, uyarı, hata / uyarı mesajı veya eksik parametre yok.
      </Empty>
    )
  }

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (!n.delete(key)) n.add(key)
      return n
    })

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'Tümü', count: all.length },
    { id: 'error', label: 'Hatalar', count: counts.error },
    { id: 'warning', label: 'Uyarılar', count: counts.warning },
    { id: 'missingParam', label: embedded ? 'Eksik param.' : 'Eksik parametreler', count: counts.missingParam },
  ]

  const row = (e: Entry, body: ReactNode, extra?: ReactNode) => (
    <div
      key={e.key}
      data-key={e.key}
      className={`group flex items-start gap-2 ${embedded ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${
        active === e.key ? 'bg-amber-100/80 dark:bg-amber-500/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
      }`}
    >
      {extra}
      <button className="min-w-0 flex-1 text-left" onClick={() => go(e)}>
        {body}
      </button>
      {e.stmtId >= 0 && (
        <button
          className="btn-ghost shrink-0 p-1 opacity-60 group-hover:opacity-100"
          onClick={() => nav.revealInTree(e.stmtId)}
          title="Çağrı ağacında göster"
          aria-label="Çağrı ağacında göster"
        >
          <GitBranch className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  const lineLabel = (e: Entry) => <span className="shrink-0 tabular-nums">Satır {editorLine(parsed, e.fileLine).toLocaleString('tr-TR')}</span>

  const issueRow = (e: Entry) =>
    row(
      e,
      <>
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
          {lineLabel(e)}
          <span className="min-w-0 truncate font-mono" title={parsed.scopes[e.scopeId].name}>
            {parsed.scopes[e.scopeId].name}
          </span>
          {e.message && <span className="chip bg-slate-100 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">MESSAGE {e.message}</span>}
        </div>
        <div className={`mt-0.5 break-words text-slate-900 dark:text-white ${embedded ? 'text-[13px]' : 'text-sm'}`}>{e.text}</div>
        {e.details.length > 0 && (
          <div className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-500">
            {e.details.map((d, i) => (
              <div key={i} className="truncate" title={d}>
                • {d}
              </div>
            ))}
          </div>
        )}
      </>,
    )

  const groupRow = (g: Group) => {
    const first = g.entries[0]
    const expanded = open.has(g.key)
    const inside = active !== null && groupOf.get(active) === g.key
    return (
      <div key={g.key} className={inside && active !== first.key ? 'bg-amber-50/60 dark:bg-amber-500/[0.06]' : ''}>
        {row(
          first,
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-mono font-medium text-slate-900 dark:text-white ${embedded ? 'text-[13px]' : 'text-sm'}`}>{g.name}</span>
            <span className="min-w-0 truncate font-mono text-xs text-slate-500" title={parsed.scopes[g.scopeId].name}>
              {parsed.scopes[g.scopeId].name}
            </span>
            <span className="text-xs text-slate-500">{lineLabel(first)}</span>
          </div>,
          g.entries.length > 1 ? (
            <button
              className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded px-1 text-xs tabular-nums text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
              onClick={() => toggle(g.key)}
              title={expanded ? 'Satırları gizle' : 'Tüm satırları göster'}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {g.entries.length}×
            </button>
          ) : (
            <span className="mt-0.5 w-[38px] shrink-0 text-xs text-slate-400 tabular-nums">1×</span>
          ),
        )}
        {expanded && g.entries.length > 1 && (
          <div className={`flex flex-wrap gap-1 pb-2 ${embedded ? 'pl-11' : 'pl-12'} pr-3`}>
            {g.entries.map((e) => (
              <button
                key={e.key}
                data-key={e.key}
                onClick={() => go(e)}
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
                  active === e.key
                    ? 'bg-amber-300 text-amber-950 dark:bg-amber-500/50 dark:text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
                title={`${e.text} · ${parsed.scopes[e.scopeId].name}`}
              >
                {editorLine(parsed, e.fileLine).toLocaleString('tr-TR')}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const sections = SECTIONS.filter((s) => filter === 'all' || filter === s.kind)

  const list = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className={`flex flex-wrap items-center ${embedded ? 'gap-1.5' : 'gap-2'}`}>
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                filter === f.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              {f.label}
              <span className="tabular-nums opacity-80">{f.count.toLocaleString('tr-TR')}</span>
            </button>
          ))}
        </div>
        <div className="relative min-w-36 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-8" placeholder="Metin, metot veya parametre ara…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} />
        </div>
        <div className="flex items-center gap-0.5">
          <span className="mr-1 text-xs tabular-nums text-slate-500">{index >= 0 ? `${index + 1} / ${order.length}` : order.length ? `${order.length}` : ''}</span>
          <button className="btn-ghost p-1.5" onClick={() => step(-1)} disabled={!order.length} title="Önceki (↑)" aria-label="Önceki">
            <ChevronUp className="h-4 w-4" />
          </button>
          <button className="btn-ghost p-1.5" onClick={() => step(1)} disabled={!order.length} title="Sonraki (↓)" aria-label="Sonraki">
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={listRef} tabIndex={0} onKeyDown={onKey} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto outline-none">
        {sections.map((s) => {
          const items = s.kind === 'missingParam' ? groups : shown.filter((e) => e.kind === s.kind)
          const total = s.kind === 'missingParam' ? groups.reduce((n, g) => n + g.entries.length, 0) : items.length
          return (
            <section key={s.kind}>
              <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                {s.title}
                <span className={`chip tabular-nums ${total ? s.badge : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{total.toLocaleString('tr-TR')}</span>
                {s.kind === 'missingParam' && groups.length > 0 && <span className="text-xs font-normal text-slate-500">{groups.length} farklı parametre</span>}
              </h2>
              {items.length === 0 ? (
                <div className="px-1 text-xs text-slate-500">{q ? 'Aramayla eşleşen yok.' : s.empty}</div>
              ) : (
                <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                  {s.kind === 'missingParam' ? groups.map(groupRow) : (items as Entry[]).map(issueRow)}
                </div>
              )}
            </section>
          )
        })}
        <div className="pb-1 text-[11px] text-slate-500">
          {embedded ? 'Satıra tıklayınca editörde gösterilir' : 'Satıra tıklayınca kaynağı yanda açılır'} · ↑ ↓ ile sonraki / önceki
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {list}
      {!embedded && pane && (
        <SourcePane
          lines={lines}
          mark={pane.mark}
          nonce={pane.nonce}
          onClose={() => setPane(null)}
          onLine={(n) => {
            const ref = refAtLine(parsed, n)
            if (ref !== null && ref >= 0) nav.select(ref)
          }}
          hint="Satıra tıklayınca ayrıntısı açılır"
        />
      )}
    </div>
  )
}
