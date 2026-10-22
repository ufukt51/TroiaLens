import { Fragment, useMemo, type ReactNode } from 'react'
import { DISPLAY_CUT } from '../lib/lines.ts'
import { MAX_LINE, tokenizeCode, tokenizeLine, type ColorSpan, type DecoSpan, type LineTokens, type SynClass } from '../lib/syntax.ts'

/** A range of characters, end exclusive */
export type Range = readonly [number, number]

const CLS: Record<SynClass, string> = {
  hata: 'syn-hata',
  sql: 'syn-sql',
  anahtar: 'syn-anahtar',
  tanim: 'syn-tanim',
  metod: 'syn-metod',
  sinif: 'syn-sinif',
  param: 'syn-param',
  deger: 'syn-deger',
  sonuk: 'syn-sonuk',
  t200: 'syn-t200',
  t1000: 'syn-t1000',
}
export const BAND_CLS = 'syn-band'
/** Characters coloured in a preview cut to a few lines (line-clamp) */
export const PREVIEW = 1000
const DECO_CLS = 'syn-uyari'

const NONE: LineTokens = { color: [], deco: [], band: false }
const CACHE_MAX = 2000
const cache = new Map<string, LineTokens>()

/**
 * Colouring of a file line as the raw and source views show it; lines scrolling back into view are not read again.
 * The note added to a cut line is left plain.
 */
export function lineTokens(text: string): LineTokens {
  if (!text) return NONE
  let t = cache.get(text)
  if (!t) {
    t = tokenizeLine(text.endsWith(DISPLAY_CUT) ? text.slice(0, -DISPLAY_CUT.length) : text)
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(text, t)
  }
  return t
}

/**
 * A detail line of a statement (stored trimmed), coloured as the file line it came from: an error's "* ..." bullet
 * was written under two tabs, anything else under one
 */
export function detailTokens(text: string): LineTokens {
  const pre = text.startsWith('*') ? '\t\t' : '\t'
  const n = pre.length
  const t = tokenizeLine(pre + text)
  return {
    color: t.color.map(([s, e, k]): ColorSpan => [Math.max(0, s - n), e - n, k]),
    deco: t.deco.map(([s, e]): DecoSpan => [Math.max(0, s - n), e - n]),
    band: t.band,
  }
}

/**
 * Text split into coloured spans, with wavy underlines and marks (search hits, the marked method name) laid over
 * them: pieces are cut at every boundary of the three, so none hides another. A mark stays one element around the
 * coloured pieces it covers; it should keep the text colour (text-inherit) so the colouring shows through.
 */
export function paint(
  text: string,
  color: readonly ColorSpan[],
  deco: readonly DecoSpan[] = [],
  marks: readonly Range[] = [],
  mark?: (key: number, children: ReactNode) => ReactNode,
): ReactNode {
  if (!color.length && !deco.length && !(marks.length && mark)) return text
  const n = text.length
  const clamp = (v: number) => Math.min(n, Math.max(0, v))
  const cuts = new Set<number>([0, n])
  for (const r of color) cuts.add(clamp(r[0])).add(clamp(r[1]))
  for (const r of deco) cuts.add(clamp(r[0])).add(clamp(r[1]))
  if (mark) for (const r of marks) cuts.add(clamp(r[0])).add(clamp(r[1]))
  const points = [...cuts].sort((a, b) => a - b)
  const spans = color.every((r, i) => i === 0 || color[i - 1][0] <= r[0]) ? color : [...color].sort((a, b) => a[0] - b[0])

  const out: ReactNode[] = []
  let group: ReactNode[] = []
  let groupMark = -1
  const flush = () => {
    if (groupMark >= 0) out.push(mark!(marks[groupMark][0], group))
    group = []
  }
  let ci = 0
  let mi = 0
  for (let p = 0; p + 1 < points.length; p++) {
    const a = points[p]
    const b = points[p + 1]
    while (ci < spans.length && spans[ci][1] <= a) ci++
    const k = ci < spans.length && spans[ci][0] <= a ? spans[ci][2] : null
    const under = deco.some((r) => r[0] <= a && a < r[1])
    let m = -1
    if (mark) {
      while (mi < marks.length && marks[mi][1] <= a) mi++
      if (mi < marks.length && marks[mi][0] <= a) m = mi
    }
    if (m !== groupMark) {
      flush()
      groupMark = m
    }
    const piece = text.slice(a, b)
    const cls = k ? (under ? `${CLS[k]} ${DECO_CLS}` : CLS[k]) : under ? DECO_CLS : ''
    const node = cls ? (
      <span key={a} className={cls}>
        {piece}
      </span>
    ) : (
      piece
    )
    if (groupMark >= 0) group.push(node)
    else out.push(node)
  }
  flush()
  return <>{out}</>
}

/**
 * Statement code coloured on its own (no line prefix); SQL is guessed from its first word unless given. Only the
 * first max characters are coloured (a long SQL would otherwise be thousands of elements), the rest stays plain.
 */
export function Code({ text, sql, max = MAX_LINE }: { text: string; sql?: boolean; max?: number }) {
  const color = useMemo(() => tokenizeCode(text.length > max ? text.slice(0, max) : text, sql), [text, sql, max])
  return <>{paint(text, color)}</>
}

/** Lines (the details of a statement) each coloured as the file line it came from, joined by line breaks */
export function DetailLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((d, i) => {
        const t = detailTokens(d)
        const body = paint(d, t.color, t.deco)
        return (
          <Fragment key={i}>
            {i > 0 && '\n'}
            {t.band ? <span className={BAND_CLS}>{body}</span> : body}
          </Fragment>
        )
      })}
    </>
  )
}
