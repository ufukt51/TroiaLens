import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { Mark } from '../../lib/locate.ts'
import type { LineSource } from '../../lib/source.ts'
import type { ColorSpan, DecoSpan } from '../../lib/syntax.ts'
import { ResizeHandle, VirtualList } from '../ui.tsx'
import { BAND_CLS, lineTokens, paint, type Range } from '../SyntaxText.tsx'

const ROW_H = 20
const WIDTH_KEY = 'troialens.sourceWidth'
const WRAP_KEY = 'troialens.sourceWrap'
const MIN_W = 320
/** Room the call tree keeps beside the pane (with the gap between them) */
const KEEP_LEFT = 376
/** Line number column plus the text's left padding */
const GUTTER = 56 + 12
const TAB = 8

function savedWidth(): number | null {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY))
    if (w >= MIN_W) return w
  } catch {
    // Storage may be blocked; the default width will do
  }
  return null
}

function savedWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) !== '0'
  } catch {
    return true
  }
}

function saveWrap(on: boolean) {
  try {
    localStorage.setItem(WRAP_KEY, on ? '1' : '0')
  } catch {
    // Not remembered then
  }
}

/**
 * Tabs as spaces, so a wrapped line's length is its width in characters; at maps an offset in the text to the
 * expanded one (null when there is no tab)
 */
function expandTabs(text: string): { shown: string; at: number[] | null } {
  if (!text.includes('	')) return { shown: text, at: null }
  let out = ''
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    at.push(out.length)
    out += text[i] === '	' ? ' '.repeat(TAB - (out.length % TAB)) : text[i]
  }
  at.push(out.length)
  return { shown: out, at }
}

function saveWidth(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(w))
  } catch {
    // Not remembered then
  }
}

/**
 * Browser counterpart of the Notepad++ editor: the trace file next to a list (call tree, issues), with the
 * selected row's method span, its own lines and the method name marked. A new nonce scrolls to the mark.
 * Its left edge drags to resize (double click restores the default width); it can also fill the screen.
 * Long lines wrap by default (break anywhere, so a line's row count follows from its length).
 */
export function SourcePane({
  source,
  mark: m,
  nonce,
  onClose,
  onLine,
  hint,
}: {
  source: LineSource
  mark: Mark
  nonce: number
  onClose: () => void
  /** A file line was clicked */
  onLine: (line: number) => void
  hint: string
}) {
  useSyncExternalStore(source.subscribe, source.getVersion)
  const onRange = useCallback((from: number, to: number) => source.load(from, to), [source])
  const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number } | null>(null)
  const [width, setWidth] = useState(savedWidth)
  const [full, setFull] = useState(false)
  const [wrap, setWrap] = useState(savedWrap)
  const [charW, setCharW] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ w: number; max: number } | null>(null)

  useEffect(() => setScrollTo({ index: m.line - 1, nonce }), [nonce, m.line])

  // Filling the screen keeps the marked line in view; Esc goes back (before the detail pane would close on it)
  const line = useRef(m.line)
  line.current = m.line
  useEffect(() => {
    setScrollTo({ index: line.current - 1, nonce: Date.now() })
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setFull(false)
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [full])

  // Wrapping keeps the marked line in view too
  useEffect(() => setScrollTo({ index: line.current - 1, nonce: Date.now() }), [wrap])

  // Width of one code character; measured again once the web font has loaded
  useLayoutEffect(() => {
    const measure = () => {
      const el = probe.current
      if (el) setCharW(el.getBoundingClientRect().width / el.textContent!.length)
    }
    measure()
    document.fonts?.ready.then(measure)
  }, [])

  // Items are the lines' widths with tabs expanded, measured when the file was read
  const rowsOf = useCallback(
    (columns: number, width: number) => {
      const cols = Math.max(1, Math.floor((width - GUTTER - 1) / charW))
      return Math.max(1, Math.ceil(columns / cols))
    },
    [charW],
  )
  const toggleWrap = (on: boolean) => {
    setWrap(on)
    saveWrap(on)
  }

  const word = useMemo(() => (m.word ? new RegExp(`(?<![\\w])${m.word.replace(/\./g, '\\.')}(?![\\w])`, 'g') : null), [m.word])
  const span = m.from > 0 ? `Satır ${m.from.toLocaleString('tr-TR')}–${m.to.toLocaleString('tr-TR')}` : `Satır ${m.line.toLocaleString('tr-TR')}`

  const onStart = () => {
    const row = box.current?.parentElement?.clientWidth ?? 1200
    drag.current = { w: box.current?.offsetWidth ?? MIN_W, max: Math.max(MIN_W, row - KEEP_LEFT) }
  }
  const onDrag = (dx: number) => {
    const d = drag.current
    if (d) setWidth(Math.round(Math.min(d.max, Math.max(MIN_W, d.w - dx))))
  }
  const onEnd = () => saveWidth(width)
  const resetWidth = () => {
    setWidth(null)
    saveWidth(null)
  }

  return (
    <div
      ref={box}
      className={full ? 'fixed inset-0 z-30 flex bg-slate-900/20 p-4 backdrop-blur-[1px] dark:bg-black/50' : 'relative hidden min-h-[320px] shrink-0 lg:flex'}
      style={full ? undefined : { width: width ? `min(${width}px, calc(100% - ${KEEP_LEFT}px))` : `min(60%, calc(100% - ${KEEP_LEFT}px))`, minWidth: MIN_W }}
    >
      {!full && (
        <ResizeHandle
          axis="x"
          className="inset-y-0 -left-4 w-4"
          title="Genişliği değiştirmek için sürükleyin · çift tıklayınca varsayılana döner"
          onStart={onStart}
          onDrag={onDrag}
          onEnd={onEnd}
          onReset={resetWidth}
        />
      )}
      <div className={`card flex min-w-0 flex-1 flex-col overflow-hidden ${full ? 'shadow-xl' : ''}`}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <div className="min-w-0 flex-1 truncate text-sm">
            <span className="font-medium text-slate-900 dark:text-white">Kaynak görünümü</span>
            <span className="ml-2 text-xs text-slate-500">{span}</span>
            {m.word && <span className="ml-2 font-mono text-xs text-amber-700 dark:text-amber-300">{m.word}</span>}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 select-none dark:text-slate-400" title="Uzun satırları alt satıra kaydır">
            <input type="checkbox" className="accent-brand-500" checked={wrap} onChange={(e) => toggleWrap(e.target.checked)} />
            Sözcük kaydır
          </label>
          <button
            className="btn-ghost p-1.5"
            onClick={() => setFull((f) => !f)}
            aria-label={full ? 'Küçült' : 'Ekranı kapla'}
            title={full ? 'Küçült' : 'Ekranı kapla'}
          >
            {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button className="btn-ghost p-1.5" onClick={onClose} aria-label="Kapat" title="Kapat">
            <X className="h-4 w-4" />
          </button>
        </div>
        <VirtualList
          className="flex-1 bg-white dark:bg-slate-950"
          items={source.widths}
          rowHeight={ROW_H}
          scrollTo={scrollTo}
          rowsOf={wrap && charW > 0 ? rowsOf : undefined}
          onRange={onRange}
          render={(_, i) => {
            const text = source.get(i) ?? ''
            const n = i + 1
            const inSpan = n >= m.from && n <= m.to
            const own = n >= m.line && n <= m.lineEnd
            // Coloured on the line as written; offsets follow the tabs expanded for wrapping
            const tok = lineTokens(text)
            const { shown, at } = wrap ? expandTabs(text) : { shown: text, at: null }
            const color = at ? tok.color.map(([s, e, k]): ColorSpan => [at[s], at[e], k]) : tok.color
            const deco = at ? tok.deco.map(([s, e]): DecoSpan => [at[s], at[e]]) : tok.deco
            return (
              <div
                className={`flex h-full cursor-pointer items-start font-mono text-xs leading-5 ${
                  own
                    ? 'bg-amber-200/70 dark:bg-amber-500/30'
                    : tok.band
                      ? BAND_CLS
                      : inSpan
                        ? 'bg-amber-50 dark:bg-amber-500/[0.07]'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                }`}
                onClick={() => onLine(n)}
              >
                <span
                  className={`sticky left-0 w-14 shrink-0 self-stretch border-r-2 bg-slate-50 pr-2 text-right text-[11px] text-slate-400 select-none dark:bg-slate-900 ${
                    inSpan || own ? 'border-amber-400 dark:border-amber-500' : 'border-transparent'
                  }`}
                >
                  {n}
                </span>
                <span className={`pl-3 text-slate-700 dark:text-slate-300 ${wrap ? 'min-w-0 flex-1 break-all whitespace-break-spaces' : 'whitespace-pre'}`}>
                  {paint(shown, color, deco, inSpan && word ? wordAt(shown, word) : [], wordMark)}
                </span>
              </div>
            )
          }}
        />
        <span ref={probe} aria-hidden className="pointer-events-none invisible absolute font-mono text-xs whitespace-pre">
          {'M'.repeat(100)}
        </span>
        <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-800">{hint}</div>
      </div>
    </div>
  )
}

/** Where the marked method name occurs in a line */
function wordAt(text: string, re: RegExp): Range[] {
  const out: Range[] = []
  re.lastIndex = 0
  for (let m = re.exec(text); m; m = re.exec(text)) out.push([m.index, m.index + m[0].length])
  return out
}

const wordMark = (key: number, children: ReactNode) => (
  <mark key={key} className="rounded-sm bg-brand-200/80 px-px text-inherit ring-1 ring-brand-400/60 dark:bg-brand-500/30 dark:ring-brand-400/50">
    {children}
  </mark>
)
