import { useEffect, useState } from 'react'
import { History, Moon, ScanSearch, Sun, Upload } from 'lucide-react'

type Route = 'home' | 'analysis' | 'history'

export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-brand-600" />
      <circle cx="14" cy="14" r="7" fill="none" stroke="#fff" strokeWidth="2.5" />
      <path d="M19 19l6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M10 15h2l1.5-3 2 5 1.5-2h1" fill="none" stroke="#5eead4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light')
    } catch {
      /* private mode */
    }
  }, [dark])
  return [dark, () => setDark((d) => !d)]
}

export function Header({ route, hasTrace, navigate }: { route: Route; hasTrace: boolean; navigate: (r: Route) => void }) {
  const [dark, toggle] = useTheme()
  const tab = (r: Route, label: string, Icon: typeof Upload, disabled = false) => (
    <button
      className={`btn px-3 py-1.5 ${
        route === r ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
      }`}
      disabled={disabled}
      onClick={() => navigate(r)}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
        <button className="flex items-center gap-2" onClick={() => navigate('home')}>
          <Logo />
          <span className="font-semibold tracking-tight text-slate-900 dark:text-white">
            Troia<span className="text-brand-600 dark:text-brand-400">Lens</span>
          </span>
        </button>
        <nav className="ml-4 flex items-center gap-1">
          {tab('home', 'Yükle', Upload)}
          {tab('analysis', 'Analiz', ScanSearch, !hasTrace)}
          {tab('history', 'Geçmiş', History)}
        </nav>
        <button className="btn-ghost ml-auto p-2" onClick={toggle} title={dark ? 'Açık tema' : 'Koyu tema'} aria-label="Temayı değiştir">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  )
}
