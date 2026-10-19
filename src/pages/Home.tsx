import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowRight, ClipboardPaste, Database, FileText, GitBranch, Lightbulb, Loader2, Lock, Repeat, X } from 'lucide-react'
import { listHistory, loadHistoryText, type HistoryEntry } from '../lib/storage.ts'
import { Logo } from '../components/Header.tsx'

interface Props {
  onLoad: (name: string, file: Blob, opts?: { remember?: boolean }) => void
  busy: string | null
  error: string | null
  onDismissError: () => void
  navigate: (r: 'home' | 'analysis' | 'history') => void
}

const FEATURES = [
  { icon: GitBranch, title: 'Çağrı ağacı', text: 'Event, metot ve sınıf çağrılarını iç içe görün; her düğümün süresini ve SQL sayısını izleyin.' },
  { icon: Database, title: 'SQL analizi', text: 'Sorguları gruplayın, veritabanı ve önbellek isabetlerini ayırın, en pahalı tabloları bulun.' },
  { icon: Repeat, title: 'N+1 tespiti', text: 'Döngü içinde tekrar tekrar çalışan sorgu ve metot çağrılarını otomatik yakalayın.' },
  { icon: Lightbulb, title: 'Bulgular ve öneriler', text: 'Yavaş satırları, hata mesajlarını ve tekrarları bulun; her sorun için bir öneri alın.' },
]

export function Home({ onLoad, busy, error, onDismissError, navigate }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [paste, setPaste] = useState(false)
  const [pasted, setPasted] = useState('')
  const [recent, setRecent] = useState<HistoryEntry[]>([])

  useEffect(() => {
    void listHistory().then((h) => setRecent(h.slice(0, 4)))
  }, [])

  const openFile = async (file: File | undefined) => {
    if (file) onLoad(file.name, file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    void openFile(e.dataTransfer.files[0])
  }

  const loadSample = async () => {
    const res = await fetch('./sample-trace.txt')
    onLoad('ornek_SALT01_100_2026_10_012_10_30_00_0001.txt', await res.blob(), { remember: false })
  }

  const openRecent = async (h: HistoryEntry) => {
    const file = h.hasText ? await loadHistoryText(h.id) : undefined
    if (file) onLoad(h.name, file, { remember: true })
    else navigate('history')
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <div className="mb-10 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
          <Lock className="h-3.5 w-3.5" /> Tamamen tarayıcıda çalışır
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          Canias Troia trace'lerini <span className="text-brand-600 dark:text-brand-400">saniyeler içinde</span> çözümleyin
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-600 dark:text-slate-400">
          Trace dosyasını bırakın; çağrı ağacını, SQL yükünü, döngüdeki tekrarları ve performans sorunlarını tek ekranda görün.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          <div className="flex-1">{error}</div>
          <button onClick={onDismissError} aria-label="Kapat">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`card relative flex flex-col items-center gap-4 border-2 border-dashed px-6 py-14 text-center transition ${
          drag ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-900/20' : 'border-slate-300 dark:border-slate-700'
        }`}
      >
        {busy ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-brand-600" />
            <div className="font-medium text-slate-900 dark:text-white">Analiz ediliyor…</div>
            <div className="max-w-full truncate text-sm text-slate-500">{busy}</div>
          </>
        ) : (
          <>
            <div className="rounded-2xl bg-brand-50 p-4 dark:bg-brand-900/30">
              <FileText className="h-9 w-9 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">Trace dosyasını buraya sürükleyin</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">.trace, .txt veya .log · büyük dosyalar da desteklenir</div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn-primary" onClick={() => input.current?.click()}>
                Dosya seç
              </button>
              <button className="btn-outline" onClick={() => void loadSample()}>
                Örnek trace ile dene
              </button>
              <button className="btn-ghost" onClick={() => setPaste((p) => !p)}>
                <ClipboardPaste className="h-4 w-4" /> Metin yapıştır
              </button>
            </div>
            <input ref={input} type="file" accept=".trace,.txt,.log,text/plain" className="hidden" onChange={(e) => void openFile(e.target.files?.[0])} />
          </>
        )}
      </div>

      {paste && !busy && (
        <div className="card mt-4 p-4">
          <textarea
            className="input h-48 font-mono text-xs"
            placeholder="Trace içeriğini buraya yapıştırın…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={!pasted.trim()} onClick={() => onLoad(`yapistirilan_${new Date().toISOString().slice(0, 19)}.txt`, new Blob([pasted], { type: 'text/plain' }))}>
              Analiz et <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {recent.length > 0 && !busy && (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Son analizler</h2>
            <button className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => navigate('history')}>
              Tümü
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recent.map((h) => (
              <button key={h.id} className="card flex items-center gap-3 p-3 text-left hover:border-brand-400" onClick={() => void openRecent(h)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{h.transaction ?? h.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    {h.user ? `${h.user} · ` : ''}
                    {new Date(h.addedAt).toLocaleString('tr-TR')}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card p-5">
            <Icon className="mb-3 h-5 w-5 text-brand-600 dark:text-brand-400" />
            <div className="font-semibold text-slate-900 dark:text-white">{title}</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{text}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Logo className="h-4 w-4" /> Canias'ta trace açıkken işlemi çalıştırın, oluşan "TROIA CODE EXECUTION TRACE" .txt dosyasını yükleyin.
      </div>
    </div>
  )
}
