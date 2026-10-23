import { useEffect, useState } from 'react'
import { Download, ExternalLink, Puzzle, RefreshCw } from 'lucide-react'

const RELEASES = 'https://github.com/ufukt51/TroiaLensPlugin/releases/latest'
const LATEST_API = 'https://api.github.com/repos/ufukt51/TroiaLensPlugin/releases/latest'
const CACHE_KEY = 'pluginRelease'

interface PluginRelease {
  version: string
  setupUrl: string | null
}

/**
 * Latest Notepad++ plugin release, read from GitHub once per browser session. Only the release is asked for; no trace
 * leaves the page. Null while loading or when GitHub cannot be reached: the card then links the releases page.
 */
function useLatestRelease(): PluginRelease | null {
  const [release, setRelease] = useState<PluginRelease | null>(() => {
    try {
      const kept = sessionStorage.getItem(CACHE_KEY)
      return kept ? (JSON.parse(kept) as PluginRelease) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (release) return
    let live = true
    fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { tag_name?: string; assets?: { name: string; browser_download_url: string }[] }) => {
        const version = (json.tag_name ?? '').replace(/^v/i, '')
        if (!version || !live) return
        const setup = json.assets?.find((a) => /^TroiaLens-Setup-.*\.exe$/i.test(a.name))
        const found = { version, setupUrl: setup?.browser_download_url ?? null }
        setRelease(found)
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(found))
        } catch {
          /* private mode */
        }
      })
      .catch(() => {
        /* Offline or rate limited: the links still work */
      })
    return () => {
      live = false
    }
  }, [release])

  return release
}

/** Home page card for the Notepad++ plugin: latest version, download, and how existing installs get it. */
export function PluginCard() {
  const release = useLatestRelease()

  return (
    <section className="card mt-8 p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="shrink-0 rounded-2xl bg-brand-50 p-3 self-start dark:bg-brand-900/30">
          <Puzzle className="h-6 w-6 text-brand-600 dark:text-brand-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-slate-900 dark:text-white">Notepad++ eklentisi</h2>
            {release && (
              <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">v{release.version} yayında</span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Aynı analiz ekranları Notepad++ içinde: trace dosyasını açtığınızda panel kendiliğinden açılır, tıkladığınız satıra editör gider.
          </p>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <span className="font-medium">Güncelleme:</span> 0.1.4 ve sonraki sürümler yeni sürümü kendileri bulup kurar.{' '}
              <span className="font-medium">0.1.0–0.1.3</span> kullanıyorsanız Notepad++'ı kapatıp kurulum programını bir kez
              çalıştırın; eski sürüm kendiliğinden kaldırılır.
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn-primary" href={release?.setupUrl ?? RELEASES} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" /> Kurulum programını indir
            </a>
            <a className="btn-outline" href={RELEASES} target="_blank" rel="noopener noreferrer">
              Sürüm notları <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
