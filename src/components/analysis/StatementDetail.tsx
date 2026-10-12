import { useEffect } from 'react'
import { ChevronRight, FileText, GitBranch, X } from 'lucide-react'
import type { ParsedTrace } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { fmtMs } from '../../lib/analyze.ts'
import { KindChip, formatSql, msClass } from '../ui.tsx'

export function StatementDetail({
  parsed,
  stmtId,
  nav,
  onClose,
  embedded,
}: {
  parsed: ParsedTrace
  stmtId: number
  nav: Nav
  onClose: () => void
  /** In the Notepad++ panel the line opens in the editor instead of the raw view */
  embedded: boolean
}) {
  const st = parsed.statements[stmtId]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  if (!st) return null
  const path: number[] = []
  for (let s = st.scopeId; s > 0; s = parsed.scopes[s].parent) path.unshift(s)
  const loop = st.loopId >= 0 ? parsed.statements[st.loopId] : null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20 backdrop-blur-[1px] dark:bg-black/40" onClick={onClose}>
      <aside
        className="scroll-thin flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
          <KindChip kind={st.kind} />
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-white">Satır {st.srcLine}</div>
          <button className="btn-ghost p-1.5" onClick={onClose} aria-label="Kapat">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {path.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                <button className="font-mono hover:text-brand-600" onClick={() => nav.revealInTree(~id)} title={parsed.scopes[id].name}>
                  {parsed.scopes[id].label}
                </button>
              </span>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Raporlanan süre" value={<span className={msClass(st.ms)}>{fmtMs(st.ms)}</span>} />
            <Stat label="Kendi süresi" value={<span className={msClass(st.exclMs)}>{fmtMs(st.exclMs)}</span>} />
            <Stat label="Kaynak satırı" value={st.srcLine} />
            <Stat label="Dosya satırı" value={st.fileLine.toLocaleString('tr-TR')} />
          </div>

          <Block title="Kod">{st.sql ? formatSql(st.code) : st.code}</Block>
          {st.trail && <Block title="Değerlendirme">{st.trail}</Block>}

          {st.sql && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className={`chip ${st.sql.cached ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'}`}>
                  {st.sql.cached ? 'Önbellekten' : 'Veritabanı'}
                </span>
                {st.sql.rows !== undefined && <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{st.sql.rows} satır döndü</span>}
                {st.sql.tables.map((t) => (
                  <span key={t} className="chip bg-slate-100 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t}
                  </span>
                ))}
              </div>
              {st.sql.resolved && <Block title="Veritabanına giden sorgu">{formatSql(st.sql.resolved)}</Block>}
            </div>
          )}

          {st.message && (
            <Block title={`Mesaj ${st.message.module} ${st.message.type}${st.message.number}`}>{st.message.text}</Block>
          )}

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

          <div className="flex flex-wrap gap-2 pt-2">
            <button className="btn-outline" onClick={() => nav.revealInTree(st.id)}>
              <GitBranch className="h-4 w-4" /> Ağaçta göster
            </button>
            <button className="btn-outline" onClick={() => nav.openRaw(st.fileLine)}>
              <FileText className="h-4 w-4" /> {embedded ? 'Editörde göster' : 'Ham dosyada aç'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <pre className="scroll-thin max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        {children}
      </pre>
    </div>
  )
}
