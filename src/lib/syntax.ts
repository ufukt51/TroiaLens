/**
 * Syntax colouring of trace text. A port of the reference implementation (ref-syntax.mjs) that the Notepad++
 * plugin carries too: the three must colour a line the same way, scripts/syntax-check.ts holds them to it.
 * Output is UTF-16 offsets: colour spans that do not overlap (sorted by start for a line), wavy-underline spans
 * that leave the text colour alone, and a flag that gives the whole line the error background.
 * Only text colour changes (no bold or italics), so characters keep their width.
 */

export type SynClass = 'hata' | 'sql' | 'anahtar' | 'tanim' | 'metod' | 'sinif' | 'param' | 'deger' | 'sonuk' | 't200' | 't1000'
export type ColorSpan = [number, number, SynClass]
export type DecoSpan = [number, number]
export type LineTokens = { color: ColorSpan[]; deco: DecoSpan[]; band: boolean }

/** Only the first characters of a line are coloured */
export const MAX_LINE = 4096

export const CTRL = new Set(
  (
    'IF THEN ELSE ENDIF LOOP AT WHILE BEGIN SWITCH CASE RETURN BREAK CONTINUE PARSE FOR WHERE INTO TO WITH ' +
    'WITHFLAGS DELIMITER THIS SUPER MOVE APPEND APPENDSTRING LOCATERECORD COPY CLEAR CLEARTABLE SORT DUMP AGGREGATE REMOVE ADDELEMENT READ ' +
    'RUNCODE BEGINTRAN COMMITTRAN ROLLBACKTRAN ROLLBACK ENQUE DEQUE CALL DIALOG MESSAGE TRACEON TRACEOFF TRACEPAUSE SET SHUTDOWN TABLE ' +
    'SEQUENTIAL COLUMNS VALUES ON INDEXED INDEX DELETEFILE'
  ).split(' '),
)
export const SQLK = new Set(
  (
    'SELECT DISTINCT TOP FROM WHERE AND OR NOT IN LIKE BETWEEN IS NULL INNER LEFT RIGHT OUTER CROSS JOIN ON AS ' +
    'ORDER GROUP BY HAVING INTO VALUES SET UPDATE DELETE INSERT UNION ALL EXISTS CASE WHEN THEN ELSE END ASC DESC COUNT SUM MAX MIN AVG'
  ).split(' '),
)
/** In SQL the word after these is a table */
const TABLE_AFTER = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE'])
const TYPES = 'STRING|INTEGER|DECIMAL|DATETIME|DATE|TIME|TABLE|VECTOR|LONG|STRINGBUILDER'

const CODE_RE = new RegExp(
  `('(?:[^']|'')*')` + // 1 string
    `|\\b([A-Za-z_][\\w$]*)\\.([A-Za-z_][\\w$]*)(?=\\s*\\()` + // 2,3 OBJECT.METHOD(
    `|(OBJECT:|LOCAL:|\\bPARAMETERS\\b)` + // 4 declaration
    `|\\b(${TYPES})(\\s+)([A-Za-z_@][\\w@]*)(?=\\s*[,;])` + // 5,6,7 TYPE name
    `|\\b(CLASS\\[[\\w.]+\\])(\\s+)([A-Za-z_@][\\w@]*)` + // 8,9,10 CLASS[X] name
    `|\\b([A-Za-z_][\\w$]*)\\b` + // 11 word
    `|\\b(\\d+(?:\\.\\d+)?)\\b` + // 12 number
    `|([▎▏])`, // 13 scope mark
  'gd',
)
const TRAIL_RE = /([A-Za-z_@][\w.@]*)?\[([^\[\]]*)\]|->\s*([01])(?=\s*(?:,|$|[▎▏]))|([▎▏])/dg

/** Group offsets of a match made with the d flag; only groups that took part are read */
const idx = (m: RegExpMatchArray | RegExpExecArray) => m.indices as unknown as [number, number][]

class Out {
  color: ColorSpan[] = []
  deco: DecoSpan[] = []
  band = false
  c(s: number, e: number, k: SynClass | null) {
    if (k && e > s) this.color.push([s, e, k])
  }
  d(s: number, e: number) {
    if (e > s) this.deco.push([s, e])
  }
}

/** Code part of a statement (before its ' : '); base is where it starts in the line */
function code(o: Out, str: string, base: number, sql: boolean) {
  CODE_RE.lastIndex = 0
  let tbl = false
  for (let m = CODE_RE.exec(str); m; m = CODE_RE.exec(str)) {
    const ix = idx(m)
    const I = (i: number) => base + ix[i][0]
    const E = (i: number) => base + ix[i][1]
    if (m[1]) o.c(I(1), E(1), 'deger')
    else if (m[2]) {
      o.c(I(2), E(2), m[2] === 'THIS' || m[2] === 'SUPER' ? 'anahtar' : 'sinif')
      o.c(I(3), E(3), 'metod')
    } else if (m[4]) o.c(I(4), E(4), 'tanim')
    else if (m[5]) {
      o.c(I(5), E(5), 'sinif')
      o.c(I(7), E(7), 'param')
    } else if (m[8]) {
      o.c(I(8), E(8), 'sinif')
      o.c(I(10), E(10), 'param')
    } else if (m[11]) {
      const w = m[11]
      if (sql) {
        if (tbl && !SQLK.has(w)) o.c(I(11), E(11), 'sinif')
        else if (SQLK.has(w)) o.c(I(11), E(11), 'sql')
        tbl = TABLE_AFTER.has(w)
        continue
      }
      if (CTRL.has(w)) o.c(I(11), E(11), 'anahtar')
    } else if (m[12]) o.c(I(12), E(12), 'deger')
    else if (m[13]) o.c(I(13), E(13), 'sonuk')
    if (sql && !m[11]) tbl = false
  }
}

/** Evaluation (trail) and NAME[value] lists */
function trail(o: Out, str: string, base: number) {
  TRAIL_RE.lastIndex = 0
  for (let m = TRAIL_RE.exec(str); m; m = TRAIL_RE.exec(str)) {
    const ix = idx(m)
    const I = (i: number) => base + ix[i][0]
    const E = (i: number) => base + ix[i][1]
    if (m[4]) {
      o.c(I(4), E(4), 'sonuk')
      continue
    }
    if (m[3]) {
      o.c(base + m.index, E(3), m[3] === '1' ? 'sinif' : 'sonuk')
      continue
    }
    o.c(I(2), E(2), 'deger')
    if (m[1] === 'SYS_STATUS' && /^[1-9]/.test(m[2])) o.d(base + m.index, base + TRAIL_RE.lastIndex)
  }
}

/** "[N ms]" before a statement: dim, amber from 200 ms, red from a second */
function time(o: Out, str: string, base: number) {
  const b = str.indexOf('[')
  const e = str.lastIndexOf(']') + 1
  const m = str.match(/\[\s*(\d+)\s*(ms|sec|min)/)
  let k: SynClass | null = 'sonuk'
  if (m) {
    const n = +m[1]
    k = m[2] !== 'ms' || n >= 1000 ? 't1000' : n >= 200 ? 't200' : n === 0 ? 'sonuk' : null
  }
  o.c(base + b, base + e, k)
}

const SCOPE_RE = /^(\s*)(\([^)]*\)\s*)?([\w$]+)\.([\w$]+)(\.\d+)$/d
const STMT_RE = /^(\s*\[[^\]]*\])?(\s+)(\[(?:\([\w.]+\)\s+)?[\w$]+\.)([\w$]+)(\.\d+ \d+\])( : )(.*)$/d
const ASSIGN_RE = /^([\w.@]+)(\s*=)(?!=)(\s*.*?;)(\s*)(\[.*\])?$/d
const SQL_START = /^(SELECT|INSERT\s+INTO|UPDATE|DELETE)\b/
const SQL_CONT = /^\t+\s*(?:FROM|WHERE|AND|OR|SET|INTO|VALUES|HAVING|JOIN|ORDER\s+BY|GROUP\s+BY|(?:INNER|LEFT|RIGHT|OUTER|CROSS)\s+JOIN)\b/
const BLOCK_RE =
  /^\t(?:[+-](?:TRUE|ELSE) BLOCK (?:STARTED|ENDED)|\+CASE\s*:\s*\S*|-?END(?:LOOP|WHILE|SWITCH|PARSE|FOR)|[+-](?:START|END) ITERATION\{\d+\}|\+ACTIVE ROW:\s*\d+\s+at\s+\S+|> CONDITION:|PARSE \d+\. ELEMENT OF\b)/

const isMark = (ch: string) => ch === '▎' || ch === '▏'

/** Colours one line of a trace file as it was written */
export function tokenizeLine(full: string): LineTokens {
  const o = new Out()
  // A bare CR (multi-line SQL source) counts as a space; JS '.' does not match it
  const line = (full.length > MAX_LINE ? full.slice(0, MAX_LINE) : full).replace(/\r/g, ' ')
  // Scope marks and blanks at the end
  const cut = line.match(/(?:\s*[▎▏])*\s*$/)!.index!
  const body = line.slice(0, cut)
  const tail = () => {
    for (let i = cut; i < line.length; i++) if (isMark(line[i])) o.c(i, i + 1, 'sonuk')
  }
  let m: RegExpMatchArray | null

  if (
    /^TROIA CODE EXECUTION TRACE\b/.test(body) ||
    /^(?:(?:TRACE|LOGIN|GENERAL) INFORMATION|(?:DIALOG|CLASS) CROSS REFERENCES)\s*$/.test(body)
  ) {
    o.c(0, body.trimEnd().length, 'anahtar')
    tail()
  } else if (/^-{10,}\s*$/.test(body)) {
    o.c(0, body.length, 'sonuk')
    tail()
  } else if ((m = body.match(/^([A-Za-z][\w ./]*?)(\s*:\s*)\[(.*)\](\s*)$/d))) {
    o.c(...idx(m)[1], 'sonuk')
    o.c(...idx(m)[3], 'deger')
  } else if ((m = body.match(/^(\S+)(\s*->\s*)(\S+?)(,\s*\(SYS\w*REF\))\s*$/d))) {
    o.c(...idx(m)[1], 'sonuk')
    o.c(...idx(m)[3], 'sinif')
    o.c(...idx(m)[4], 'sonuk')
  } else if (/^\[Old (?:Dialog|Class)\]\s*->\s*\[New (?:Dialog|Class)\]/.test(body)) o.c(0, body.trimEnd().length, 'sonuk')
  else if ((m = body.match(SCOPE_RE)) && line.slice(cut).includes('▎')) {
    const ix = idx(m)
    if (m[2]) o.c(ix[2][0], ix[2][0] + m[2].trimEnd().length, 'sinif')
    o.c(...ix[3], 'sinif')
    o.c(...ix[4], 'metod')
    o.c(...ix[5], 'sonuk')
    tail()
  } else if ((m = body.match(STMT_RE))) {
    const ix = idx(m)
    if (m[1]) time(o, m[1], 0)
    o.c(...ix[3], 'sonuk')
    o.c(...ix[4], 'metod')
    o.c(...ix[5], 'sonuk')
    const rs = ix[7][0]
    const rest = m[7]
    let a: RegExpMatchArray | null
    if ((a = rest.match(/^MESSAGE\s+\w+\s+([EWIQSC])\d+/))) {
      const i = rest.indexOf(' : ')
      const head = i >= 0 ? rest.slice(0, i) : rest
      if (a[1] === 'E') {
        o.band = true
        o.c(rs, rs + rest.length, 'hata')
      } else {
        code(o, head, rs, false)
        if (a[1] === 'W') o.d(rs, rs + head.trimEnd().length)
        if (i >= 0) trail(o, rest.slice(i), rs + i)
      }
    } else if ((a = rest.match(ASSIGN_RE))) {
      const ax = idx(a)
      o.c(rs + ax[1][0], rs + ax[1][1], 'param')
      code(o, a[3], rs + ax[3][0], false)
      if (a[5]) o.c(rs + ax[5][0] + 1, rs + ax[5][1] - 1, 'deger')
    } else {
      const i = rest.indexOf(' : ')
      const c = i >= 0 ? rest.slice(0, i) : rest
      code(o, c, rs, SQL_START.test(c))
      if (i >= 0) trail(o, rest.slice(i), rs + i)
    }
    tail()
  } else if (/^\tErrors?\s*:/.test(body) || /^\t\t\s*\*/.test(body)) {
    o.band = true
    o.c(body.search(/\S/), body.trimEnd().length, 'hata')
    tail()
  } else if (/^\tWarnings?\s*:/.test(body)) {
    o.d(1, body.trimEnd().length)
    tail()
  } else if ((m = line.match(/^\t(->DB)( CACHE)?(\s*\[)(.*?)(\]?)((?:\s*[▎▏])*\s*)$/d))) {
    const ix = idx(m)
    o.c(...ix[1], 'sql')
    if (m[2]) o.c(ix[2][0] + 1, ix[2][1], 'sonuk')
    if (m[4]) code(o, m[4], ix[4][0], true)
    else o.d(ix[1][0], ix[5][1])
    for (let i = ix[6][0]; i < line.length; i++) if (isMark(line[i])) o.c(i, i + 1, 'sonuk')
  } else if ((m = body.match(/^\t([\w@]+)\[([^\]]*)\](\s*<=\s*)(\?\?\?\s*!!Missing Parameter!!)/d))) {
    const ix = idx(m)
    o.c(...ix[1], 'param')
    o.c(...ix[2], 'deger')
    o.c(...ix[3], 'sonuk')
    o.d(...ix[4])
    tail()
  } else if ((m = body.match(/^\t([\w@]+)\[(.*?)\](\s*<=\s*)(.*)$/d))) {
    const ix = idx(m)
    o.c(...ix[1], 'param')
    o.c(...ix[2], 'deger')
    o.c(...ix[3], 'sonuk')
    trail(o, m[4], ix[4][0])
    tail()
  } else if ((m = body.match(BLOCK_RE))) {
    o.c(1, m[0].length, 'sonuk')
    trail(o, body.slice(m[0].length), m[0].length)
    tail()
  } else if ((m = body.match(/^\t\[(Number of rows|AFFECTED ROW COUNT)(\s*:\s*)(\d+)\]/d))) {
    const ix = idx(m)
    o.c(1, ix[2][1], 'sonuk')
    o.c(...ix[3], 'deger')
    tail()
  } else if (/^\t\[(?:SELECTED|NOTSELECTED|SYS_AFFECTEDROWCOUNT|DELETED)\[/.test(body)) {
    trail(o, body, 0)
    tail()
  } else if ((m = body.match(/^\t(CHANGED COLUMNS:)(.*)$/d))) {
    const ix = idx(m)
    o.c(...ix[1], 'sonuk')
    trail(o, m[2], ix[2][0])
    tail()
  } else if (SQL_CONT.test(body)) {
    code(o, body, 0, true)
    tail()
  } else if (/^\t+\s*(?:&&|\|\|)/.test(body)) {
    code(o, body, 0, false)
    tail()
  } else if ((m = body.match(/^\t([A-Z_][A-Z0-9_]*):(\S*)\s*$/d))) {
    o.c(...idx(m)[1], 'param')
    o.c(...idx(m)[2], 'deger')
    tail()
  }
  // Anything else (HTML, message text, continuation lines) stays plain
  o.color.sort((a, b) => a[0] - b[0])
  return { color: o.color, deco: o.deco, band: o.band }
}

/** Code alone, without a line's prefix (call tree, statement detail, SQL view) */
export function tokenizeCode(str: string, sql: boolean = SQL_START.test(str.trimStart())): ColorSpan[] {
  const o = new Out()
  code(o, str, 0, sql)
  return o.color
}

/** An evaluation (the part after a statement's ' : ') alone */
export function tokenizeTrail(str: string): { color: ColorSpan[]; deco: DecoSpan[] } {
  const o = new Out()
  trail(o, str, 0)
  return { color: o.color, deco: o.deco }
}
