import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from 'react'
import { Check, Copy, GripHorizontal, GripVertical } from 'lucide-react'
import type { Severity, StmtKind } from '../lib/types.ts'

export const KIND_META: Record<StmtKind, { label: string; cls: string }> = {
  sql: { label: 'SQL', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  if: { label: 'IF', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  loop: { label: 'LOOP', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  while: { label: 'WHILE', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  switch: { label: 'SWITCH', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  return: { label: 'RET', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300' },
  object: { label: 'OBJ', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300' },
  params: { label: 'PARAM', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300' },
  message: { label: 'MSG', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  assign: { label: '=', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  call: { label: 'CALL', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  table: { label: 'TABLE', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
  other: { label: '·', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
}

export function KindChip({ kind }: { kind: StmtKind }) {
  const m = KIND_META[kind]
  return <span className={`chip w-12 shrink-0 justify-center font-mono ${m.cls}`}>{m.label}</span>
}

export const SEVERITY_META: Record<Severity, { label: string; cls: string; dot: string }> = {
  critical: { label: 'Kritik', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', dot: 'bg-rose-500' },
  warning: { label: 'Uyarı', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', dot: 'bg-amber-500' },
  info: { label: 'Bilgi', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', dot: 'bg-sky-500' },
}

export function msClass(ms: number): string {
  if (ms >= 1000) return 'text-rose-600 dark:text-rose-400 font-semibold'
  if (ms >= 200) return 'text-amber-600 dark:text-amber-400 font-medium'
  if (ms > 0) return 'text-slate-700 dark:text-slate-300'
  return 'text-slate-400 dark:text-slate-600'
}

export function Kpi({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{children}</h2>
      {right}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-slate-400">{icon}</div>}
      <div className="font-medium text-slate-900 dark:text-white">{title}</div>
      {children && <div className="max-w-md text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </div>
  )
}

export function Bar({ value, max, className = 'bg-brand-500' }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Puts line breaks before main SQL clauses for readability. */
export function formatSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s+(FROM|WHERE|INNER JOIN|LEFT OUTER JOIN|LEFT JOIN|RIGHT JOIN|JOIN|GROUP\s*BY|ORDER\s*BY|HAVING|UNION|SET|VALUES|INTO)\b/gi, '\n$1')
    .replace(/\s+(AND|OR)\b/gi, '\n  $1')
    .trim()
}

/** Browsers stop growing a box at some 17 (Firefox) to 33 (Chrome) million pixels; taller lists scroll scaled */
const MAX_SCROLL_PX = 10_000_000

/**
 * Virtual list for very long trees and files. Rows are rowHeight tall; with rowsOf an item spans that many rows
 * (wrapped text), worked out from the list's inner width. A list taller than browsers can lay out scrolls
 * proportionally: the scroll bar covers it all, one pixel of it moves the content a little more.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  render,
  className = '',
  scrollTo,
  overscan = 12,
  rowsOf,
  onRange,
}: {
  items: ArrayLike<T>
  rowHeight: number
  render: (item: T, index: number) => ReactNode
  className?: string
  scrollTo?: { index: number; nonce: number } | null
  overscan?: number
  /** Rows an item takes at the given inner width (at least 1); keep it stable, a new function re-measures all */
  rowsOf?: (item: T, width: number) => number
  /** Items about to be drawn, from..to (exclusive) */
  onRange?: (from: number, to: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      setHeight(el.clientHeight)
      setWidth(el.clientWidth)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  // Top of each item (and the total at the end); null while every item is one row
  const tops = useMemo(() => {
    if (!rowsOf || width <= 0) return null
    const t = new Float64Array(items.length + 1)
    for (let i = 0; i < items.length; i++) t[i + 1] = t[i] + Math.max(1, rowsOf(items[i], width)) * rowHeight
    return t
  }, [items, rowsOf, width, rowHeight])

  const topOf = (i: number) => (tops ? tops[i] : i * rowHeight)
  const indexAt = (y: number) => {
    if (!tops) return Math.floor(y / rowHeight)
    let lo = 0
    let hi = items.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (tops[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  // Content pixels per scrolled pixel: 1 unless the list is taller than a box can be
  const total = topOf(items.length)
  const box = Math.min(total, MAX_SCROLL_PX)
  const scale = total > box ? (total - height) / Math.max(1, box - height) : 1
  const view = scrollTop * scale

  useEffect(() => {
    const el = ref.current
    if (!el || !scrollTo || scrollTo.index < 0) return
    const top = tops ? tops[Math.min(scrollTo.index, items.length)] : scrollTo.index * rowHeight
    const shown = el.scrollTop * scale
    if (top < shown || top > shown + el.clientHeight - rowHeight * 2) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3) / scale
    }
    // A new request scrolls, and so does the first measure; later re-measures keep the reader's place
  }, [scrollTo, rowHeight, tops !== null])

  const start = Math.max(0, indexAt(view) - overscan)
  const end = Math.min(items.length, indexAt(view + height) + 1 + overscan)
  useEffect(() => onRange?.(start, end), [onRange, start, end])
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    const top = topOf(i)
    rows.push(
      <div key={i} style={{ position: 'absolute', top: top - view + scrollTop, height: topOf(i + 1) - top, left: 0, right: 0 }}>
        {render(items[i], i)}
      </div>,
    )
  }
  return (
    <div ref={ref} className={`scroll-thin relative overflow-auto ${className}`} onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: box, position: 'relative', minWidth: '100%' }}>{rows}</div>
    </div>
  )
}

export function ScoreDot({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const color =
    score >= 90 ? 'bg-emerald-500' : score >= 75 ? 'bg-brand-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  const dims = size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-xs'
  return <div className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color} ${dims}`}>{score}</div>
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Clipboard API refused (no secure context or permission); fall back to a selection copy
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

/**
 * Drag handle on a pane edge: axis 'x' sits on a left edge and drags sideways, 'y' on a top edge and drags up
 * and down. Uses the system resize cursors and shows a grip; the line along the edge lights up while hovered
 * or dragged. Double click calls onReset.
 */
export function ResizeHandle({
  axis,
  className = '',
  title,
  onStart,
  onDrag,
  onEnd,
  onReset,
}: {
  axis: 'x' | 'y'
  className?: string
  title: string
  onStart: () => void
  /** Pointer movement since the drag began */
  onDrag: (delta: number) => void
  onEnd: () => void
  onReset?: () => void
}) {
  const start = useRef<number | null>(null)
  const [active, setActive] = useState(false)
  const x = axis === 'x'
  const Grip = x ? GripVertical : GripHorizontal
  const pos = (e: ReactPointerEvent) => (x ? e.clientX : e.clientY)
  const end = () => {
    if (start.current === null) return
    start.current = null
    setActive(false)
    onEnd()
  }

  return (
    <div
      role="separator"
      aria-orientation={x ? 'vertical' : 'horizontal'}
      title={title}
      className={`group absolute z-10 flex touch-none items-center justify-center select-none ${x ? 'cursor-ew-resize' : 'cursor-ns-resize'} ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = pos(e)
        setActive(true)
        onStart()
      }}
      onPointerMove={(e) => start.current !== null && onDrag(pos(e) - start.current)}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
    >
      <span
        className={`absolute rounded-full transition-colors ${x ? 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2' : 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2'} ${
          active ? 'bg-brand-500' : 'bg-transparent group-hover:bg-brand-500/60'
        }`}
      />
      <span
        className={`relative flex items-center justify-center rounded-md border shadow-sm transition-colors ${x ? 'h-8 w-3.5' : 'h-3.5 w-8'} ${
          active
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-slate-200 bg-white text-slate-400 group-hover:border-brand-400 group-hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 dark:group-hover:border-brand-500 dark:group-hover:text-brand-300'
        }`}
      >
        <Grip className="h-3 w-3" />
      </span>
    </div>
  )
}

/** A <pre> with a copy button at its top right; copies the text as shown. */
export function CodeBlock({ className = '', children }: { className?: string; children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    await copyText(pre.current?.textContent ?? '')
    setCopied(true)
  }

  return (
    <div className="group relative">
      <pre ref={pre} className={`pr-10 ${className}`}>
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        className={`absolute top-1.5 right-1.5 rounded-md border p-1 transition ${
          copied
            ? 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
            : 'border-slate-200 bg-white/90 text-slate-400 opacity-70 group-hover:opacity-100 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/90 dark:hover:text-brand-300'
        }`}
        title={copied ? 'Kopyalandı' : 'Kopyala'}
        aria-label={copied ? 'Kopyalandı' : 'Kopyala'}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
