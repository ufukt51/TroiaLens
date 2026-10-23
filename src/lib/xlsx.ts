/**
 * A single sheet .xlsx without a library: the workbook's XML parts in a zip, compressed with the browser's
 * CompressionStream. The first row is the header: bold, with an auto filter, and frozen above the rest.
 */

/**
 * text stays as written ("00" stays "00"); number and date fall back to text when the value does not parse.
 * A date shows with its time only when the value has one.
 */
export type CellKind = 'text' | 'number' | 'date'

/** Style indexes in STYLES' cellXfs */
const STYLE = { header: 1, date: 2, datetime: 3, text: 4 }

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm:ss"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

/** A plain number as the trace prints it; Excel keeps 15 digits, so longer ones stay text */
const NUMBER = /^-?\d+(\.\d+)?$/
/** "31.07.2026" or "31.07.2026 14:05:09" */
const DATE = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** Characters XML 1.0 cannot hold */
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

function xml(s: string): string {
  return s.replace(INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 0 -> A, 25 -> Z, 26 -> AA */
function column(k: number): string {
  let s = ''
  for (k++; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s
  return s
}

/** Excel's serial day number (1900 system), or null when the date is not real or falls before 1 March 1900 */
function serial(m: RegExpMatchArray): number | null {
  const [day, month, year, h, min, sec] = [1, 2, 3, 4, 5, 6].map((i) => +(m[i] ?? 0))
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  if (back.getUTCDate() !== day || back.getUTCMonth() !== month - 1 || ms < Date.UTC(1900, 2, 1) || h > 23 || min > 59 || sec > 59) return null
  return ms / 86400000 + 25569 + (h * 3600 + min * 60 + sec) / 86400
}

function cell(ref: string, kind: CellKind, value: string): string {
  if (!value) return ''
  if (kind === 'number' && NUMBER.test(value) && value.replace(/\D/g, '').replace(/^0+/, '').length <= 15) return `<c r="${ref}"><v>${value}</v></c>`
  if (kind === 'date') {
    const m = DATE.exec(value)
    const n = m && serial(m)
    if (n !== null) return `<c r="${ref}" s="${m![4] === undefined ? STYLE.date : STYLE.datetime}"><v>${n}</v></c>`
  }
  const space = value !== value.trim() ? ' xml:space="preserve"' : ''
  return `<c r="${ref}" t="inlineStr" s="${STYLE.text}"><is><t${space}>${xml(value)}</t></is></c>`
}

/** A sheet name Excel takes: no []:*?/\, at most 31 characters */
function sheetName(s: string): string {
  return s.replace(/[[\]:*?/\\]/g, '_').slice(0, 31).replace(/^'+|'+$/g, '') || 'Sayfa1'
}

function sheet(header: string[], kinds: CellKind[], rows: string[][]): string {
  const last = `${column(Math.max(header.length - 1, 0))}${rows.length + 1}`
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${last}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>`,
  ]
  if (header.length) {
    // Wide enough for the header and the longest value (dates show in full instead of ####), within reason
    out.push('<cols>')
    header.forEach((h, k) => {
      let w = h.length + 3 // the filter button
      for (const r of rows) w = Math.max(w, (r[k] ?? '').length + 1)
      out.push(`<col min="${k + 1}" max="${k + 1}" width="${Math.min(w, 60) + 1}" customWidth="1"/>`)
    })
    out.push('</cols>')
  }
  out.push('<sheetData>')
  out.push(`<row r="1">${header.map((h, k) => `<c r="${column(k)}1" t="inlineStr" s="${STYLE.header}"><is><t>${xml(h)}</t></is></c>`).join('')}</row>`)
  rows.forEach((r, i) => {
    const n = i + 2
    out.push(`<row r="${n}">${header.map((_, k) => cell(`${column(k)}${n}`, kinds[k] ?? 'text', r[k] ?? '')).join('')}</row>`)
  })
  out.push('</sheetData>')
  if (header.length) out.push(`<autoFilter ref="A1:${last}"/>`)
  out.push('</worksheet>')
  return out.join('\n')
}

function workbook(name: string, filter: string | null): string {
  const quoted = `'${name.replace(/'/g, "''")}'`
  const names = filter ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xml(quoted)}!${filter}</definedName></definedNames>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>${names}
</workbook>`
}

/** One sheet: header in row 1, then rows; each column's cells written as its kind */
export async function toXlsx(name: string, header: string[], kinds: CellKind[], rows: string[][]): Promise<Uint8Array> {
  const title = sheetName(name)
  const lastCol = column(Math.max(header.length - 1, 0))
  const filter = header.length ? `$A$1:$${lastCol}$${rows.length + 1}` : null
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', workbook(title, filter)],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheet(header, kinds, rows)],
  ])
}

// ---- Zip ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Raw deflate, or null where the browser has no CompressionStream (the file is then stored) */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function zip(files: [string, string][]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [path, text] of files) {
    const name = enc.encode(path)
    const raw = enc.encode(text)
    const packed = await deflate(raw)
    const body = packed ?? raw
    const crc = crc32(raw)
    // Version 2.0, UTF-8 names, deflate (8) or stored (0), DOS time 0:00 of 1 Jan 1980
    const fields = (h: DataView, at: number) => {
      h.setUint16(at, 20, true)
      h.setUint16(at + 2, 0x0800, true)
      h.setUint16(at + 4, packed ? 8 : 0, true)
      h.setUint16(at + 6, 0, true)
      h.setUint16(at + 8, 0x21, true)
      h.setUint32(at + 10, crc, true)
      h.setUint32(at + 14, body.length, true)
      h.setUint32(at + 18, raw.length, true)
      h.setUint16(at + 22, name.length, true)
    }
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    fields(lv, 4)
    local.set(name, 30)
    const entry = new Uint8Array(46 + name.length)
    const ev = new DataView(entry.buffer)
    ev.setUint32(0, 0x02014b50, true)
    ev.setUint16(4, 20, true)
    fields(ev, 6)
    ev.setUint32(42, offset, true)
    entry.set(name, 46)
    parts.push(local, body)
    central.push(entry)
    offset += local.length + body.length
  }
  const size = central.reduce((n, e) => n + e.length, 0)
  const end = new Uint8Array(22)
  const dv = new DataView(end.buffer)
  dv.setUint32(0, 0x06054b50, true)
  dv.setUint16(8, files.length, true)
  dv.setUint16(10, files.length, true)
  dv.setUint32(12, size, true)
  dv.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + end.length)
  let at = 0
  for (const p of [...parts, ...central, end]) {
    out.set(p, at)
    at += p.length
  }
  return out
}
