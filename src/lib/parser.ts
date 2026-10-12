import type { CrossRef, MessageInfo, ParsedTrace, Scope, SqlInfo, Statement, StmtKind, TraceMeta } from './types.ts'

const CLOSE = '▏' // ▏ scope end marker (▎ opens a scope)

const STMT_RE = /^\s*\[(\d+(?:[.,]\d+)?)\s*(ms|msec|sec|s|min|us|µs)\]\s*\[(.+?)\s+(\d+)\]\s*:\s?(.*)$/i
const SCOPE_RE = /^\s*(\S.*?)\s*▎\s*$/
const FIELD_RE = /^(.+?)\s*:\s*\[(.*)\]\s*$/
const XREF_RE = /^(\S+)\s*->\s*(\S+?),?\s*\((\w+)\)/
const SEPARATOR_END_RE = /^-{10,}\s*▏/
const BLOCK_END_RE = /^(-(TRUE|ELSE) BLOCK ENDED|-?ENDLOOP|-?ENDWHILE|-?ENDFOR|-?ENDSWITCH)/i
const DB_RE = /^->\s*DB(\s+CACHE)?\s*\[(.*)\]\s*$/is

const SQL_RE =
  /^(SELECT\b|INSERT\s+INTO\b|UPDATE\s+[\w.]+\s+SET\b|DELETE\s+FROM\b|DELETE\s+\w+\s+WHERE\b|TRUNCATE\b|MERGE\b|EXEC(UTE)?\s+(SQL|PROC|PROCEDURE)?\b|SQLEXEC\b|EXECSQL\b|CALL\s+\w+\s*\()/i
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

function sqlInfo(code: string, trail: string): SqlInfo {
  const verb = (code.trim().match(/^\w+/)?.[0] ?? 'SQL').toUpperCase()
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
  type: 'if' | 'loop' | 'switch'
  stmtId: number
}

interface OpenScope {
  scope: Scope
  blocks: Block[]
}

/**
 * Parses a Canias "TROIA CODE EXECUTION TRACE" text.
 *
 * Structure: "<name> ▎" opens a method/event scope, "▏" closes one, statement lines look like
 * "[N ms]  [<scope> <line>] : <code> : <evaluation>", and tab-indented lines carry details of
 * the previous statement (block markers, loop rows, resolved SQL, row counts...).
 */
export function parseTrace(text: string): ParsedTrace {
  // Bare CRs occur inside multi-line SQL source; only CRLF / LF end a trace line
  const lines = text.split(/\r?\n/).map((l) => (l.includes('\r') ? l.replace(/\r/g, ' ') : l))
  const warnings: string[] = []

  let bodyStart = lines.findIndex((l) => SEPARATOR_END_RE.test(l))
  if (bodyStart >= 0) bodyStart += 1
  else {
    bodyStart = lines.findIndex((l) => STMT_RE.test(l) || SCOPE_RE.test(l))
    if (bodyStart < 0) bodyStart = lines.length
  }
  const meta = parseHeader(lines, bodyStart)

  const scopes: Scope[] = []
  const statements: Statement[] = []

  const newScope = (name: string, parent: Scope | null, line: number, implicit: boolean, callerLoop: number): Scope => {
    const { label, owner } = scopeLabel(name)
    const s: Scope = {
      id: scopes.length,
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
    scopes.push(s)
    if (parent) parent.kids.push(~s.id)
    return s
  }

  const root = newScope('(trace)', null, bodyStart + 1, false, -1)
  const stack: OpenScope[] = [{ scope: root, blocks: [] }]
  /** Blocks of already closed scopes whose "BLOCK ENDED" lines are still to come (RETURN unwinding) */
  let debt = 0
  let last: Statement | null = null
  let pendingTrail = ''
  let pendingDb: { sql: string; cached: boolean } | null = null
  let implicitCount = 0

  const top = () => stack[stack.length - 1]

  const currentLoop = (): number => {
    const t = top()
    for (let i = t.blocks.length - 1; i >= 0; i--) if (t.blocks[i].type === 'loop') return t.blocks[i].stmtId
    return t.scope.callerLoop
  }

  const pushScope = (name: string, line: number, implicit: boolean) => {
    const s = newScope(name, top().scope, line, implicit, currentLoop())
    stack.push({ scope: s, blocks: [] })
  }

  const closeBlocks = (o: OpenScope, from: number) => {
    for (let i = o.blocks.length - 1; i >= from; i--) {
      const st = statements[o.blocks[i].stmtId]
      if (st && st.blockEnd === undefined) st.blockEnd = o.scope.kids.length
    }
    o.blocks.length = from
  }

  const popScope = (line: number) => {
    if (stack.length <= 1) return
    const o = stack.pop()!
    o.scope.endLine = line
    debt += o.blocks.length
    closeBlocks(o, 0)
  }

  const endBlock = (type: Block['type']) => {
    const o = top()
    for (let i = o.blocks.length - 1; i >= 0; i--) {
      if (o.blocks[i].type === type) {
        closeBlocks(o, i)
        return
      }
    }
  }

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]
    const fileLine = i + 1
    if (!line.trim()) continue

    const sm = line.match(STMT_RE)
    if (sm) {
      const scopeName = sm[3].trim()
      if (top().scope.name !== scopeName) {
        // Re-synchronise with the scope named on the line (missed close markers or a trace started mid-call)
        let idx = -1
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k].scope.name === scopeName) {
            idx = k
            break
          }
        }
        if (idx > 0) {
          while (stack.length - 1 > idx) popScope(fileLine)
        } else {
          pushScope(scopeName, fileLine, true)
          implicitCount++
        }
        debt = 0
      }
      const marks = countMarks(sm[5])
      const body = sm[5].replace(/▏/g, '').trimEnd()
      const sep = body.indexOf(' : ')
      const code = (sep >= 0 ? body.slice(0, sep) : body).trim()
      let trail = sep >= 0 ? body.slice(sep + 3).trim() : ''
      if (pendingTrail) {
        trail = trail ? pendingTrail + ' ' + trail : pendingTrail
        pendingTrail = ''
      }
      const kind = classify(code)
      const scope = top().scope
      const st: Statement = {
        id: statements.length,
        fileLine,
        ms: toMs(sm[1], sm[2]),
        exclMs: 0,
        scopeId: scope.id,
        srcLine: parseInt(sm[4], 10),
        code,
        trail,
        kind,
        details: [],
        loopId: currentLoop(),
      }
      if (kind === 'loop' || kind === 'while') {
        const rows = (code + ' ' + trail).match(/TOTAL\s+(\d+)\s+ROWS?/i)
        if (rows) st.loopRows = parseInt(rows[1], 10)
        st.iterations = 0
        top().blocks.push({ type: 'loop', stmtId: st.id })
      } else if (kind === 'if') {
        // Every IF is followed by exactly one "-TRUE/ELSE BLOCK ENDED" line
        top().blocks.push({ type: 'if', stmtId: st.id })
      } else if (kind === 'switch') {
        top().blocks.push({ type: 'switch', stmtId: st.id })
      } else if (kind === 'sql') {
        st.sql = sqlInfo(code, trail)
        if (pendingDb) {
          st.sql.resolved = pendingDb.sql
          st.sql.cached = pendingDb.cached
          pendingDb = null
        }
      }
      statements.push(st)
      scope.kids.push(st.id)
      last = st
      for (let k = 0; k < marks; k++) popScope(fileLine)
      continue
    }

    const so = line.match(SCOPE_RE)
    if (so) {
      pushScope(so[1].trim(), fileLine, false)
      continue
    }

    if (/^\s*\t/.test(line)) {
      let marks = countMarks(line)
      const t = line.replace(/▏/g, '').trim()
      const blockEnd = t.match(BLOCK_END_RE)
      if (blockEnd) {
        const type: Block['type'] = /BLOCK/i.test(blockEnd[1]) ? 'if' : /SWITCH/i.test(blockEnd[1]) ? 'switch' : 'loop'
        if (debt > 0 && marks > 0) {
          debt--
          marks--
        } else {
          endBlock(type)
        }
        const rest = t.slice(blockEnd[0].length).trim()
        if (rest.startsWith('->')) pendingTrail = rest
        for (let k = 0; k < marks; k++) popScope(fileLine)
        continue
      }
      const db = t.match(DB_RE)
      if (db) {
        pendingDb = { sql: db[2].trim(), cached: !!db[1] }
      } else if (/^\+(TRUE|ELSE) BLOCK STARTED|^\+CASE\b|^-END ITERATION/i.test(t)) {
        // structural markers; blocks are tracked from the statements themselves
      } else if (/^\+ACTIVE ROW|^\+START ITERATION/i.test(t)) {
        const loopId = currentLoop()
        const loop = loopId >= 0 ? statements[loopId] : null
        if (loop && loop.iterations !== undefined && loop.scopeId === top().scope.id) loop.iterations++
      } else if (last) {
        const rows = last.sql ? t.match(/^\[Number of rows\s*:\s*(\d+)\]/i) : null
        if (rows) last.sql!.rows = parseInt(rows[1], 10)
        if (last.details.length < 40) last.details.push(t)
      }
      for (let k = 0; k < marks; k++) popScope(fileLine)
      continue
    }

    // Continuation of a multi-line value of the previous statement
    if (last) {
      const marks = countMarks(line)
      const t = line.replace(/▏/g, '').trimEnd()
      if (last.trail) last.trail += '\n' + t
      else last.code += '\n' + t
      for (let k = 0; k < marks; k++) popScope(fileLine)
    }
  }

  while (stack.length > 1) popScope(lines.length)
  closeBlocks(stack[0], 0)
  root.endLine = lines.length
  measureScopes(scopes, statements)

  for (const st of statements) {
    if (st.kind === 'message') st.message = messageInfo(st.code, st.trail)
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

  if (statements.length === 0) warnings.push('Dosyada trace satırı bulunamadı. Bu bir Troia trace dosyası mı?')
  if (implicitCount > 0) warnings.push(`${implicitCount} scope, başlangıç satırı olmadan bulundu (trace bir çağrının ortasında başlamış olabilir).`)

  return { meta, scopes, statements, lineCount: lines.length, bodyStartLine: bodyStart + 1, warnings }
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
    const t = measure(s.kids, 0, s.kids.length)
    incl[id] = t
    s.totalMs = t
    return t
  }

  const measure = (kids: number[], from: number, to: number): number => {
    let sum = 0
    let pre = 0
    let j = from
    while (j < to) {
      const k = kids[j]
      if (k < 0) {
        pre += scopeTime(~k)
        j++
        continue
      }
      const st = statements[k]
      let inner = pre
      pre = 0
      j++
      if (st.blockEnd !== undefined && st.blockEnd > j) {
        const end = Math.min(st.blockEnd, to)
        inner += measure(kids, j, end)
        j = end
      } else if (st.kind === 'call' && j < to && kids[j] < 0) {
        inner += scopeTime(~kids[j])
        j++
      }
      st.exclMs = Math.max(0, st.ms - inner)
      sum += Math.max(st.ms, inner)
    }
    return sum + pre
  }

  // Deepest scopes first keeps the recursion shallow on very large traces
  for (let i = scopes.length - 1; i >= 0; i--) scopeTime(i)
}
