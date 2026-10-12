import { useState } from 'react'
import { Activity, AlertOctagon, Clock, Database, GitBranch, Layers, Repeat } from 'lucide-react'
import type { TraceResult } from '../../lib/types.ts'
import type { Nav, Tab } from '../../pages/AnalysisPage.tsx'
import { fmtMs } from '../../lib/analyze.ts'
import { Bar, KindChip, Kpi, SEVERITY_META, SectionTitle, msClass } from '../ui.tsx'

function HealthRing({ score, grade }: { score: number; grade: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  const color = score >= 90 ? '#10b981' : score >= 75 ? '#0f9e8f' : score >= 50 ? '#f59e0b' : '#f43f5e'
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" stroke={color} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{score}</div>
        <div className="text-xs font-medium text-slate-500">{grade}</div>
      </div>
    </div>
  )
}

export function Overview({ result, nav, goTab }: { result: TraceResult; nav: Nav; goTab: (t: Tab) => void }) {
  const { parsed, analysis } = result
  const t = analysis.totals
  const [showAllFindings, setShowAllFindings] = useState(false)
  const findings = showAllFindings ? analysis.findings : analysis.findings.slice(0, 8)
  const maxMethod = analysis.methods[0]?.totalMs ?? 0
  const counts = { critical: 0, warning: 0, info: 0 }
  for (const f of analysis.findings) counts[f.severity]++

  const jump = (fileLine?: number) => {
    if (!fileLine) return
    const id = nav.stmtAtLine(fileLine)
    if (id >= 0) nav.select(id)
    else nav.openRaw(fileLine)
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="card flex flex-col gap-5 p-5 lg:col-span-1">
        <div className="flex items-center gap-5">
          <HealthRing score={analysis.score} grade={analysis.grade} />
          <div className="space-y-2 text-sm">
            <div className="font-semibold text-slate-900 dark:text-white">Sağlık skoru</div>
            {(['critical', 'warning', 'info'] as const).map((s) => (
              <div key={s} className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <span className={`h-2 w-2 rounded-full ${SEVERITY_META[s].dot}`} />
                {counts[s]} {SEVERITY_META[s].label.toLowerCase()}
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-slate-500">
          Skor 100'den başlar; N+1 sorgular, yavaş satırlar, hata mesajları ve sık tekrarlanan işlemler puan düşürür.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2">
        <Kpi icon={<Clock className="h-3.5 w-3.5" />} label="Toplam süre" value={fmtMs(t.totalMs)} sub="iç içe süreler tekilleştirildi" />
        <Kpi icon={<Activity className="h-3.5 w-3.5" />} label="Çalışan satır" value={t.statements.toLocaleString('tr-TR')} sub={`${t.loops} döngü`} />
        <Kpi icon={<GitBranch className="h-3.5 w-3.5" />} label="Metot / event çağrısı" value={t.scopes.toLocaleString('tr-TR')} sub={`${analysis.methods.length} farklı`} />
        <Kpi
          icon={<Database className="h-3.5 w-3.5" />}
          label="SQL"
          value={t.sql.toLocaleString('tr-TR')}
          sub={t.sql ? `${t.sqlDb} veritabanı · ${t.sqlCache} önbellek` : 'sorgu yok'}
        />
        <Kpi icon={<Layers className="h-3.5 w-3.5" />} label="En derin çağrı" value={t.maxDepth} sub="seviye" />
        <Kpi icon={<AlertOctagon className="h-3.5 w-3.5" />} label="Mesaj" value={t.messages} sub={t.errors ? `${t.errors} hata` : 'hata yok'} />
      </div>

      <div className="card p-5 lg:col-span-2">
        <SectionTitle
          right={
            analysis.findings.length > 8 && (
              <button className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={() => setShowAllFindings((v) => !v)}>
                {showAllFindings ? 'Daha az' : `Tümü (${analysis.findings.length})`}
              </button>
            )
          }
        >
          Bulgular ve öneriler
        </SectionTitle>
        {findings.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">Belirgin bir sorun bulunamadı.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {findings.map((f) => (
              <li key={f.id} className="flex gap-3 py-2.5">
                <span className={`chip mt-0.5 h-fit shrink-0 ${SEVERITY_META[f.severity].cls}`}>{SEVERITY_META[f.severity].label}</span>
                <button className="min-w-0 flex-1 text-left" onClick={() => jump(f.fileLine)} disabled={!f.fileLine}>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{f.title}</div>
                  <div className="mt-0.5 text-xs break-words text-slate-500 dark:text-slate-400">{f.detail}</div>
                </button>
                {f.penalty > 0 && <span className="shrink-0 text-xs tabular-nums text-slate-400">−{f.penalty}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <SectionTitle>Trace bilgisi</SectionTitle>
        {parsed.meta.sections.length === 0 ? (
          <div className="text-sm text-slate-500">Dosyada başlık bilgisi yok (trace bir işlemin ortasından alınmış olabilir).</div>
        ) : (
          <dl className="space-y-1.5 text-xs">
            {parsed.meta.sections.flatMap((s) => s.fields).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-36 shrink-0 text-slate-500">{k}</dt>
                <dd className="min-w-0 break-all font-medium text-slate-800 dark:text-slate-200">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
        {(parsed.meta.dialogRefs.length > 0 || parsed.meta.classRefs.length > 0) && (
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
            {parsed.meta.dialogRefs.length} dialog ve {parsed.meta.classRefs.length} sınıf yönlendirmesi (cross reference)
          </div>
        )}
      </div>

      <div className="card p-5 lg:col-span-2">
        <SectionTitle
          right={
            <button className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={() => goTab('tree')}>
              Çağrı ağacı
            </button>
          }
        >
          En çok zaman alan metotlar
        </SectionTitle>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className="th">Metot</th>
                <th className="th text-right">Çağrı</th>
                <th className="th text-right">SQL</th>
                <th className="th w-40">Toplam</th>
                <th className="th text-right">Kendi</th>
              </tr>
            </thead>
            <tbody>
              {analysis.methods.slice(0, 12).map((m) => (
                <tr key={m.name} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50 dark:border-slate-800/50 dark:hover:bg-slate-800/40" onClick={() => nav.revealInTree(~m.firstScope)}>
                  <td className="td">
                    <div className="font-mono text-xs font-medium text-slate-900 dark:text-white">{m.label}</div>
                    <div className="font-mono text-[11px] text-slate-500">{m.owner}</div>
                  </td>
                  <td className="td text-right tabular-nums">{m.calls}</td>
                  <td className="td text-right tabular-nums">{m.sql || '—'}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Bar value={m.totalMs} max={maxMethod} />
                      <span className={`w-16 shrink-0 text-right text-xs tabular-nums ${msClass(m.totalMs)}`}>{fmtMs(m.totalMs)}</span>
                    </div>
                  </td>
                  <td className={`td text-right text-xs tabular-nums ${msClass(m.selfMs)}`}>{fmtMs(m.selfMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <SectionTitle
          right={
            analysis.repeats.length > 0 && (
              <button className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400" onClick={() => goTab('repeats')}>
                <Repeat className="h-3.5 w-3.5" /> {analysis.repeats.length} tekrar
              </button>
            )
          }
        >
          En yavaş satırlar
        </SectionTitle>
        <ul className="space-y-1">
          {analysis.slowest.slice(0, 10).map((id) => {
            const st = parsed.statements[id]
            return (
              <li key={id}>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => nav.select(id)}>
                  <KindChip kind={st.kind} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{st.code.split('\n')[0]}</span>
                  <span className={`shrink-0 text-xs tabular-nums ${msClass(st.exclMs)}`} title={`Raporlanan: ${fmtMs(st.ms)}`}>
                    {fmtMs(st.exclMs)}
                  </span>
                </button>
              </li>
            )
          })}
          {analysis.slowest.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Süresi ölçülen satır yok.</li>}
        </ul>
      </div>
    </div>
  )
}
