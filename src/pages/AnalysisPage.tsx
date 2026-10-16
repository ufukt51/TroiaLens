import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Database, FileText, GitBranch, LayoutDashboard, MessageSquare, Repeat } from 'lucide-react'
import type { LoadedTrace } from '../lib/types.ts'
import { parseFileName } from '../lib/run.ts'
import { fmtMs } from '../lib/analyze.ts'
import { onHostMessage, postToHost } from '../lib/host.ts'
import { markFor, refAtLine, type Mark } from '../lib/locate.ts'
import { Overview } from '../components/analysis/Overview.tsx'
import { CallTree } from '../components/analysis/CallTree.tsx'
import { SqlView } from '../components/analysis/SqlView.tsx'
import { RepeatsView } from '../components/analysis/RepeatsView.tsx'
import { MessagesView } from '../components/analysis/MessagesView.tsx'
import { IssuesView } from '../components/analysis/IssuesView.tsx'
import { RawView } from '../components/analysis/RawView.tsx'
import { StatementDetail } from '../components/analysis/StatementDetail.tsx'
import { SourcePane } from '../components/analysis/SourcePane.tsx'

const SLIDE_OVER_KEY = 'troialens.detailSlideOver'

function savedSlideOver(): boolean {
  try {
    return localStorage.getItem(SLIDE_OVER_KEY) === '1'
  } catch {
    return false
  }
}

export type Tab = 'overview' | 'tree' | 'sql' | 'repeats' | 'messages' | 'issues' | 'raw'

/** Selected call tree row: >= 0 statement, < 0 scope encoded as ~id. A new nonce scrolls the tree to it. */
export interface Cursor {
  ref: number
  nonce: number
  /** Also expand the scope (when revealed from another view) */
  open?: boolean
}

export interface Nav {
  /** Opens the detail pane for a statement (in Notepad++ also moves the editor caret to it) */
  select: (stmtId: number) => void
  /** Selects a tree row; the editor (Notepad++) or the source pane (browser) follows it */
  pick: (ref: number) => void
  /** Clears the tree selection and its highlights */
  unpick: () => void
  /** Switches to the call tree and reveals the statement (>= 0) or scope (encoded ~id) */
  revealInTree: (ref: number) => void
  /** Shows a file line: the raw view in the browser, the editor in Notepad++ */
  openRaw: (fileLine: number) => void
  /** Notepad++: moves the editor caret to the mark's line (keeping focus in the panel) and marks it there */
  showInEditor: (m: Mark) => void
  /** Finds the statement printed at a file line, if any */
  stmtAtLine: (fileLine: number) => number
}

/**
 * Fills its container's height. `embedded` is the Notepad++ panel: compact header, no raw view
 * (the editor itself shows the file) and line jumps go to the editor.
 */
export function AnalysisPage({
  trace,
  embedded,
  detailSlideOver,
}: {
  trace: LoadedTrace
  embedded: boolean
  /** Statement detail slides over from the right instead of docking under the views (Notepad++ setting) */
  detailSlideOver?: boolean
}) {
  const { parsed, analysis } = trace.result
  const [tab, setTab] = useState<Tab>('overview')
  const [detail, setDetail] = useState<number | null>(null)
  const [slideOver, setSlideOver] = useState(() => detailSlideOver ?? savedSlideOver())
  useEffect(() => {
    if (detailSlideOver !== undefined) setSlideOver(detailSlideOver)
  }, [detailSlideOver])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [issuesOpened, setIssuesOpened] = useState(false)
  if (tab === 'issues' && !issuesOpened) setIssuesOpened(true)
  const [rawTarget, setRawTarget] = useState<{ line: number; nonce: number } | null>(null)

  const lineIndex = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of parsed.statements) m.set(s.fileLine, s.id)
    return m
  }, [parsed])

  const lines = useMemo(() => (embedded ? [] : trace.text.split(/\r?\n/)), [trace.text, embedded])

  const nav: Nav = useMemo(() => {
    // In Notepad++ the editor is the source view: move its caret to the row and mark the row's method there
    const follow = (ref: number) => {
      if (!embedded) return
      const m = markFor(parsed, ref)
      postToHost({ type: 'gotoLine', line: m.line, focus: false })
      postToHost({ type: 'mark', ...m })
    }
    return {
      select: (id) => {
        if (!parsed.statements[id]) return
        setDetail(id)
        setCursor({ ref: id, nonce: Date.now() })
        follow(id)
      },
      pick: (ref) => {
        setCursor({ ref, nonce: Date.now() })
        follow(ref)
        if (ref < 0) return
        // An open detail pane follows the selection; narrow browser windows have no room for the source pane,
        // so the detail pane takes its place
        const open = !embedded && !matchMedia('(min-width: 1024px)').matches
        setDetail((d) => (d !== null || open ? ref : d))
      },
      unpick: () => {
        setCursor(null)
        if (embedded) postToHost({ type: 'clearMarks' })
      },
      revealInTree: (ref) => {
        setCursor({ ref, nonce: Date.now(), open: true })
        setTab('tree')
        follow(ref)
      },
      openRaw: (line) => {
        if (embedded) {
          postToHost({ type: 'gotoLine', line, focus: true })
          return
        }
        setRawTarget({ line, nonce: Date.now() })
        setTab('raw')
      },
      showInEditor: (m) => {
        if (!embedded) return
        postToHost({ type: 'gotoLine', line: m.line, focus: false })
        postToHost({ type: 'mark', ...m })
      },
      stmtAtLine: (line) => lineIndex.get(line) ?? -1,
    }
  }, [lineIndex, parsed, embedded])

  // Notepad++: moving the editor caret selects the matching row while the call tree is open
  const tabRef = useRef(tab)
  tabRef.current = tab
  useEffect(() => {
    if (!embedded) return
    let timer = 0
    const off = onHostMessage((msg) => {
      if (msg.type !== 'caret' || tabRef.current !== 'tree') return
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const ref = refAtLine(parsed, msg.line)
        if (ref === null) return
        setCursor((c) => (c?.ref === ref ? c : { ref, nonce: Date.now() }))
        if (ref >= 0) setDetail((d) => (d === null ? d : ref))
        postToHost({ type: 'mark', ...markFor(parsed, ref) })
      }, 60)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [embedded, parsed])

  const fromName = parseFileName(trace.name)
  const info = analysis.info
  const transaction = info['Transaction'] ?? fromName.transaction
  const user = info['User Name'] ?? fromName.user
  const date = info['Trace Date'] ?? fromName.date
  const t = analysis.totals

  const tabs: { id: Tab; label: string; icon: typeof FileText; count?: number; alert?: boolean }[] = [
    { id: 'overview', label: 'Özet', icon: LayoutDashboard },
    { id: 'tree', label: 'Çağrı ağacı', icon: GitBranch, count: t.scopes },
    { id: 'sql', label: 'SQL', icon: Database, count: t.sql },
    { id: 'repeats', label: embedded ? 'Tekrarlar' : 'Tekrarlar / N+1', icon: Repeat, count: analysis.repeats.length },
    { id: 'messages', label: 'Mesajlar', icon: MessageSquare, count: t.messages },
    { id: 'issues', label: 'Hata/Uyarı', icon: CircleAlert, count: t.traceErrors + t.traceWarnings + t.missingParams + t.errors + t.warnings, alert: t.traceErrors + t.errors > 0 },
  ]
  if (!embedded) tabs.push({ id: 'raw', label: 'Ham dosya', icon: FileText })

  const close = useCallback(() => setDetail(null), [])
  // Notepad++ keeps the choice in its settings (and ticks its menu item); the browser remembers it locally
  const toggleSlideOver = () => {
    const on = !slideOver
    setSlideOver(on)
    if (embedded) postToHost({ type: 'setPrefs', detailSlideOver: on })
    else
      try {
        localStorage.setItem(SLIDE_OVER_KEY, on ? '1' : '0')
      } catch {
        // Not remembered then
      }
  }
  const fills = tab === 'tree' || tab === 'issues' || tab === 'raw'

  return (
    <div className={`flex h-full flex-col ${embedded ? '' : 'mx-auto w-full max-w-[1600px]'}`}>
      <div className={`flex items-center ${embedded ? 'gap-3 px-3 pt-3 pb-2' : 'flex-wrap gap-4 p-4'}`}>
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
      </div>

      <div
        className={`scroll-thin flex shrink-0 overflow-x-auto overflow-y-hidden border-b border-slate-200 dark:border-slate-800 ${
          embedded ? 'gap-0.5 px-2' : 'gap-1 px-4'
        }`}
      >
        {tabs.map(({ id, label, icon: Icon, count, alert }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            title={label}
            aria-current={tab === id ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center rounded-t-md border-b-2 transition ${
              embedded ? 'gap-1.5 px-2.5 py-2 text-[13px]' : 'gap-2 px-3 py-2.5 text-sm'
            } ${
              tab === id
                ? 'border-brand-600 bg-brand-100/80 font-semibold text-brand-900 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-300'
                : 'border-transparent font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {count !== undefined && count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  alert
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                    : tab === id
                      ? 'bg-brand-600 text-white dark:bg-brand-500/30 dark:text-brand-200'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {count.toLocaleString('tr-TR')}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={`min-h-0 min-w-0 flex-1 ${embedded ? 'p-3' : 'p-4'} ${fills ? 'flex flex-col' : 'scroll-thin overflow-y-auto'}`}>
        {tab === 'overview' && <Overview result={trace.result} nav={nav} goTab={setTab} />}
        {tab === 'tree' && (
          <div className="flex min-h-0 flex-1 gap-4">
            <CallTree parsed={parsed} nav={nav} cursor={cursor} />
            {!embedded && cursor && (
              <SourcePane
                lines={lines}
                mark={markFor(parsed, cursor.ref)}
                nonce={cursor.nonce}
                onClose={nav.unpick}
                onLine={(n) => {
                  const ref = refAtLine(parsed, n)
                  if (ref !== null) nav.pick(ref)
                }}
                hint="Satıra tıklayınca ağaçta seçilir"
              />
            )}
          </div>
        )}
        {tab === 'sql' && <SqlView result={trace.result} nav={nav} />}
        {tab === 'repeats' && <RepeatsView result={trace.result} nav={nav} />}
        {tab === 'messages' && <MessagesView result={trace.result} nav={nav} />}
        {/* Stays mounted once opened: narrow browser windows jump to the raw view and come back to the same place */}
        {issuesOpened && (
          <div className={tab === 'issues' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <IssuesView key={trace.id} result={trace.result} nav={nav} lines={lines} embedded={embedded} />
          </div>
        )}
        {tab === 'raw' && !embedded && <RawView lines={lines} parsed={parsed} nav={nav} target={rawTarget} />}
      </div>

      {detail !== null && (
        <StatementDetail
          parsed={parsed}
          stmtId={detail}
          nav={nav}
          onClose={close}
          embedded={embedded}
          slideOver={slideOver}
          onToggleSlideOver={toggleSlideOver}
        />
      )}
    </div>
  )
}
