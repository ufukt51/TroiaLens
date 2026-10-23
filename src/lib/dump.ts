import type { DumpColumn, TraceDump } from './types.ts'
import { toXlsx, type CellKind } from './xlsx.ts'

/** Cells of a printed row, in header order */
export function dumpCells(d: TraceDump, row: string): string[] {
  const out: string[] = []
  for (let k = 0; k < d.header.length; k++) out.push(row.slice(d.prefix + k * d.width, d.prefix + (k + 1) * d.width).trimEnd())
  return out
}

/** Row number printed before the cells ("7." -> 7) */
export function dumpRowNumber(d: TraceDump, row: string): number {
  return parseInt(row.slice(0, d.prefix), 10) || 0
}

/** The value fills its cell and the column holds longer ones: the trace may have cut it */
export function cellCut(d: TraceDump, k: number, value: string): boolean {
  return value.length >= d.width && (d.columns[k]?.length ?? Infinity) > d.width
}

const NUMERIC = /^(INTEGER|DECIMAL|LONG|DOUBLE|FLOAT|NUMBER|NUMERIC|SHORT|BYTE)$/i

export function isNumeric(c: DumpColumn | undefined): boolean {
  return !!c && NUMERIC.test(c.type)
}

/** "STRING(40)", "DECIMAL(23,2)", "INTEGER" */
export function typeLabel(c: DumpColumn): string {
  if (/^STRING$/i.test(c.type)) return `${c.type}(${c.length})`
  if (/^DECIMAL$/i.test(c.type)) return `${c.type}(${c.length},${c.scale})`
  return c.type
}

const TRUE = /^(1|true)$/i

export type RowState = 'inserted' | 'deleted' | 'updated' | null

/** What the row state cells (INSERTED, DELETED, UPDATED, CHANGED) say about a row */
export function rowState(d: TraceDump, cells: string[]): RowState {
  const at = (name: string) => {
    for (let k = d.columns.length; k < d.header.length; k++) if (d.header[k] === name) return TRUE.test(cells[k] ?? '')
    return false
  }
  if (at('DELETED')) return 'deleted'
  if (at('INSERTED')) return 'inserted'
  if (at('UPDATED') || at('CHANGED')) return 'updated'
  return null
}

/** Tab separated text that spreadsheets paste as a table */
export function toTsv(d: TraceDump, cols: number[], rows: string[][]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ')
  const lines = [cols.map((k) => clean(d.header[k])).join('\t')]
  for (const cells of rows) lines.push(cols.map((k) => clean(cells[k] ?? '')).join('\t'))
  return lines.join('\r\n')
}

/** Excel workbook: STRING cells stay text ("00" stays "00"), numbers and dates keep their type */
export function toDumpXlsx(d: TraceDump, cols: number[], rows: string[][]): Promise<Uint8Array> {
  const kind = (k: number): CellKind => {
    const c = d.columns[k]
    if (!c) return 'number' // row state cells: 0/1, true/false
    if (isNumeric(c)) return 'number'
    if (/^DATE(TIME)?$/i.test(c.type)) return 'date'
    return 'text'
  }
  return toXlsx(d.name || 'dump', cols.map((k) => d.header[k]), cols.map(kind), rows.map((cells) => cols.map((k) => cells[k] ?? '')))
}

/** CSV with ';' between fields, as Excel opens it on Turkish Windows; no BOM, the writer adds it */
export function toCsv(d: TraceDump, cols: number[], rows: string[][]): string {
  const field = (s: string) => (/[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [cols.map((k) => field(d.header[k])).join(';')]
  for (const cells of rows) lines.push(cols.map((k) => field(cells[k] ?? '')).join(';'))
  return lines.join('\r\n') + '\r\n'
}
