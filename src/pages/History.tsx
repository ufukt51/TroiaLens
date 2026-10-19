import { useEffect, useState } from 'react'
import { History as HistoryIcon, Loader2, Trash2 } from 'lucide-react'
import { deleteHistory, listHistory, loadHistoryText, type HistoryEntry } from '../lib/storage.ts'
import { Empty } from '../components/ui.tsx'

function fmtSize(b: number) {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

export function History({ onLoad, busy }: { onLoad: (name: string, file: Blob, opts?: { remember?: boolean }) => void; busy: string | null }) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [missing, setMissing] = useState<string | null>(null)

  const refresh = () => void listHistory().then(setItems)
  useEffect(refresh, [])

  const open = async (h: HistoryEntry) => {
    setMissing(null)
    const file = h.hasText ? await loadHistoryText(h.id) : undefined
    if (file) onLoad(h.name, file)
    else setMissing(h.id)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Geçmiş</h1>
          <p className="text-sm text-slate-500">Analiz ettiğiniz trace'ler bu tarayıcıda saklanır.</p>
        </div>
        {items && items.length > 0 && (
          <button
            className="btn-outline text-rose-600 dark:text-rose-400"
            onClick={async () => {
              if (confirm('Tüm geçmiş silinsin mi?')) {
                await deleteHistory()
                refresh()
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> Tümünü sil
          </button>
        )}
      </div>

      {items === null ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <Empty icon={<HistoryIcon className="h-8 w-8" />} title="Henüz analiz yok">
          Bir trace dosyası yüklediğinizde burada listelenir.
        </Empty>
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((h) => (
            <div key={h.id} className="flex items-center gap-4 px-4 py-3">
              <button className="min-w-0 flex-1 text-left" disabled={!!busy} onClick={() => void open(h)}>
                <div className="truncate font-medium text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400">
                  {h.transaction ? `${h.transaction} · ` : ''}
                  <span className="font-normal text-slate-600 dark:text-slate-400">{h.name}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                  {h.user && <span>{h.user}</span>}
                  <span>{new Date(h.addedAt).toLocaleString('tr-TR')}</span>
                  <span>{fmtSize(h.size)}</span>
                  <span>{h.statements.toLocaleString('tr-TR')} satır</span>
                  <span>{h.sql.toLocaleString('tr-TR')} SQL</span>
                </div>
                {missing === h.id && <div className="mt-1 text-xs text-amber-600">Bu kaydın içeriği saklanmamış (dosya çok büyük). Dosyayı yeniden yükleyin.</div>}
              </button>
              {busy === h.name && <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}
              <button
                className="btn-ghost p-2"
                title="Sil"
                onClick={async () => {
                  await deleteHistory(h.id)
                  refresh()
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
