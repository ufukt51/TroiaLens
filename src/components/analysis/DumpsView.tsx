import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Download, FileSpreadsheet, FileText, GitBranch, Rows3, Search, Sheet, Table2 } from 'lucide-react'
import type { ParsedTrace, TraceDump } from '../../lib/types.ts'
import type { Nav } from '../../pages/AnalysisPage.tsx'
import { cellCut, dumpCells, dumpRowNumber, isNumeric, rowState, toCsv, toDumpXlsx, toTsv, typeLabel, type RowState } from '../../lib/dump.ts'
import { inHost, postToHost } from '../../lib/host.ts'
import { editorLine } from '../../lib/locate.ts'
import { usePersisted } from '../../lib/docState.ts'
import { Empty, copyText } from '../ui.tsx'

/** Rows drawn at first; more on request, so a dump of thousands of rows stays quick */
const PAGE = 300

type Mode = 'table' | 'record'

const STATE_META: Record<Exclude<RowState, null>, { label: string; cls: string }> = {
  inserted: { label: 'Yeni', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  updated: { label: 'Değişti', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  deleted: { label: 'Silindi', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
}

const CUT_TITLE = 'Trace değeri hücre genişliğinde keser; devamı olabilir'

function where(parsed: ParsedTrace, d: TraceDump): string {
  const st = parsed.statements[d.stmtId]
  const scope = parsed.scopes[st ? st.scopeId : d.scopeId]
  return st ? `${scope.label}:${st.srcLine}` : scope.label
}

/** Browser download, outside the plugin */
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function base64(data: Uint8Array): string {
  let s = ''
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Tables printed by DUMP, shown as tables */
export function DumpsView({
  parsed,
  nav,
  embedded,
  selected,
  onSelect,
}: {
  parsed: ParsedTrace
  nav: Nav
  embedded: boolean
  selected: number
  onSelect: (index: number) => void
}) {
  const dumps = parsed.dumps
  if (dumps.length === 0) {
    return (
      <Empty icon={<Sheet className="h-8 w-8" />} title="Dump yok">
        Bu trace'te DUMP komutuyla yazdırılmış tablo bulunamadı.
      </Empty>
    )
  }
  const index = Math.min(Math.max(0, selected), dumps.length - 1)
  const d = dumps[index]

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {!embedded && dumps.length > 1 && (
        <aside className="card scroll-thin hidden w-64 shrink-0 overflow-y-auto p-2 lg:block" aria-label="Dump listesi">
          <ul className="space-y-0.5">
            {dumps.map((x, i) => (
              <li key={i}>
                <button
                  className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                    i === index ? 'bg-brand-50 dark:bg-brand-900/30' : ''
                  }`}
                  onClick={() => onSelect(i)}
                  aria-current={i === index ? 'true' : undefined}
                >
                  <div className="truncate font-mono text-xs font-medium text-slate-900 dark:text-white" title={x.name}>
                    {x.name || '(adsız)'}
                  </div>
                  <div className="mt-0.5 flex justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate" title={where(parsed, x)}>
                      {where(parsed, x)}
                    </span>
                    <span className="shrink-0 tabular-nums">{x.rowCount.toLocaleString('tr-TR')} satır</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
      {/* A new dump starts with its own filters, page and view */}
      <DumpTable key={index} parsed={parsed} nav={nav} embedded={embedded} dumps={dumps} index={index} onSelect={onSelect} dump={d} />
    </div>
  )
}

function DumpTable({
  parsed,
  nav,
  embedded,
  dumps,
  index,
  onSelect,
  dump: d,
}: {
  parsed: ParsedTrace
  nav: Nav
  embedded: boolean
  dumps: TraceDump[]
  index: number
  onSelect: (index: number) => void
  dump: TraceDump
}) {
  const [mode, setMode] = useState<Mode>('table')
  const [showState, setShowState] = usePersisted('dump.state', false)
  const [colQuery, setColQuery] = useState('')
  const [valQuery, setValQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [record, setRecord] = useState(() => Math.max(0, Math.min(d.rows.length - 1, d.activeRow - 1)))
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const cells = useMemo(() => d.rows.map((r) => dumpCells(d, r)), [d])
  const numbers = useMemo(() => d.rows.map((r) => dumpRowNumber(d, r)), [d])
  const states = useMemo(() => cells.map((c) => rowState(d, c)), [d, cells])
  const anyState = states.some((s) => s !== null)
  const stateCount = d.header.length - d.columns.length

  const cols = useMemo(() => {
    const q = colQuery.trim().toLocaleUpperCase('tr-TR')
    const out: number[] = []
    for (let k = 0; k < d.header.length; k++) {
      if (!showState && k >= d.columns.length) continue
      if (q && !d.header[k].toLocaleUpperCase('tr-TR').includes(q)) continue
      out.push(k)
    }
    return out
  }, [d, colQuery, showState])

  const rows = useMemo(() => {
    const q = valQuery.trim().toLocaleLowerCase('tr-TR')
    const out: number[] = []
    for (let i = 0; i < cells.length; i++) if (!q || cols.some((k) => (cells[i][k] ?? '').toLocaleLowerCase('tr-TR').includes(q))) out.push(i)
    return out
  }, [cells, cols, valQuery])

  const copy = async () => {
    const shown = mode === 'record' ? (cells[record] ? [record] : []) : rows
    await copyText(toTsv(d, cols, shown.map((i) => cells[i])))
    setCopied(true)
  }

  const fileName = (ext: string) => `${d.name || 'dump'}_${where(parsed, d)}.${ext}`.replace(/[\\/:*?"<>|\s]+/g, '_')

  const exportCsv = () => {
    const name = fileName('csv')
    const text = toCsv(d, cols, rows.map((i) => cells[i]))
    if (inHost()) postToHost({ type: 'saveCsv', name, text })
    else download(name, new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  }

  const exportXlsx = async () => {
    const name = fileName('xlsx')
    const data = await toDumpXlsx(d, cols, rows.map((i) => cells[i]))
    if (inHost()) postToHost({ type: 'saveXlsx', name, data: base64(data) })
    else download(name, new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  }

  const activeCol = d.activeCol.toUpperCase()
  const st = parsed.statements[d.stmtId]
  const loc = where(parsed, d)

  return (
    <div className="card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 dark:border-slate-800 ${embedded ? 'px-3 py-2' : 'px-4 py-3'}`}>
        {dumps.length > 1 && (
          <select
            className={`input w-auto max-w-full font-mono ${embedded ? '' : 'lg:hidden'}`}
            value={index}
            onChange={(e) => onSelect(Number(e.target.value))}
            aria-label="Dump seç"
          >
            {dumps.map((x, i) => (
              <option key={i} value={i}>
                {x.name || '(adsız)'} · {where(parsed, x)} · {x.rowCount} satır
              </option>
            ))}
          </select>
        )}
        <div className={`min-w-0 items-baseline gap-2 ${dumps.length > 1 ? (embedded ? 'hidden' : 'hidden lg:flex') : 'flex'}`}>
          <h2 className="truncate font-mono font-semibold text-slate-900 dark:text-white">{d.name || '(adsız)'}</h2>
        </div>
        {d.dbName && d.dbName !== d.name && <span className="chip bg-slate-100 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300" title="Veritabanı tablosu">{d.dbName}</span>}
        <span className="text-xs text-slate-500 tabular-nums">
          {d.rowCount.toLocaleString('tr-TR')} satır · {d.columns.length.toLocaleString('tr-TR')} kolon
          {d.activeRow > 0 && <> · aktif satır {d.activeRow}</>}
          {d.activeCol && <> · aktif kolon <span className="font-mono">{d.activeCol}</span></>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="btn-outline px-2.5 py-1 text-xs"
            onClick={exportCsv}
            title={`Aramaya uyan satırları görünen kolonlarla CSV olarak ${inHost() ? 'kaydeder ve açar' : 'indirir'}`}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <button
            className="btn-outline px-2.5 py-1 text-xs"
            onClick={exportXlsx}
            title={`Aramaya uyan satırları görünen kolonlarla Excel dosyası olarak ${inHost() ? 'kaydeder ve açar' : 'indirir'}; metin kolonları metin kalır`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </button>
          {st && (
            <button className="btn-ghost px-2 py-1 font-mono text-xs" onClick={() => nav.revealInTree(st.id)} title="Ağaçta göster">
              <GitBranch className="h-3.5 w-3.5" />
              {loc}
            </button>
          )}
          <button
            className="btn-ghost p-1.5"
            onClick={() => nav.openRaw(d.fileLine)}
            title={`${embedded ? 'Editörde göster' : 'Ham dosyada aç'} (${editorLine(parsed, d.fileLine).toLocaleString('tr-TR')}. satır)`}
            aria-label={embedded ? 'Editörde göster' : 'Ham dosyada aç'}
          >
            <FileText className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 ${embedded ? 'px-3 py-2' : 'px-4 py-2'}`}>
        <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700" role="group" aria-label="Görünüm">
          {(
            [
              ['table', Table2, 'Tablo'],
              ['record', Rows3, 'Kayıt'],
            ] as const
          ).map(([m, Icon, label]) => (
            <button
              key={m}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                mode === m ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={m === 'table' ? 'Satırlar alt alta, kolonlar yan yana' : 'Bir satırın kolonları alt alta'}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-40 min-w-32 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-8" placeholder="Kolon ara…" value={colQuery} onChange={(e) => setColQuery(e.target.value)} />
        </div>
        <div className="relative w-40 min-w-32 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-8" placeholder="Değer ara…" value={valQuery} onChange={(e) => setValQuery(e.target.value)} />
        </div>
        {stateCount > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 select-none dark:text-slate-300" title="INSERTED, DELETED, UPDATED... kolonları">
            <input type="checkbox" className="accent-brand-600" checked={showState} onChange={(e) => setShowState(e.target.checked)} />
            Durum kolonları ({stateCount})
          </label>
        )}
        <button
          className={`btn-outline px-2.5 py-1 text-xs ${copied ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
          onClick={copy}
          title="Görünen kolon ve satırları Excel'e yapıştırılabilir biçimde kopyalar"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
      </div>

      {d.cut && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Tablo çok büyük; ilk {d.rows.length.toLocaleString('tr-TR')} satır gösteriliyor.
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        {mode === 'table' ? (
          <table className="min-w-full border-separate border-spacing-0 font-mono text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 border-r border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-right font-sans text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                  #
                </th>
                {anyState && <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900" />}
                {cols.map((k) => {
                  const c = d.columns[k]
                  const active = activeCol && d.header[k].toUpperCase() === activeCol
                  return (
                    <th
                      key={k}
                      className={`sticky top-0 z-10 border-b border-slate-200 px-2 py-1.5 text-left font-semibold whitespace-nowrap dark:border-slate-800 ${
                        active ? 'bg-brand-100 text-brand-900 dark:bg-brand-900/50 dark:text-brand-200' : 'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-200'
                      } ${isNumeric(c) ? 'text-right' : ''}`}
                      title={c ? `${c.name} · ${typeLabel(c)}${c.writable ? '' : ' · salt okunur'}${c.deleted ? ' · silinmiş' : ''}` : `${d.header[k]} · satır durumu`}
                    >
                      <div>{d.header[k]}</div>
                      <div className="font-sans text-[10px] font-normal text-slate-400">{c ? typeLabel(c) : 'durum'}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((i) => {
                const active = numbers[i] === d.activeRow
                const state = states[i]
                return (
                  <tr key={i} className={`group ${state === 'deleted' ? 'text-slate-400 line-through dark:text-slate-500' : ''}`}>
                    <td
                      className={`sticky left-0 z-[5] border-r border-b border-slate-100 px-2 py-1 text-right font-sans text-[11px] tabular-nums dark:border-slate-800 ${
                        active ? 'bg-brand-100 font-semibold text-brand-900 dark:bg-brand-900/50 dark:text-brand-200' : 'bg-white text-slate-400 group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800'
                      }`}
                      title={active ? 'Aktif satır' : undefined}
                    >
                      {numbers[i]}
                    </td>
                    {anyState && (
                      <td className="border-b border-slate-100 px-2 py-1 group-hover:bg-slate-50 dark:border-slate-800 dark:group-hover:bg-slate-800/60">
                        {state && <span className={`chip font-sans no-underline ${STATE_META[state].cls}`}>{STATE_META[state].label}</span>}
                      </td>
                    )}
                    {cols.map((k) => {
                      const v = cells[i][k] ?? ''
                      return (
                        <td
                          key={k}
                          className={`border-b border-slate-100 px-2 py-1 whitespace-pre group-hover:bg-slate-50 dark:border-slate-800 dark:group-hover:bg-slate-800/60 ${
                            isNumeric(d.columns[k]) ? 'text-right tabular-nums' : ''
                          } ${active ? 'bg-brand-50/60 dark:bg-brand-900/20' : ''}`}
                        >
                          {v}
                          {cellCut(d, k, v) && (
                            <span className="text-amber-600 dark:text-amber-400" title={CUT_TITLE}>
                              …
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 2} className="px-4 py-6 text-center font-sans text-sm text-slate-500">
                    {d.rows.length === 0 ? 'Tablo boş.' : 'Aramaya uyan satır yok.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <RecordTable dump={d} cols={cols} cells={cells[record]} valQuery={valQuery} activeCol={activeCol} />
        )}
        {mode === 'table' && rows.length > limit && (
          <div className="p-3 text-center">
            <button className="btn-outline px-3 py-1 text-xs" onClick={() => setLimit((l) => l + PAGE * 3)}>
              {Math.min(PAGE * 3, rows.length - limit).toLocaleString('tr-TR')} satır daha göster ({(rows.length - limit).toLocaleString('tr-TR')} kaldı)
            </button>
          </div>
        )}
      </div>

      {mode === 'record' && d.rows.length > 1 && (
        <div className="flex items-center justify-center gap-2 border-t border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
          <button className="btn-ghost p-1" onClick={() => setRecord((r) => Math.max(0, r - 1))} disabled={record === 0} aria-label="Önceki satır">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex items-center gap-1.5 tabular-nums text-slate-600 dark:text-slate-300">
            Satır
            <RowInput
              value={numbers[record]}
              max={d.rows.length}
              onGo={(n) => {
                // The printed row number; its position when the rows are numbered without gaps
                const i = numbers.indexOf(n)
                setRecord(i >= 0 ? i : Math.max(0, Math.min(d.rows.length - 1, n - 1)))
              }}
            />
            / {d.rows.length}
            {numbers[record] === d.activeRow && <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300">aktif</span>}
          </span>
          <button className="btn-ghost p-1" onClick={() => setRecord((r) => Math.min(d.rows.length - 1, r + 1))} disabled={record >= d.rows.length - 1} aria-label="Sonraki satır">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

/** The shown row number; typing another and pressing Enter (or leaving the box) goes to it, Escape gives up */
function RowInput({ value, max, onGo }: { value: number; max: number; onGo: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  // Escape blurs the box; the blur must not go to the typed row
  const cancelled = useRef(false)
  const go = () => {
    const n = parseInt(draft ?? '', 10)
    if (n > 0 && !cancelled.current) onGo(Math.min(n, max))
    cancelled.current = false
    setDraft(null)
  }
  return (
    <input
      className="input w-auto px-1.5 py-0.5 text-center text-xs tabular-nums"
      style={{ width: `${String(max).length + 2.5}ch` }}
      inputMode="numeric"
      aria-label="Satır numarası"
      title="Satır numarasını yazıp Enter'a basın"
      value={draft ?? String(value)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter') go()
        else if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** One row with its columns listed down: suits wide tables with a single row */
function RecordTable({
  dump: d,
  cols,
  cells,
  valQuery,
  activeCol,
}: {
  dump: TraceDump
  cols: number[]
  /** Undefined for an empty table: the columns are listed without values */
  cells: string[] | undefined
  valQuery: string
  activeCol: string
}) {
  const q = valQuery.trim().toLocaleLowerCase('tr-TR')
  const shown = q && cells ? cols.filter((k) => (cells[k] ?? '').toLocaleLowerCase('tr-TR').includes(q)) : cols
  return (
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr>
          {['#', 'Kolon', 'Tip', cells ? 'Değer' : ''].map((h, i) => (
            <th
              key={i}
              className={`sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 ${
                i === 0 ? 'w-10 text-right' : i === 3 ? 'w-full' : ''
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {!cells && (
          <tr>
            <td colSpan={4} className="border-b border-slate-100 px-3 py-2 text-slate-500 dark:border-slate-800">
              Tablo boş; yalnızca kolonları listeleniyor.
            </td>
          </tr>
        )}
        {shown.map((k) => {
          const c = d.columns[k]
          const v = cells?.[k] ?? ''
          const active = activeCol && d.header[k].toUpperCase() === activeCol
          return (
            <tr key={k} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${active ? 'bg-brand-50 dark:bg-brand-900/30' : ''}`}>
              <td className="border-b border-slate-100 px-3 py-1 text-right tabular-nums text-slate-400 dark:border-slate-800">{c ? c.index : ''}</td>
              <td className="border-b border-slate-100 px-3 py-1 font-mono font-medium whitespace-nowrap text-slate-900 dark:border-slate-800 dark:text-white">
                {d.header[k]}
                {active && <span className="ml-1.5 chip bg-brand-100 font-sans text-brand-800 dark:bg-brand-500/15 dark:text-brand-300">aktif</span>}
              </td>
              <td className="border-b border-slate-100 px-3 py-1 font-mono whitespace-nowrap text-slate-500 dark:border-slate-800" title={c && !c.writable ? 'Salt okunur' : undefined}>
                {c ? typeLabel(c) : 'durum'}
                {c && !c.writable && <span className="ml-1 text-slate-400">RO</span>}
              </td>
              <td className={`border-b border-slate-100 px-3 py-1 font-mono whitespace-pre-wrap break-all dark:border-slate-800 ${isNumeric(c) ? 'tabular-nums' : ''}`}>
                {v}
                {cells && cellCut(d, k, v) && (
                  <span className="text-amber-600 dark:text-amber-400" title={CUT_TITLE}>
                    …
                  </span>
                )}
              </td>
            </tr>
          )
        })}
        {cells && shown.length === 0 && (
          <tr>
            <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
              Aramaya uyan kolon yok.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
