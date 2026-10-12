import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Database, FileText, GitBranch, LayoutDashboard, MessageSquare, Repeat } from 'lucide-react'
import type { LoadedTrace } from '../lib/types.ts'
import { parseFileName } from '../lib/run.ts'
import { fmtMs } from '../lib/analyze.ts'
import { postToHost } from '../lib/host.ts'
import { Overview } from '../components/analysis/Overview.tsx'
import { CallTree } from '../components/analysis/CallTree.tsx'
import { SqlView } from '../components/analysis/SqlView.tsx'
import { RepeatsView } from '../components/analysis/RepeatsView.tsx'
import { MessagesView } from '../components/analysis/MessagesView.tsx'
import { RawView } from '../components/analysis/RawView.tsx'
import { StatementDetail } from '../components/analysis/StatementDetail.tsx'
import { ScoreDot } from '../components/ui.tsx'

export type Tab = 'overview' | 'tree' | 'sql' | 'repeats' | 'messages' | 'raw'

export interface Nav {
  /** Opens the detail panel for a statement (in Notepad++ also moves the editor caret to it) */
  select: (stmtId: number) => void
  /** Switches to the call tree and reveals the statement (>= 0) or scope (encoded ~id) */
  revealInTree: (ref: number) => void
  /** Shows a file line: the raw view in the browser, the editor in Notepad++ */
  openRaw: (fileLine: number) => void
  /** Finds the statement printed at a file line, if any */
  stmtAtLine: (fileLine: number) => number
}

/**
 * Fills its container's height. `embedded` is the Notepad++ panel: compact header, no raw view
 * (the editor itself shows the file) and line jumps go to the editor.
 */
export function AnalysisPage({ trace, embedded }: { trace: LoadedTrace; embedded: boolean }) {
  const { parsed, analysis } = trace.result
  const [tab, setTab] = useState<Tab>('overview')
  const [selected, setSelected] = useState<number | null>(null)
  const [treeTarget, setTreeTarget] = useState<{ ref: number; nonce: number } | null>(null)
  const [rawTarget, setRawTarget] = useState<{ line: number; nonce: number } | null>(null)

  const lineIndex = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of parsed.statements) m.set(s.fileLine, s.id)
    return m
  }, [parsed])

  const nav: Nav = useMemo(
    () => ({
      select: (id) => {
        setSelected(id)
        const st = parsed.statements[id]
        if (embedded && st) postToHost({ type: 'gotoLine', line: st.fileLine, focus: false })
      },
      revealInTree: (ref) => {
        setTreeTarget({ ref, nonce: Date.now() })
        setTab('tree')
      },
      openRaw: (line) => {
        if (embedded) {
          postToHost({ type: 'gotoLine', line, focus: true })
          return
        }
        setRawTarget({ line, nonce: Date.now() })
        setTab('raw')
      },
      stmtAtLine: (line) => lineIndex.get(line) ?? -1,
    }),
    [lineIndex, parsed, embedded],
  )

  const fromName = parseFileName(trace.name)
  const info = analysis.info
  const transaction = info['Transaction'] ?? fromName.transaction
  const user = info['User Name'] ?? fromName.user
  const date = info['Trace Date'] ?? fromName.date
  const t = analysis.totals

  const tabs: { id: Tab; label: string; icon: typeof FileText; count?: number }[] = [
    { id: 'overview', label: 'Özet', icon: LayoutDashboard },
    { id: 'tree', label: 'Çağrı ağacı', icon: GitBranch, count: t.scopes },
    { id: 'sql', label: 'SQL', icon: Database, count: t.sql },
    { id: 'repeats', label: embedded ? 'Tekrarlar' : 'Tekrarlar / N+1', icon: Repeat, count: analysis.repeats.length },
    { id: 'messages', label: 'Mesajlar', icon: MessageSquare, count: t.messages },
  ]
  if (!embedded) tabs.push({ id: 'raw', label: 'Ham dosya', icon: FileText })

  const close = useCallback(() => setSelected(null), [])
  const fills = tab === 'tree' || tab === 'raw'

  return (
    <div className={`flex h-full flex-col ${embedded ? '' : 'mx-auto w-full max-w-[1600px]'}`}>
      <div className={`flex items-center ${embedded ? 'gap-3 px-3 pt-3 pb-2' : 'flex-wrap gap-4 p-4'}`}>
        <ScoreDot score={analysis.score} size={embedded ? 'sm' : 'lg'} />
        <div className="min-w-0 flex-1">
          <div className={`flex items-baseline ${embedded ? 'gap-x-2' : 'flex-wrap gap-x-3'}`}>
            <h1 className={`shrink-0 font-semibold text-slate-900 dark:text-white ${embedded ? '' : 'text-lg'}`}>{transaction ?? 'Trace'}</h1>
            <span className={`truncate text-slate-500 ${embedded ? 'text-xs' : 'text-sm'}`} title={trace.name}>
              {trace.name}
            </span>
          </div>
          <div className={`flex flex-wrap text-slate-500 dark:text-slate-400 ${embedded ? 'gap-x-3 text-[11px]' : 'mt-0.5 gap-x-4 text-xs'}`}>
            {user && <span>{embedded ? user : `Kullanıcı: ${user}`}</span>}
            {date && <span>{embedded ? date : `Tarih: ${date}`}</span>}
            <span>{t.statements.toLocaleString('tr-TR')} satır</span>
            <span>{embedded ? '' : 'Süre '}≈ {fmtMs(t.totalMs)}</span>
            <span title="Analiz süresi">{embedded ? '' : 'Analiz: '}{Math.round(trace.result.parseMs)} ms</span>
          </div>
        </div>
        {parsed.warnings.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400" title={parsed.warnings.join('\n')}>
            <AlertTriangle className="h-4 w-4" /> {parsed.warnings.length}
            {!embedded && ' ayrıştırma notu'}
          </div>
        )}
      </div>

      <div
        className={`scroll-thin flex shrink-0 overflow-x-auto overflow-y-hidden border-b border-slate-200 dark:border-slate-800 ${
          embedded ? 'gap-0.5 px-2' : 'gap-1 px-4'
        }`}
      >
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            title={label}
            className={`-mb-px flex shrink-0 items-center border-b-2 font-medium transition ${
              embedded ? 'gap-1.5 px-2.5 py-2 text-[13px]' : 'gap-2 px-3 py-2.5 text-sm'
            } ${
              tab === id
                ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {count.toLocaleString('tr-TR')}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={`min-h-0 min-w-0 flex-1 ${embedded ? 'p-3' : 'p-4'} ${fills ? 'flex flex-col' : 'scroll-thin overflow-y-auto'}`}>
        {tab === 'overview' && <Overview result={trace.result} nav={nav} goTab={setTab} />}
        {tab === 'tree' && <CallTree parsed={parsed} nav={nav} target={treeTarget} selected={selected} />}
        {tab === 'sql' && <SqlView result={trace.result} nav={nav} />}
        {tab === 'repeats' && <RepeatsView result={trace.result} nav={nav} />}
        {tab === 'messages' && <MessagesView result={trace.result} nav={nav} />}
        {tab === 'raw' && !embedded && <RawView text={trace.text} nav={nav} target={rawTarget} />}
      </div>

      {selected !== null && <StatementDetail parsed={parsed} stmtId={selected} nav={nav} onClose={close} embedded={embedded} />}
    </div>
  )
}
