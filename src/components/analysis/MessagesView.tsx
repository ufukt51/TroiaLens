import { MessageSquare } from 'lucide-react'
import type { TraceResult } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { Empty } from '../ui.tsx'

const TYPE: Record<string, { label: string; cls: string }> = {
  E: { label: 'Hata', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  W: { label: 'Uyarı', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  I: { label: 'Bilgi', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  S: { label: 'Başarılı', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
}

export function MessagesView({ result, nav }: { result: TraceResult; nav: Nav }) {
  const { parsed, analysis } = result
  if (analysis.messages.length === 0) {
    return (
      <Empty icon={<MessageSquare className="h-8 w-8" />} title="Mesaj yok">
        Bu trace'te MESSAGE komutu çalışmamış.
      </Empty>
    )
  }
  return (
    <div className="card divide-y divide-slate-100 dark:divide-slate-800">
      {analysis.messages.map((id) => {
        const st = parsed.statements[id]
        const m = st.message!
        const t = TYPE[m.type] ?? { label: m.type, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' }
        return (
          <button key={id} className="flex w-full gap-4 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => nav.select(id)}>
            <span className={`chip mt-0.5 h-fit shrink-0 ${t.cls}`}>{t.label}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm whitespace-pre-wrap text-slate-900 dark:text-white">{m.text || '(metin yok)'}</div>
              <div className="mt-1 font-mono text-xs text-slate-500">
                {m.module} {m.type}
                {m.number} · {parsed.scopes[st.scopeId].label}:{st.srcLine}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
