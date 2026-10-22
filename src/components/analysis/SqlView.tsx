import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Search } from 'lucide-react'
import type { SqlGroup, TraceResult } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { fmtMs } from '../../lib/analyze.ts'
import { Bar, CodeBlock, Empty, Kpi, SectionTitle, formatSql, msClass } from '../ui.tsx'
import { Code, PREVIEW } from '../SyntaxText.tsx'

type SortKey = 'totalMs' | 'count' | 'dbHits' | 'rows'

const VERB_ORDER = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const VERB_CLS: Record<string, string> = {
  SELECT: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  INSERT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  UPDATE: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  DELETE: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
}
const verbCls = (verb: string) => VERB_CLS[verb] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'

export function SqlView({ result, nav }: { result: TraceResult; nav: Nav }) {
  const { parsed, analysis } = result
  const t = analysis.totals
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('totalMs')
  const [open, setOpen] = useState<string | null>(null)
  const [table, setTable] = useState<string | null>(null)
  const [verb, setVerb] = useState<string | null>(null)

  const verbs = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of analysis.sqlGroups) m.set(g.verb, (m.get(g.verb) ?? 0) + g.count)
    const rank = (v: string) => (VERB_ORDER.includes(v) ? VERB_ORDER.indexOf(v) : VERB_ORDER.length)
    return [...m].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])
  }, [analysis.sqlGroups])

  const tables = useMemo(() => {
    const m = new Map<string, { name: string; count: number; db: number; ms: number }>()
    for (const g of analysis.sqlGroups) {
      for (const name of g.tables) {
        const e = m.get(name) ?? { name, count: 0, db: 0, ms: 0 }
        e.count += g.count
        e.db += g.dbHits
        e.ms += g.totalMs
        m.set(name, e)
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [analysis.sqlGroups])

  const groups = useMemo(() => {
    const q = query.trim().toUpperCase()
    return analysis.sqlGroups
      .filter((g) => (!q || g.normalized.includes(q)) && (!table || g.tables.includes(table)) && (!verb || g.verb === verb))
      .sort((a, b) => b[sort] - a[sort] || b.count - a.count)
  }, [analysis.sqlGroups, query, sort, table, verb])

  if (t.sql === 0) {
    return (
      <Empty icon={<Database className="h-8 w-8" />} title="Bu trace'te SQL çalışmamış">
        Trace içinde SELECT / INSERT / UPDATE / DELETE satırı bulunamadı. İşlem yalnızca bellek tablolarıyla çalışmış olabilir.
      </Empty>
    )
  }

  // reduce, not Math.max(...): spreading tens of thousands of groups overflows the stack in embedded browsers
  const maxMs = analysis.sqlGroups.reduce((m, g) => Math.max(m, g.totalMs), 1)
  const maxTable = tables[0]?.count ?? 1

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:col-span-4">
        <Kpi label="Toplam sorgu" value={t.sql.toLocaleString('tr-TR')} sub={`${analysis.sqlGroups.length} farklı sorgu`} />
        <Kpi label="Veritabanına giden" value={t.sqlDb.toLocaleString('tr-TR')} sub={`%${Math.round((t.sqlDb / t.sql) * 100)}`} />
        <Kpi label="Önbellekten" value={t.sqlCache.toLocaleString('tr-TR')} sub={`%${Math.round((t.sqlCache / t.sql) * 100)}`} />
        <Kpi label="SQL süresi" value={fmtMs(t.sqlMs)} sub={t.totalMs ? `toplamın %${Math.round((t.sqlMs / t.totalMs) * 100)}'i` : undefined} />
      </div>

      <div className="card p-4 lg:col-span-1">
        <SectionTitle>Tablolar</SectionTitle>
        <ul className="scroll-thin max-h-56 lg:max-h-[max(640px,calc(100dvh-16rem))] space-y-0.5 overflow-y-auto pr-1">
          {tables.slice(0, 40).map((tb) => (
            <li key={tb.name}>
              <button
                className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  table === tb.name ? 'bg-brand-50 dark:bg-brand-900/30' : ''
                }`}
                onClick={() => setTable(table === tb.name ? null : tb.name)}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono font-medium">{tb.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {tb.count}
                    {tb.db !== tb.count && <span className="text-slate-400"> ({tb.db} db)</span>}
                  </span>
                </div>
                <div className="mt-1">
                  <Bar value={tb.count} max={maxTable} className="bg-violet-500" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card overflow-hidden lg:col-span-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8" placeholder="Sorgu ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {verbs.length > 1 &&
            verbs.map(([v, n]) => (
              <button
                key={v}
                className={`chip py-1 font-mono ${verbCls(v)} ${verb && verb !== v ? 'opacity-40' : ''} ${verb === v ? 'ring-1 ring-current' : ''}`}
                onClick={() => setVerb(verb === v ? null : v)}
              >
                {v} {n}
              </button>
            ))}
          {table && (
            <button className="chip bg-brand-100 py-1 font-mono text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" onClick={() => setTable(null)}>
              {table} ✕
            </button>
          )}
          <select className="input w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="totalMs">Süreye göre</option>
            <option value="count">Çalışma sayısına göre</option>
            <option value="dbHits">DB isabetine göre</option>
            <option value="rows">Satır sayısına göre</option>
          </select>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {groups.slice(0, 300).map((g) => (
            <SqlGroupRow key={g.normalized} g={g} maxMs={maxMs} open={open === g.normalized} toggle={() => setOpen(open === g.normalized ? null : g.normalized)} result={result} nav={nav} />
          ))}
          {groups.length === 0 && <li className="p-8 text-center text-sm text-slate-500">Eşleşen sorgu yok.</li>}
        </ul>
        {groups.length > 300 && <div className="p-3 text-center text-xs text-slate-500">İlk 300 sorgu gösteriliyor, aramayı daraltın.</div>}
      </div>
      <div className="text-xs text-slate-500 lg:col-span-4">
        Sorgular parametre değerleri ayıklanarak gruplanır. {parsed.statements.length > 0 && 'Bir gruba tıklayınca her çalışmanın gerçek sorgusunu görürsünüz.'}
      </div>
    </div>
  )
}

function SqlGroupRow({ g, maxMs, open, toggle, result, nav }: { g: SqlGroup; maxMs: number; open: boolean; toggle: () => void; result: TraceResult; nav: Nav }) {
  const { statements, scopes } = result.parsed
  return (
    <li>
      <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={toggle}>
        <span className="mt-0.5 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 font-mono text-xs break-all text-slate-800 dark:text-slate-200">
            <Code text={g.normalized} sql max={PREVIEW} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className={`chip font-mono ${verbCls(g.verb)}`}>{g.verb}</span>
            <span>
              <b className="text-slate-700 dark:text-slate-300">{g.count}</b> kez
            </span>
            <span>{g.dbHits} db · {g.cacheHits} cache</span>
            <span>
              {g.rows.toLocaleString('tr-TR')} satır{g.verb !== 'SELECT' && ' etkilendi'}
            </span>
            {g.maxInOneLoop > 1 && <span className="text-amber-600 dark:text-amber-400">tek döngüde {g.maxInOneLoop}×</span>}
            <span className="truncate">{g.locations.length === 1 ? g.locations[0] : `${g.locations.length} farklı yerden`}</span>
          </div>
        </div>
        <div className="w-28 shrink-0 pt-1">
          <Bar value={g.totalMs} max={maxMs} className="bg-violet-500" />
          <div className={`mt-1 text-right text-xs tabular-nums ${msClass(g.maxMs)}`}>{fmtMs(g.totalMs)}</div>
        </div>
      </button>
      {open && (
        <div className="space-y-2 bg-slate-50/70 px-4 py-3 dark:bg-slate-950/40">
          <CodeBlock className="scroll-thin overflow-x-auto rounded-md bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <Code text={formatSql(g.normalized)} sql />
          </CodeBlock>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="th">Çalışan sorgu</th>
                  <th className="th">Yer</th>
                  <th className="th text-right">Satır</th>
                  <th className="th text-right">Süre</th>
                </tr>
              </thead>
              <tbody>
                {g.stmtIds.slice(0, 200).map((id) => {
                  const st = statements[id]
                  return (
                    <tr key={id} className="cursor-pointer border-t border-slate-100 hover:bg-white dark:border-slate-800 dark:hover:bg-slate-900" onClick={() => nav.select(id)}>
                      <td className="td max-w-md">
                        <div className="truncate font-mono">
                          {st.sql?.cached && <span className="chip mr-1.5 bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">cache</span>}
                          <Code text={st.sql?.resolved ?? st.code} sql />
                        </div>
                      </td>
                      <td className="td max-w-56 truncate font-mono text-slate-500">
                        {scopes[st.scopeId].label}:{st.srcLine}
                      </td>
                      <td className="td text-right tabular-nums">{st.sql?.rows ?? '—'}</td>
                      <td className={`td text-right tabular-nums ${msClass(st.ms)}`}>{fmtMs(st.ms)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {g.stmtIds.length > 200 && <div className="p-2 text-center text-xs text-slate-500">İlk 200 çalışma gösteriliyor.</div>}
          </div>
        </div>
      )}
    </li>
  )
}
