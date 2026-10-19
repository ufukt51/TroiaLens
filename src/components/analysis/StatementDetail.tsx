import { useEffect, useRef, useState } from 'react'
import { ChevronRight, FileText, GitBranch, PanelBottom, PanelRight, X } from 'lucide-react'
import type { ParsedTrace } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { fmtMs, issueText } from '../../lib/analyze.ts'
import { editorLine } from '../../lib/locate.ts'
import { CodeBlock, KindChip, ResizeHandle, formatSql, msClass } from '../ui.tsx'

const HEIGHT_KEY = 'troialens.detailHeight'
const MIN_H = 120
const DEFAULT_H = 300
/** Room the views above the pane keep */
const KEEP_ABOVE = 140

function savedHeight(): number {
  try {
    const h = Number(localStorage.getItem(HEIGHT_KEY))
    if (h >= MIN_H) return h
  } catch {
    // Storage may be blocked; the default height will do
  }
  return DEFAULT_H
}

/**
 * Detail of a statement: docked under the analysis views (its top edge drags to resize), or with slideOver
 * a panel sliding over from the right.
 */
export function StatementDetail({
  parsed,
  stmtId,
  nav,
  onClose,
  embedded,
  slideOver = false,
  onToggleSlideOver,
}: {
  parsed: ParsedTrace
  stmtId: number
  nav: Nav
  onClose: () => void
  /** In the Notepad++ panel the line opens in the editor instead of the raw view */
  embedded: boolean
  slideOver?: boolean
  /** Switches between the bottom pane and the slide-over */
  onToggleSlideOver?: () => void
}) {
  const st = parsed.statements[stmtId]
  const [height, setHeight] = useState(savedHeight)
  const pane = useRef<HTMLElement>(null)
  const drag = useRef<{ h: number; max: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  const maxHeight = () => Math.max(MIN_H, (pane.current?.parentElement?.clientHeight ?? 600) - KEEP_ABOVE)

  const onStart = () => {
    drag.current = { h: pane.current?.offsetHeight ?? height, max: maxHeight() }
  }
  const onDrag = (dy: number) => {
    const d = drag.current
    if (d) setHeight(Math.round(Math.min(d.max, Math.max(MIN_H, d.h - dy))))
  }
  const saveHeight = (h: number | null) => {
    try {
      if (h === null) localStorage.removeItem(HEIGHT_KEY)
      else localStorage.setItem(HEIGHT_KEY, String(h))
    } catch {
      // Not remembered then
    }
  }
  const resetHeight = () => {
    setHeight(DEFAULT_H)
    saveHeight(null)
  }

  if (!st) return null
  const path: number[] = []
  for (let s = st.scopeId; s > 0; s = parsed.scopes[s].parent) path.unshift(s)
  const loop = st.loopId >= 0 ? parsed.statements[st.loopId] : null
  const issues = parsed.issues.filter((i) => i.stmtId === st.id)
  const missing = issues.filter((i) => i.kind === 'missingParam')
  const errors = issues.filter((i) => i.kind !== 'missingParam')

  const header = (
    <div className={`flex shrink-0 items-center gap-2 border-b border-slate-200 dark:border-slate-800 ${embedded ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
      <KindChip kind={st.kind} />
      <span className="shrink-0 text-sm font-medium text-slate-900 dark:text-white">Satır {st.srcLine}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs whitespace-nowrap text-slate-500">
        {path.map((id, i) => (
          <span key={id} className={`flex items-center gap-1 ${i < path.length - 1 ? 'min-w-0 shrink' : 'shrink-0'}`}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
            <button className="truncate font-mono hover:text-brand-600" onClick={() => nav.revealInTree(~id)} title={parsed.scopes[id].name}>
              {parsed.scopes[id].label}
            </button>
          </span>
        ))}
      </div>
      <button className="btn-ghost shrink-0 p-1.5" onClick={() => nav.revealInTree(st.id)} title="Ağaçta göster" aria-label="Ağaçta göster">
        <GitBranch className="h-4 w-4" />
      </button>
      <button
        className="btn-ghost shrink-0 p-1.5"
        onClick={() => nav.openRaw(st.fileLine)}
        title={embedded ? 'Editörde göster' : 'Ham dosyada aç'}
        aria-label={embedded ? 'Editörde göster' : 'Ham dosyada aç'}
      >
        <FileText className="h-4 w-4" />
      </button>
      {onToggleSlideOver && (
        <button
          className="btn-ghost shrink-0 p-1.5"
          onClick={onToggleSlideOver}
          title={slideOver ? 'Altta bölme olarak göster' : 'Sağda kayan panelde göster'}
          aria-label={slideOver ? 'Altta bölme olarak göster' : 'Sağda kayan panelde göster'}
        >
          {slideOver ? <PanelBottom className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </button>
      )}
      <button className="btn-ghost shrink-0 p-1.5" onClick={onClose} title="Kapat (Esc)" aria-label="Kapat">
        <X className="h-4 w-4" />
      </button>
    </div>
  )

  const body = (
    <div className={`scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto text-sm ${embedded ? 'p-3' : 'p-4'}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Raporlanan süre" value={<span className={msClass(st.ms)}>{fmtMs(st.ms)}</span>} />
        <Stat label="Kendi süresi" value={<span className={msClass(st.exclMs)}>{fmtMs(st.exclMs)}</span>} />
        <Stat label="Kaynak satırı" value={st.srcLine} />
        <Stat label="Dosya satırı" value={editorLine(parsed, st.fileLine).toLocaleString('tr-TR')} />
      </div>

      {errors.length > 0 && (
        <div className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {errors.map((i) => (
            <div key={i.fileLine}>
              <span className="font-semibold">{i.kind === 'error' ? 'Hata' : 'Uyarı'}:</span> {issueText(i)}
              {(i.text ? i.details : i.details.slice(0, -1)).map((d, k) => (
                <div key={k} className="truncate pl-3 font-mono text-[11px] opacity-80" title={d}>
                  • {d}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
          <span className="font-semibold">Eksik parametre:</span> <span className="font-mono">{missing.map((i) => i.text).join(', ')}</span>
        </div>
      )}

      <Block title="Kod">{st.sql ? formatSql(st.code) : st.code}</Block>
      {st.trail && <Block title="Değerlendirme">{st.trail}</Block>}
      {st.cut && (
        <div className="text-xs text-slate-500">
          Metin uzun olduğu için kısaltıldı.{' '}
          <button className="underline hover:text-slate-700 dark:hover:text-slate-300" onClick={() => nav.openRaw(st.fileLine)}>
            Tamamı {embedded ? 'editörde' : 'ham dosyada'}, {editorLine(parsed, st.fileLine).toLocaleString('tr-TR')}. satırda
          </button>
        </div>
      )}

      {st.sql && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className={`chip ${st.sql.cached ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'}`}>
              {st.sql.cached ? 'Önbellekten' : 'Veritabanı'}
            </span>
            {st.sql.rows !== undefined && <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{st.sql.rows} satır {st.sql.verb === 'SELECT' ? 'döndü' : 'etkilendi'}</span>}
            {st.sql.tables.map((t) => (
              <span key={t} className="chip bg-slate-100 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {t}
              </span>
            ))}
          </div>
          {st.sql.resolved && <Block title="Veritabanına giden sorgu">{formatSql(st.sql.resolved)}</Block>}
        </div>
      )}

      {st.message && <Block title={`Mesaj ${st.message.module} ${st.message.type}${st.message.number}`}>{st.message.text}</Block>}

      {(st.loopRows !== undefined || st.iterations) && (
        <div className="text-xs text-slate-600 dark:text-slate-400">
          {st.loopRows !== undefined && <>Tablo satırı: {st.loopRows} · </>}
          Çalışan iterasyon: {st.iterations ?? 0}
        </div>
      )}

      {loop && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Bu satır bir döngü içinde çalıştı:{' '}
          <button className="font-mono underline" onClick={() => nav.select(loop.id)}>
            {loop.code.split('\n')[0].slice(0, 120)}
          </button>
        </div>
      )}

      {st.details.length > 0 && <Block title="Ayrıntılar">{st.details.join('\n')}</Block>}
    </div>
  )

  if (slideOver)
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20 backdrop-blur-[1px] dark:bg-black/40" onClick={onClose}>
        <aside
          className="flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
          onClick={(e) => e.stopPropagation()}
          aria-label="Satır ayrıntısı"
        >
          {header}
          {body}
        </aside>
      </div>
    )

  return (
    <section
      ref={pane}
      className="relative flex shrink-0 flex-col border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      style={{ height: `min(${height}px, calc(100% - ${KEEP_ABOVE}px))`, minHeight: MIN_H }}
      aria-label="Satır ayrıntısı"
    >
      <ResizeHandle
        axis="y"
        className="inset-x-0 -top-2 h-4"
        title="Yüksekliği değiştirmek için sürükleyin · çift tıklayınca varsayılana döner"
        onStart={onStart}
        onDrag={onDrag}
        onEnd={() => saveHeight(height)}
        onReset={resetHeight}
      />
      {header}
      {body}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-1.5 dark:bg-slate-800/60">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <CodeBlock className="scroll-thin max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        {children}
      </CodeBlock>
    </div>
  )
}
