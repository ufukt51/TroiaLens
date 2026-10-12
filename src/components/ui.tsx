import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
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

/** Fixed-row-height virtual list for very long trees and files. */
export function VirtualList<T>({
  items,
  rowHeight,
  render,
  className = '',
  scrollTo,
  overscan = 12,
}: {
  items: T[]
  rowHeight: number
  render: (item: T, index: number) => ReactNode
  className?: string
  scrollTo?: { index: number; nonce: number } | null
  overscan?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !scrollTo || scrollTo.index < 0) return
    const top = scrollTo.index * rowHeight
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - rowHeight * 2) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    }
  }, [scrollTo, rowHeight])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan)
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}>
        {render(items[i], i)}
      </div>,
    )
  }
  return (
    <div ref={ref} className={`scroll-thin relative overflow-auto ${className}`} onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: 'relative', minWidth: '100%' }}>{rows}</div>
    </div>
  )
}

export function ScoreDot({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const color =
    score >= 90 ? 'bg-emerald-500' : score >= 75 ? 'bg-brand-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  const dims = size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-xs'
  return <div className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color} ${dims}`}>{score}</div>
}
