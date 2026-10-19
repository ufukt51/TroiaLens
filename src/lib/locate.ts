import type { ParsedTrace } from './types.ts'

/** Index of the last item whose key is <= value, -1 if none. Items must be sorted by key. */
function lastAtOrBefore<T>(items: T[], key: (item: T) => number, value: number, from = 0): number {
  let lo = from
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(items[mid]) <= value) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** Line number an editor shows for a trace line: bare CRs before it count as extra line breaks. */
export function editorLine(parsed: ParsedTrace, line: number): number {
  return line + lastAtOrBefore(parsed.crBreaks, (l) => l, line - 1) + 1
}

/** Trace line holding an editor line number (inverse of editorLine). */
export function traceLine(parsed: ParsedTrace, editor: number): number {
  let line = editor
  // Each bare CR on an earlier trace line takes one editor line away
  for (const l of parsed.crBreaks) if (l < line) line--
  return Math.max(1, line)
}

/**
 * Tree row for a file line, encoded like Nav.revealInTree (>= 0 statement, < 0 ~scope): the statement printed
 * at or above the line inside the innermost scope that contains it, or that scope itself on its header line.
 */
export function refAtLine(parsed: ParsedTrace, line: number): number | null {
  const { scopes, statements } = parsed
  if (line < parsed.bodyStartLine || statements.length === 0) return null

  // Scopes are numbered in the order they open; the innermost one around the line is the last opened
  // before it, or the nearest of its ancestors that has not closed yet
  let scope = Math.max(0, lastAtOrBefore(scopes, (s) => s.startLine, line, 1))
  while (scope > 0 && scopes[scope].endLine < line) scope = scopes[scope].parent

  const sc = scopes[scope]
  if (scope > 0 && !sc.implicit && sc.startLine === line) return ~scope

  let best = -1
  for (const k of sc.kids) {
    if (k < 0) {
      if (scopes[~k].startLine > line) break
    } else {
      if (statements[k].fileLine > line) break
      best = k
    }
  }
  if (best >= 0) return best
  return scope > 0 ? ~scope : null
}

export interface Mark {
  /** Span of the row's scope; 0 for top-level rows */
  from: number
  to: number
  /** The row's own lines */
  line: number
  lineEnd: number
  /** Method name, marked wherever it appears in the span */
  word: string
}

/** File lines to mark for a tree row: its scope's span, the row's own lines and the method name. */
export function markFor(parsed: ParsedTrace, ref: number): Mark {
  const { scopes, statements } = parsed
  const scopeId = ref < 0 ? ~ref : statements[ref].scopeId
  const s = scopes[scopeId]
  let line = s.startLine
  let lineEnd = line
  if (ref >= 0) {
    const st = statements[ref]
    line = st.fileLine
    lineEnd = line + st.span
    const next = statements[ref + 1]
    if (next) lineEnd = Math.max(line, Math.min(lineEnd, next.fileLine - 1))
  }
  if (scopeId === 0) return { from: 0, to: 0, line, lineEnd, word: '' }
  return { from: s.startLine, to: s.endLine, line, lineEnd, word: /^[\w.]+$/.test(s.label) ? s.label : '' }
}
