import { CheckCircle2, Database, Flame, Repeat } from 'lucide-react'
import type { RepeatPattern, TraceResult } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { THRESHOLDS, fmtMs } from '../../lib/analyze.ts'
import { Empty, KindChip, SectionTitle, msClass } from '../ui.tsx'
import { Code, PREVIEW } from '../SyntaxText.tsx'

export function RepeatsView({ result, nav }: { result: TraceResult; nav: Nav }) {
  const { analysis } = result
  const sql = analysis.repeats.filter((r) => r.kind === 'sql')
  const calls = analysis.repeats.filter((r) => r.kind === 'call')
  const hot = analysis.hotLines.slice(0, 30)

  const open = (fileLine: number) => {
    const id = nav.stmtAtLine(fileLine)
    if (id >= 0) nav.select(id)
    else nav.openRaw(fileLine)
  }

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Database className="h-4 w-4 text-violet-500" /> Döngüde tekrarlanan sorgular (N+1)
          </span>
        </SectionTitle>
        {sql.length === 0 ? (
          <Empty icon={<CheckCircle2 className="h-7 w-7 text-emerald-500" />} title="N+1 sorgu bulunmadı">
            Aynı döngü çalışması içinde {THRESHOLDS.repeatInLoop} veya daha fazla tekrarlanan sorgu yok.
          </Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {sql.map((r) => (
              <PatternCard key={`${r.label}|${r.loopFileLine}`} r={r} onOpen={open} nav={nav} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-brand-500" /> Döngüde tekrarlanan metot çağrıları
          </span>
        </SectionTitle>
        {calls.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-500">Döngü içinde {THRESHOLDS.repeatInLoop}+ kez çağrılan metot yok.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {calls.map((r) => (
              <PatternCard key={`${r.label}|${r.loopFileLine}`} r={r} onOpen={open} nav={nav} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" /> En sık çalışan satırlar
          </span>
        </SectionTitle>
        <div className="card scroll-thin overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className="th">Kod</th>
                <th className="th">Yer</th>
                <th className="th text-right">Çalışma</th>
                <th className="th text-right">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {hot.map((h) => (
                <tr key={h.key} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50 dark:border-slate-800/50 dark:hover:bg-slate-800/40" onClick={() => open(h.firstFileLine)}>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <KindChip kind={h.kind} />
                      <span className="max-w-xl truncate font-mono text-xs">
                        <Code text={h.code} />
                      </span>
                    </div>
                  </td>
                  <td className="td max-w-64 truncate font-mono text-xs text-slate-500" title={h.scopeName}>
                    {h.scopeName.replace(/^\([^)]*\)\s*/, '')}:{h.srcLine}
                  </td>
                  <td className="td text-right font-semibold tabular-nums">{h.count.toLocaleString('tr-TR')}</td>
                  <td className={`td text-right text-xs tabular-nums ${msClass(h.ms)}`}>{fmtMs(h.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hot.length === 0 && <div className="p-6 text-center text-sm text-slate-500">Tekrar eden satır yok.</div>}
        </div>
      </section>
    </div>
  )
}

function PatternCard({ r, onOpen, nav }: { r: RepeatPattern; onOpen: (fileLine: number) => void; nav: Nav }) {
  const severe = r.kind === 'sql' ? r.dbHits >= 20 : r.hasSql
  return (
    <div className={`card p-4 ${severe ? 'border-l-4 border-l-rose-400' : r.kind === 'sql' && r.dbHits >= THRESHOLDS.repeatInLoop ? 'border-l-4 border-l-amber-400' : ''}`}>
      <button className="block w-full text-left" onClick={() => onOpen(r.sampleFileLine)}>
        <div className="line-clamp-3 font-mono text-xs break-all text-slate-800 dark:text-slate-200">
          <Code text={r.label} max={PREVIEW} />
        </div>
      </button>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        <span>
          Tek döngüde <b className="text-slate-900 dark:text-white">{r.maxPerRun}×</b>
        </span>
        {r.loopRuns > 1 && <span>{r.loopRuns} döngü çalışması · toplam {r.count}</span>}
        {r.kind === 'sql' && (
          <span>
            {r.dbHits} db · {r.count - r.dbHits} cache
          </span>
        )}
        {r.kind === 'call' && r.hasSql && <span className="text-violet-600 dark:text-violet-400">SQL içeriyor</span>}
        <span className={msClass(r.totalMs)}>{fmtMs(r.totalMs)}</span>
      </div>
      <button
        className="mt-3 w-full truncate rounded-md bg-amber-50 px-2 py-1.5 text-left font-mono text-[11px] text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50 dark:hover:text-amber-200"
        onClick={() => nav.select(r.loopStmtId)}
        title="Döngü satırı"
      >
        ↻ {r.loopCode}
      </button>
    </div>
  )
}
