import type { CrossRef, MessageInfo, ParsedTrace, Scope, SqlInfo, Statement, StmtKind, TraceDump, TraceIssue, TraceMeta } from './types.ts'

const CLOSE = '▏' // ▏ scope end marker (▎ opens a scope)

const STMT_RE = /^\s*\[(\d+(?:[.,]\d+)?)\s*(ms|msec|sec|s|min|us|µs)\]\s*\[(.+?)\s+(\d+)\]\s*:\s?(.*)$/i
const SCOPE_RE = /^\s*(\S.*?)\s*▎\s*$/
const FIELD_RE = /^(.+?)\s*:\s*\[(.*)\]\s*$/
const XREF_RE = /^(\S+)\s*->\s*(\S+?),?\s*\((\w+)\)/
const SEPARATOR_END_RE = /^-{10,}\s*▏/
const BLOCK_END_RE = /^(-(TRUE|ELSE) BLOCK ENDED|-?ENDLOOP|-?ENDWHILE|-?ENDFOR|-?ENDSWITCH|-?ENDPARSE)/i
const DB_RE = /^->\s*DB(\s+CACHE)?\s*\[(.*)\]\s*$/is
// Printed by the runtime in this exact casing; upper case "NAME:value" lines are column values
const ISSUE_RE = /^(Errors?|Warnings?)\s*:\s?(.*)$/
const MISSING_RE = /^(.*?)\s*<=\s*\?\?\?\s*!!Missing Parameter!!/i
/** "SET command could not find control:X" is printed before the SET statement it belongs to */
const COMMAND_RE = /^(\w+)\s+command\b/i
/** DUMP prints the table after its statement: "OBJECT DUMP { Name: X, ..." up to a "] }" line */
const DUMP_RE = /^OBJECT DUMP\s*\{\s*(.*)$/
const DUMP_END_RE = /^\]\s*\}/

// UPDATE / DELETE source may break right after the verb or table name; the rest follows on tab lines
const SQL_RE =
  /^(SELECT\b|INSERT\s+INTO\b|UPDATE\s+[\w.]+\s+SET\b|UPDATE\s+[\w.]+\s*$|DELETE\s+FROM\b|DELETE\s+\w+\s+WHERE\b|DELETE\s*$|TRUNCATE\b|MERGE\b|EXEC(UTE)?\s+(SQL|PROC|PROCEDURE)?\b|SQLEXEC\b|EXECSQL\b|CALL\s+\w+\s*\()/i
const TABLE_RE =
  /^(LOCATERECORD|APPEND|CLEARTABLE|MOVE|DELETEROW|INSERTROW|DELETE\s+ROW|SORTTABLE|SORT\s|COPYTABLE|COPY\s|FILTERTABLE|GROUPBY|SUM\s|CREATETABLE|ADDCOLUMN|COLLAPSE|TBLMOVEFIELDS)/i

function toMs(value: string, unit: string): number {
  const n = parseFloat(value.replace(',', '.'))
  switch (unit.toLowerCase()) {
    case 'sec':
    case 's':
      return n * 1000
    case 'min':
      return n * 60000
    case 'us':
    case 'µs':
      return n / 1000
    default:
      return n
  }
}

function countMarks(line: string): number {
  let n = 0
  for (let i = line.indexOf(CLOSE); i !== -1; i = line.indexOf(CLOSE, i + 1)) n++
  return n
}

export function classify(code: string): StmtKind {
  const c = code.trimStart()
  if (/^IF\b/i.test(c)) return 'if'
  if (/^LOOP\b/i.test(c) || /^FOR\b/i.test(c)) return 'loop'
  if (/^WHILE\b/i.test(c)) return 'while'
  if (/^RETURN\b/i.test(c)) return 'return'
  if (/^OBJECT\s*:/i.test(c)) return 'object'
  if (/^MESSAGE\b/i.test(c)) return 'message'
  if (/^SWITCH\b/i.test(c)) return 'switch'
  if (/^PARAMETERS\b/i.test(c)) return 'params'
  if (SQL_RE.test(c)) return 'sql'
  if (TABLE_RE.test(c)) return 'table'
  if (/^[\w.]+\s*=(?!=)/.test(c)) return 'assign'
  if (/^(THIS\.)?[\w.]+\s*\(.*\)\s*;?\s*$/i.test(c)) return 'call'
  return 'other'
}

/** Replaces literal and resolved values so that repeated executions of one query collapse into one key. */
export function normalizeSql(code: string): string {
  return code
    .replace(/:\s*TOTAL\s+\d+\s+ROWS?.*$/i, '')
    .replace(/\(\s*\d+\s+row\(s\).*?\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/(?<![\w.])-?\d+(\.\d+)?(?![\w.])/g, '?')
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*$/, '')
    .trim()
    .toUpperCase()
}

function sqlVerb(sql: string): string {
  return (sql.trim().match(/^\w+/)?.[0] ?? 'SQL').toUpperCase()
}

/** Procedure calls and the like may send other text to the database; only clear CRUD mismatches count */
function sameVerb(a: string, b: string): boolean {
  const crud = /^(SELECT|INSERT|UPDATE|DELETE)$/
  return a === b || !crud.test(a) || !crud.test(b)
}

function sqlInfo(code: string, trail: string): SqlInfo {
  const verb = sqlVerb(code)
  const tables = new Set<string>()
  // INTO of a SELECT names the in-memory TROIA table, not a database table
  const re = verb === 'SELECT' ? /\b(?:FROM|JOIN)\s+([A-Z_][\w.]*)/gi : /\b(?:FROM|JOIN|INTO|UPDATE)\s+([A-Z_][\w.]*)/gi
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const t = m[1].toUpperCase()
    if (t !== 'SELECT' && t !== 'SET') tables.add(t)
  }
  // Comma separated table lists: FROM A T1, B T2
  const from = code.match(/\bFROM\s+(.+?)(?:\bWHERE\b|\bORDER\s*BY\b|\bGROUP\s*BY\b|$)/is)
  if (from && from[1].includes(',') && !/\bJOIN\b/i.test(from[1])) {
    for (const part of from[1].split(',')) {
      const t = part.trim().split(/\s+/)[0]
      if (/^[A-Z_][\w.]*$/i.test(t)) tables.add(t.toUpperCase())
    }
  }
  const rowsM = (code + ' ' + trail).match(/TOTAL\s+(\d+)\s+ROWS?|(\d+)\s+row\(s\)/i)
  const rows = rowsM ? parseInt(rowsM[1] ?? rowsM[2], 10) : undefined
  return { verb, tables: [...tables], normalized: normalizeSql(code), rows }
}

function messageInfo(code: string, trail: string): MessageInfo | undefined {
  const m = code.match(/^MESSAGE\s+(\w+)\s+([A-Z])(\d+)/i)
  if (!m) return undefined
  const idx = trail.lastIndexOf('MSG[')
  let text = ''
  if (idx >= 0) {
    text = trail.slice(idx + 4)
    if (text.endsWith(']')) text = text.slice(0, -1)
  } else {
    const w = code.match(/WITH\s+(.*)$/is)
    text = w ? w[1] : ''
  }
  return { module: m[1].toUpperCase(), type: m[2].toUpperCase(), number: m[3], text: text.trim() }
}

function scopeLabel(name: string): { label: string; owner: string } {
  // "(CLASS.BASE) OBJECT.METHOD.N"  or  "DIALOG.EVENT.N"
  const cls = name.match(/^\(([^)]*)\)\s*(.*)$/)
  const rest = cls ? cls[2] : name
  const parts = rest.split('.')
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) parts.pop()
  const label = parts.length > 1 ? parts.slice(1).join('.') : parts[0]
  const owner = cls ? cls[1].split('.')[0] : parts[0]
  return { label: label || name, owner: owner || '' }
}

function parseHeader(lines: string[], end: number): TraceMeta {
  const meta: TraceMeta = { title: '', sections: [], dialogRefs: [], classRefs: [] }
  let section: { name: string; fields: [string, string][] } | null = null
  let refs: CrossRef[] | null = null
  for (let i = 0; i < end; i++) {
    const line = lines[i].replace(/[▎▏]/g, '').trim()
    if (!line || /^-{5,}$/.test(line)) continue
    if (!meta.title && i < 3 && !line.includes(':')) {
      meta.title = line
      continue
    }
    if (/^\[.*\]\s*->\s*\[.*\]$/.test(line)) continue
    const x = line.match(XREF_RE)
    if (x && refs) {
      refs.push({ from: x[1], to: x[2], kind: x[3] })
      continue
    }
    const f = line.match(FIELD_RE)
    if (f && section) {
      section.fields.push([f[1].trim(), f[2].trim()])
      continue
    }
    if (/^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ \-/]+$/.test(line)) {
      if (/DIALOG.*CROSS/.test(line)) refs = meta.dialogRefs
      else if (/CLASS.*CROSS/.test(line)) refs = meta.classRefs
      else refs = null
      if (!refs) {
        section = { name: line, fields: [] }
        meta.sections.push(section)
      } else section = null
    }
  }
  meta.sections = meta.sections.filter((s) => s.fields.length > 0)
  return meta
}

interface Block {
  /** 'parse' (PARSE ... BEGIN) iterates too, but its statements do not count as running in a loop */
  type: 'if' | 'loop' | 'switch' | 'parse'
  stmtId: number
}

interface OpenDump {
  dump: TraceDump
  /** Where in the dump the next line is: before or between the lists, column list, row header, rows */
  part: 'head' | 'columns' | 'header' | 'rows'
}

/**
 * Cells are printed in fixed width columns after the row number ("1.", "10."), which the header line leaves
 * blank: the header gives both widths and the cell names.
 */
function dumpLayout(d: TraceDump, header: string) {
  const end = header.trimEnd().length
  const prefix = header.length - header.trimStart().length
  let width = 0
  let prev = -1
  // Names longer than a cell run into the next one; the closest two starts are one cell apart
  for (const m of header.matchAll(/\S+/g)) {
    if (prev >= 0 && (!width || m.index - prev < width)) width = m.index - prev
    prev = m.index
  }
  if (!width) width = Math.max(1, end - prefix)
  d.prefix = prefix
  d.width = width
  for (let k = 0; prefix + k * width < end; k++) d.header.push(d.columns[k]?.name ?? own(header.slice(prefix + k * width, prefix + (k + 1) * width).trim()))
}

interface OpenScope {
  scope: Scope
  blocks: Block[]
}

/** Statement text kept in the result; a longer one is cut (the file still has all of it) */
export const TEXT_CAP = 4000
/** SQL is read in the detail pane and grouped by its text, so it keeps more */
export const SQL_CAP = 16000
/** Longer lines are cut on input; nothing past their beginning matters to the parser */
const LINE_CAP = 65536
/** Header lines kept while looking for the line that ends the header */
const HEAD_LIMIT = 50000
/** Rows kept of one dump, and characters of rows kept over all of them */
const DUMP_ROWS = 10000
const DUMP_CHARS = 32 * 1024 * 1024

/** Copy of a string that does not keep the (possibly huge) line it was cut from alive */
function own(s: string): string {
  return (' ' + s).slice(1)
}

function cap(s: string, max: number): string {
  return s.length > max ? own(s.slice(0, max) + '…') : s
}

/**
 * Parses a Canias "TROIA CODE EXECUTION TRACE" one line at a time, so a trace of any size can be read without
 * holding it in memory: push every line (split like text.split(/\r?\n/)), then finish.
 *
 * Structure: "<name> ▎" opens a method/event scope, "▏" closes one, statement lines look like
 * "[N ms]  [<scope> <line>] : <code> : <evaluation>", and tab-indented lines carry details of
 * the previous statement (block markers, loop rows, resolved SQL, row counts...).
 */
export class TraceParser {
  private n = 0
  /** Lines before the body, while it has not been found yet */
  private head: string[] | null = []
  /** First statement or scope line among them (the body starts there when no header end line comes) */
  private headStmt = -1
  private meta: TraceMeta = { title: '', sections: [], dialogRefs: [], classRefs: [] }
  private bodyStart = 0
  private readonly crBreaks: number[] = []
  private readonly scopes: Scope[] = []
  private readonly statements: Statement[] = []
  private readonly issues: TraceIssue[] = []
  private readonly dumps: TraceDump[] = []
  private dump: OpenDump | null = null
  private dumpChars = 0
  private stack: OpenScope[] = []
  /** Blocks of already closed scopes whose "BLOCK ENDED" lines are still to come (RETURN unwinding) */
  private debt = 0
  /** Statement the following detail lines belong to; the only one whose text can still grow */
  private last: Statement | null = null
  private pendingTrail = ''
  private pendingDb: { sql: string; cached: boolean } | null = null
  /**
   * UPDATE / DELETE whose source may still continue on tab lines; its "->DB [...]" follows the statement
   * (SELECT and INSERT print it before). Ends at the first line that is not SQL source.
   */
  private openDml: Statement | null = null
  private implicitCount = 0
  /** Issue whose " * ..." lines may follow */
  private bulletsFor: TraceIssue | null = null
  /** Command errors waiting for the statement they were printed before */
  private pendingCmd: { issue: TraceIssue; word: string }[] = []

  /** Adds the next line; hiddenCr counts bare CRs in a part of the line its reader dropped */
  push(raw: string, hiddenCr = 0): void {
    const i = this.n++
    let line = raw.length > LINE_CAP ? own(raw.slice(0, LINE_CAP)) : raw
    // Bare CRs occur inside multi-line SQL source; only CRLF / LF end a trace line
    if (raw.includes('\r')) {
      for (let j = raw.indexOf('\r'); j !== -1; j = raw.indexOf('\r', j + 1)) this.crBreaks.push(i + 1)
      line = line.replace(/\r/g, ' ')
    }
    for (let k = 0; k < hiddenCr; k++) this.crBreaks.push(i + 1)

    const head = this.head
    if (!head) {
      this.body(line, i)
      return
    }
    head.push(line)
    if (SEPARATOR_END_RE.test(line)) this.startBody(head.length)
    else {
      if (this.headStmt < 0 && (STMT_RE.test(line) || SCOPE_RE.test(line))) this.headStmt = i
      if (head.length > HEAD_LIMIT) this.startBody(this.headStmt >= 0 ? this.headStmt : head.length)
    }
  }

  finish(): ParsedTrace {
    if (this.head) this.startBody(this.headStmt >= 0 ? this.headStmt : this.head.length)
    if (this.dump) this.endDump(this.n)
    if (this.last) this.seal(this.last)
    const { scopes, statements, stack } = this
    const lineCount = this.n
    const root = scopes[0]
    while (stack.length > 1) this.popScope(lineCount)
    this.closeBlocks(stack[0], 0)
    root.endLine = lineCount
    measureScopes(scopes, statements)

    for (const st of statements) {
      const s = scopes[st.scopeId]
      s.selfMs += st.exclMs
      s.stmtCount++
      if (st.sql) s.sqlCount++
    }
    // Children always have higher ids than their parent, so one reverse pass rolls counts up
    for (let i = scopes.length - 1; i >= 0; i--) {
      const s = scopes[i]
      s.totalStmtCount += s.stmtCount
      s.totalSqlCount += s.sqlCount
      if (s.parent >= 0) {
        const p = scopes[s.parent]
        p.totalStmtCount += s.totalStmtCount
        p.totalSqlCount += s.totalSqlCount
      }
    }

    const warnings: string[] = []
    if (statements.length === 0) warnings.push('Dosyada trace satırı bulunamadı. Bu bir Troia trace dosyası mı?')
    if (this.implicitCount > 0) warnings.push(`${this.implicitCount} scope, başlangıç satırı olmadan bulundu (trace bir çağrının ortasında başlamış olabilir).`)

    return { meta: this.meta, scopes, statements, issues: this.issues, dumps: this.dumps, lineCount, bodyStartLine: this.bodyStart + 1, crBreaks: this.crBreaks, warnings }
  }

  private startBody(start: number) {
    const head = this.head!
    this.head = null
    this.bodyStart = start
    this.meta = parseHeader(head, start)
    const root = this.newScope('(trace)', null, start + 1, false, -1)
    this.stack = [{ scope: root, blocks: [] }]
    for (let i = start; i < head.length; i++) this.body(head[i], i)
  }

  /** The statement's text is complete: works out what needs all of it, then cuts it to size */
  private seal(st: Statement) {
    if (st.kind === 'message') st.message = messageInfo(st.code, st.trail)
    const max = st.sql ? SQL_CAP : TEXT_CAP
    if (st.code.length > max || st.trail.length > max) {
      st.code = cap(st.code, max)
      st.trail = cap(st.trail, max)
      st.cut = true
    }
    if (st.sql) {
      st.sql.normalized = cap(st.sql.normalized, SQL_CAP)
      if (st.sql.resolved) st.sql.resolved = cap(st.sql.resolved, SQL_CAP)
    }
  }

  private newScope(name: string, parent: Scope | null, line: number, implicit: boolean, callerLoop: number): Scope {
    name = own(name)
    const { label, owner } = scopeLabel(name)
    const s: Scope = {
      id: this.scopes.length,
      name,
      label,
      owner,
      parent: parent ? parent.id : -1,
      depth: parent ? parent.depth + 1 : 0,
      startLine: line,
      endLine: line,
      kids: [],
      implicit,
      callerLoop,
      selfMs: 0,
      totalMs: 0,
      stmtCount: 0,
      totalStmtCount: 0,
      sqlCount: 0,
      totalSqlCount: 0,
    }
    this.scopes.push(s)
    if (parent) parent.kids.push(~s.id)
    return s
  }

  private top(): OpenScope {
    return this.stack[this.stack.length - 1]
  }

  private currentLoop(): number {
    const t = this.top()
    for (let i = t.blocks.length - 1; i >= 0; i--) if (t.blocks[i].type === 'loop') return t.blocks[i].stmtId
    return t.scope.callerLoop
  }

  private pushScope(name: string, line: number, implicit: boolean) {
    const s = this.newScope(name, this.top().scope, line, implicit, this.currentLoop())
    this.stack.push({ scope: s, blocks: [] })
  }

  private closeBlocks(o: OpenScope, from: number) {
    for (let i = o.blocks.length - 1; i >= from; i--) {
      const st = this.statements[o.blocks[i].stmtId]
      if (st && st.blockEnd === undefined) st.blockEnd = o.scope.kids.length
    }
    o.blocks.length = from
  }

  private popScope(line: number) {
    if (this.stack.length <= 1) return
    const o = this.stack.pop()!
    o.scope.endLine = Math.max(o.scope.startLine, line)
    this.debt += o.blocks.length
    this.closeBlocks(o, 0)
  }

  private endBlock(type: Block['type']) {
    const o = this.top()
    for (let i = o.blocks.length - 1; i >= 0; i--) {
      if (o.blocks[i].type === type) {
        this.closeBlocks(o, i)
        return
      }
    }
  }

  private startDump(line: string, fileLine: number) {
    const fields = new Map<string, string>()
    for (const part of line.replace(DUMP_RE, '$1').split(',')) {
      const c = part.indexOf(':')
      if (c > 0) fields.set(part.slice(0, c).trim().toUpperCase(), part.slice(c + 1).trim())
    }
    const num = (key: string) => parseInt(fields.get(key) ?? '', 10) || 0
    const dump: TraceDump = {
      name: own(fields.get('NAME') ?? ''),
      dbName: own(fields.get('DB NAME') ?? ''),
      fileLine,
      lineEnd: fileLine,
      scopeId: this.top().scope.id,
      stmtId: this.last ? this.last.id : -1,
      rowCount: num('ROWCOUNT'),
      activeRow: num('ACTIVEROW'),
      activeCol: own(fields.get('ACTIVECOLNAME') ?? ''),
      columns: [],
      header: [],
      rows: [],
      prefix: 0,
      width: 1,
    }
    this.dumps.push(dump)
    this.dump = { dump, part: 'head' }
  }

  private endDump(lineEnd: number) {
    const d = this.dump!.dump
    this.dump = null
    d.lineEnd = lineEnd
    // The DUMP statement's lines take the table in, so marking its row marks the table too
    const st = d.stmtId >= 0 ? this.statements[d.stmtId] : null
    if (st) st.span = Math.max(st.span, lineEnd - st.fileLine)
  }

  /** A line inside a dump; false if the dump ended without its "] }" and the line is not part of it */
  private dumpLine(line: string, fileLine: number): boolean {
    const o = this.dump!
    const d = o.dump
    if (STMT_RE.test(line) || SCOPE_RE.test(line)) {
      this.endDump(fileLine - 1)
      return false
    }
    const marks = countMarks(line)
    const t = line.replace(/▏/g, '').trim()
    if (DUMP_END_RE.test(t)) this.endDump(fileLine)
    else if (o.part === 'head') {
      if (/^\[Column info/i.test(t)) o.part = 'columns'
      else if (/^\[\s*ROWS\s*:/i.test(t)) o.part = 'header'
    } else if (o.part === 'columns') {
      // "Index, Name, Type, Length, Scale, Writable, Deleted"
      const c = t.split(',').map((x) => x.trim())
      if (t === ']') o.part = 'head'
      else if (c.length >= 7)
        d.columns.push({ index: +c[0], name: own(c[1]), type: own(c[2]), length: +c[3], scale: +c[4], writable: c[5] === 'true', deleted: c[6] === 'true' })
    } else if (o.part === 'header') {
      dumpLayout(d, line.replace(/▏/g, ''))
      o.part = 'rows'
    } else if (/^\s*\d+\.\s*$/.test(line.slice(0, d.prefix)) || !d.rows.length) {
      if (d.rows.length < DUMP_ROWS && this.dumpChars + line.length <= DUMP_CHARS) {
        d.rows.push(own(line))
        this.dumpChars += line.length
      } else d.cut = true
    } else if (!d.cut) {
      // A value with a line break in it goes on over the next line; one character keeps the cells in place
      d.rows[d.rows.length - 1] = own(d.rows[d.rows.length - 1] + '↵' + line)
    }
    for (let k = 0; k < marks; k++) this.popScope(fileLine)
    return true
  }

  private body(line: string, i: number) {
    const fileLine = i + 1
    if (!line.trim()) return
    if (this.dump) {
      if (this.dumpLine(line, fileLine)) return
    } else if (DUMP_RE.test(line)) {
      this.startDump(line, fileLine)
      return
    }
    const openIssue: TraceIssue | null = this.bulletsFor
    this.bulletsFor = null
    const last = this.last

    const sm = line.match(STMT_RE)
    if (sm) {
      const scopeName = sm[3].trim()
      if (this.top().scope.name !== scopeName) {
        // Re-synchronise with the scope named on the line (missed close markers or a trace started mid-call)
        const stack = this.stack
        let idx = -1
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k].scope.name === scopeName) {
            idx = k
            break
          }
        }
        if (idx > 0) {
          // The scopes ended on the line before; this one is the caller's
          while (stack.length - 1 > idx) this.popScope(fileLine - 1)
        } else {
          this.pushScope(scopeName, fileLine, true)
          this.implicitCount++
        }
        this.debt = 0
      }
      if (last) this.seal(last)
      const marks = countMarks(sm[5])
      const body = sm[5].replace(/▏/g, '').trimEnd()
      const sep = body.indexOf(' : ')
      const code = (sep >= 0 ? body.slice(0, sep) : body).trim()
      let trail = sep >= 0 ? body.slice(sep + 3).trim() : ''
      if (this.pendingTrail) {
        trail = trail ? this.pendingTrail + ' ' + trail : this.pendingTrail
        this.pendingTrail = ''
      }
      const kind = classify(code)
      const top = this.top()
      const scope = top.scope
      const st: Statement = {
        id: this.statements.length,
        fileLine,
        ms: toMs(sm[1], sm[2]),
        exclMs: 0,
        scopeId: scope.id,
        srcLine: parseInt(sm[4], 10),
        code,
        trail,
        kind,
        details: [],
        span: 0,
        loopId: this.currentLoop(),
      }
      if (kind === 'loop' || kind === 'while') {
        const rows = (code + ' ' + trail).match(/TOTAL\s+(\d+)\s+ROWS?/i)
        if (rows) st.loopRows = parseInt(rows[1], 10)
        st.iterations = 0
        top.blocks.push({ type: 'loop', stmtId: st.id })
      } else if (kind === 'if') {
        // Every IF is followed by exactly one "-TRUE/ELSE BLOCK ENDED" line
        top.blocks.push({ type: 'if', stmtId: st.id })
      } else if (kind === 'switch') {
        top.blocks.push({ type: 'switch', stmtId: st.id })
      } else if (/^PARSE\b.*\bBEGIN$/is.test(code)) {
        // A BREAK inside skips the "BLOCK ENDED" lines of the IFs around it; ENDPARSE closes them
        top.blocks.push({ type: 'parse', stmtId: st.id })
      } else if (kind === 'sql') {
        st.sql = sqlInfo(code, trail)
        const pendingDb = this.pendingDb
        if (pendingDb) {
          if (sameVerb(sqlVerb(pendingDb.sql), st.sql.verb)) {
            st.sql.resolved = pendingDb.sql
            st.sql.cached = pendingDb.cached
          }
          this.pendingDb = null
        }
      }
      this.openDml = st.sql && !st.sql.resolved && (st.sql.verb === 'UPDATE' || st.sql.verb === 'DELETE') ? st : null
      this.statements.push(st)
      scope.kids.push(st.id)
      this.last = st
      for (const p of this.pendingCmd) {
        const w = code.match(/^\w+/)?.[0]
        if (w && w.toUpperCase() === p.word) p.issue.stmtId = st.id
      }
      this.pendingCmd = []
      for (let k = 0; k < marks; k++) this.popScope(fileLine)
      return
    }

    const so = line.match(SCOPE_RE)
    if (so) {
      this.pushScope(so[1].trim(), fileLine, false)
      return
    }

    if (/^\s*\t/.test(line)) {
      let marks = countMarks(line)
      const t = line.replace(/▏/g, '').trim()
      const blockEnd = t.match(BLOCK_END_RE)
      if (blockEnd) {
        const type: Block['type'] = /BLOCK/i.test(blockEnd[1])
          ? 'if'
          : /SWITCH/i.test(blockEnd[1])
            ? 'switch'
            : /PARSE/i.test(blockEnd[1])
              ? 'parse'
              : 'loop'
        if (this.debt > 0 && marks > 0) {
          this.debt--
          marks--
        } else {
          this.endBlock(type)
        }
        const rest = t.slice(blockEnd[0].length).trim()
        if (rest.startsWith('->')) this.pendingTrail = rest
        for (let k = 0; k < marks; k++) this.popScope(fileLine)
        return
      }
      const db = t.match(DB_RE)
      const dml: Statement | null = this.openDml
      this.openDml = null
      if (db) {
        const sql = db[2].trim()
        if (dml && sameVerb(sqlVerb(sql), dml.sql!.verb)) {
          dml.sql!.resolved = sql
          dml.sql!.cached = !!db[1]
        } else this.pendingDb = { sql, cached: !!db[1] }
      } else if (dml && /^(FROM|WHERE|SET|AND|OR)\b|^\(/i.test(t)) {
        // Source line of the statement: "FROM X", "WHERE ...", "AND ..."
        dml.span++
        if (dml.code.length <= SQL_CAP) {
          dml.code += '\n' + t
          dml.sql = { ...dml.sql!, ...sqlInfo(dml.code, dml.trail) }
        }
        this.openDml = dml
      } else if (/^\+(TRUE|ELSE) BLOCK STARTED|^\+CASE\b|^-END ITERATION/i.test(t)) {
        // structural markers; blocks are tracked from the statements themselves
      } else if (/^\+ACTIVE ROW|^\+START ITERATION/i.test(t)) {
        const loopId = this.currentLoop()
        const loop = loopId >= 0 ? this.statements[loopId] : null
        if (loop && loop.iterations !== undefined && loop.scopeId === this.top().scope.id) loop.iterations++
      } else {
        let ownLine = true
        const im = t.match(ISSUE_RE)
        const mp = im ? null : t.match(MISSING_RE)
        if (im || mp) {
          const issue: TraceIssue = {
            kind: im ? (/^E/.test(im[1]) ? 'error' : 'warning') : 'missingParam',
            fileLine,
            lineEnd: fileLine,
            scopeId: this.top().scope.id,
            stmtId: last ? last.id : -1,
            text: cap((im ? im[2] : mp![1]).trim(), TEXT_CAP),
            details: [],
          }
          this.issues.push(issue)
          if (im) {
            this.bulletsFor = issue
            const cmd = issue.text.match(COMMAND_RE)
            if (cmd) {
              this.pendingCmd.push({ issue, word: cmd[1].toUpperCase() })
              ownLine = false
            }
          }
        } else if (openIssue && t.startsWith('*')) {
          const d = t.slice(1).trim()
          if (d) openIssue.details.push(cap(d, TEXT_CAP))
          openIssue.lineEnd = fileLine
          this.bulletsFor = openIssue
        }
        if (last && ownLine) {
          // SELECT: "[Number of rows : N]"; DELETE: "[AFFECTED ROW COUNT: N]"; UPDATE: "[SYS_AFFECTEDROWCOUNT[N], ..."
          const rows = last.sql ? t.match(/^\[(?:Number of rows|AFFECTED ROW COUNT)\s*:\s*(\d+)\]|^\[SYS_AFFECTEDROWCOUNT\[(\d+)\]/i) : null
          if (rows) last.sql!.rows = parseInt(rows[1] ?? rows[2], 10)
          if (last.details.length < 40) {
            last.details.push(cap(t, TEXT_CAP))
            last.span++
          }
        }
      }
      for (let k = 0; k < marks; k++) this.popScope(fileLine)
      return
    }

    // A message listed under "Errors:" may itself run over several lines
    if (openIssue && openIssue.details.length) {
      const marks = countMarks(line)
      const k = openIssue.details.length - 1
      if (openIssue.details[k].length <= TEXT_CAP) openIssue.details[k] = cap(openIssue.details[k] + '\n' + line.replace(/▏/g, '').trim(), TEXT_CAP)
      openIssue.lineEnd = fileLine
      this.bulletsFor = openIssue
      for (let k = 0; k < marks; k++) this.popScope(fileLine)
      return
    }

    // Continuation of a multi-line value of the previous statement
    if (last) {
      const marks = countMarks(line)
      const t = line.replace(/▏/g, '').trimEnd()
      // Past the cap the text is cut anyway; only the line count still matters
      const max = last.sql ? SQL_CAP : TEXT_CAP
      last.span++
      if (last.trail) {
        if (last.trail.length <= max) last.trail += '\n' + t
      } else if (last.code.length <= max) last.code += '\n' + t
      for (let k = 0; k < marks; k++) this.popScope(fileLine)
    }
  }
}

export function parseTrace(text: string): ParsedTrace {
  const p = new TraceParser()
  for (const line of text.split(/\r?\n/)) p.push(line)
  return p.finish()
}

/**
 * Computes inclusive scope times without double counting.
 *
 * A statement's reported time already contains the calls it makes (scopes printed right before it,
 * or right after a call statement) and, for IF/LOOP/WHILE/SWITCH, the work inside its block. Each
 * statement plus what it covers forms one unit whose time is max(reported, covered work).
 */
function measureScopes(scopes: Scope[], statements: Statement[]) {
  const incl = new Float64Array(scopes.length).fill(-1)

  const scopeTime = (id: number): number => {
    if (incl[id] >= 0) return incl[id]
    const s = scopes[id]
    const t = measure(s.kids)
    incl[id] = t
    s.totalMs = t
    return t
  }

  /** A block (kids up to `to`) whose time goes to `owner`, the IF/LOOP statement that opened it */
  interface Frame {
    to: number
    sum: number
    pre: number
    owner: Statement | null
    /** Time of the calls printed before the owner */
    before: number
  }

  // Blocks nest on an explicit stack: a trace whose "BLOCK ENDED" lines are missing nests every IF in the one before
  const measure = (kids: number[]): number => {
    const frames: Frame[] = [{ to: kids.length, sum: 0, pre: 0, owner: null, before: 0 }]
    let j = 0
    for (;;) {
      const f = frames[frames.length - 1]
      if (j >= f.to) {
        frames.pop()
        const t = f.sum + f.pre
        if (!f.owner) return t
        const inner = f.before + t
        f.owner.exclMs = Math.max(0, f.owner.ms - inner)
        frames[frames.length - 1].sum += Math.max(f.owner.ms, inner)
        continue
      }
      const k = kids[j]
      if (k < 0) {
        f.pre += scopeTime(~k)
        j++
        continue
      }
      const st = statements[k]
      let inner = f.pre
      f.pre = 0
      j++
      if (st.blockEnd !== undefined && st.blockEnd > j) {
        frames.push({ to: Math.min(st.blockEnd, f.to), sum: 0, pre: 0, owner: st, before: inner })
        continue
      }
      if (st.kind === 'call' && j < f.to && kids[j] < 0) {
        inner += scopeTime(~kids[j])
        j++
      }
      st.exclMs = Math.max(0, st.ms - inner)
      f.sum += Math.max(st.ms, inner)
    }
  }

  // Deepest scopes first keeps the recursion shallow on very large traces
  for (let i = scopes.length - 1; i >= 0; i--) scopeTime(i)
}
