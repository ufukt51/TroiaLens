import type { LineSource } from './source.ts'

export type StmtKind =
  | 'if'
  | 'loop'
  | 'while'
  | 'return'
  | 'object'
  | 'message'
  | 'assign'
  | 'call'
  | 'sql'
  | 'table'
  | 'switch'
  | 'params'
  | 'other'

export interface SqlInfo {
  verb: string
  tables: string[]
  normalized: string
  rows?: number
  /** SQL with parameters resolved, as sent to the database */
  resolved?: string
  /** Served from the Canias cache instead of the database */
  cached?: boolean
}

export interface MessageInfo {
  module: string
  type: string
  number: string
  text: string
}

export interface Statement {
  id: number
  /** 1-based line number in the trace file */
  fileLine: number
  /** Time reported by the trace; includes nested calls and blocks */
  ms: number
  /** Reported time minus what nested calls / blocks account for */
  exclMs: number
  scopeId: number
  /** Source line inside the TROIA method */
  srcLine: number
  code: string
  trail: string
  kind: StmtKind
  details: string[]
  /** File lines the statement's text and details take after its own line */
  span: number
  /** Its text was cut to size; the trace file has all of it */
  cut?: boolean
  /** Statement id of the innermost enclosing LOOP/WHILE (inherited through calls), -1 if none */
  loopId: number
  loopRows?: number
  iterations?: number
  /** For IF/LOOP/WHILE/SWITCH: index in the scope's kids where its block ends (exclusive) */
  blockEnd?: number
  sql?: SqlInfo
  message?: MessageInfo
}

export interface Scope {
  id: number
  name: string
  /** Short label (method / event name) */
  label: string
  owner: string
  parent: number
  depth: number
  startLine: number
  endLine: number
  /** Children in execution order: >= 0 statement id, < 0 scope id encoded as ~id */
  kids: number[]
  implicit: boolean
  /** Loop instance active in the caller when this scope was entered, -1 if none */
  callerLoop: number
  selfMs: number
  totalMs: number
  stmtCount: number
  totalStmtCount: number
  sqlCount: number
  totalSqlCount: number
}

export interface CrossRef {
  from: string
  to: string
  kind: string
}

export interface TraceMeta {
  title: string
  sections: { name: string; fields: [string, string][] }[]
  dialogRefs: CrossRef[]
  classRefs: CrossRef[]
}

export type IssueKind = 'error' | 'warning' | 'missingParam'

/** A runtime error, warning or missing parameter the trace printed as a detail line */
export interface TraceIssue {
  kind: IssueKind
  /** Trace line the issue is printed on */
  fileLine: number
  /** Last trace line of the issue (lines listed under "Errors:") */
  lineEnd: number
  scopeId: number
  /** Statement the issue belongs to, -1 if none */
  stmtId: number
  /** Error text, or the missing parameter as printed (NAME[value]) */
  text: string
  /** Lines listed under "Errors:" (" * ..."), without the bullet */
  details: string[]
}

export interface ParsedTrace {
  meta: TraceMeta
  scopes: Scope[]
  statements: Statement[]
  /** In file order */
  issues: TraceIssue[]
  lineCount: number
  bodyStartLine: number
  /** Trace line of every bare CR, ascending. Editors (Notepad++) break lines there too; see editorLine */
  crBreaks: number[]
  warnings: string[]
}

export type Severity = 'critical' | 'warning' | 'info'

export interface Finding {
  id: string
  severity: Severity
  title: string
  detail: string
  penalty: number
  /** Statement or file line to jump to */
  fileLine?: number
}

export interface MethodStat {
  name: string
  label: string
  owner: string
  calls: number
  selfMs: number
  totalMs: number
  stmts: number
  sql: number
  firstScope: number
}

export interface HotLine {
  key: string
  scopeName: string
  srcLine: number
  code: string
  kind: StmtKind
  count: number
  ms: number
  firstFileLine: number
}

export interface SqlGroup {
  normalized: string
  verb: string
  tables: string[]
  count: number
  totalMs: number
  maxMs: number
  rows: number
  dbHits: number
  cacheHits: number
  stmtIds: number[]
  locations: string[]
  /** Highest number of executions inside a single loop instance */
  maxInOneLoop: number
}

export interface RepeatPattern {
  kind: 'sql' | 'call'
  label: string
  /** Number of separate loop executions in which the pattern was seen */
  loopRuns: number
  /** Highest repetition inside a single loop execution */
  maxPerRun: number
  loopStmtId: number
  loopCode: string
  loopFileLine: number
  count: number
  /** For SQL patterns: executions that actually hit the database */
  dbHits: number
  totalMs: number
  hasSql: boolean
  sampleFileLine: number
}

export interface Analysis {
  totals: {
    statements: number
    scopes: number
    totalMs: number
    maxDepth: number
    sql: number
    sqlDb: number
    sqlCache: number
    sqlMs: number
    loops: number
    messages: number
    errors: number
    /** Warning MESSAGEs */
    warnings: number
    /** "Errors:" lines printed by the runtime */
    traceErrors: number
    traceWarnings: number
    missingParams: number
  }
  methods: MethodStat[]
  hotLines: HotLine[]
  slowest: number[]
  sqlGroups: SqlGroup[]
  repeats: RepeatPattern[]
  messages: number[]
  findings: Finding[]
  score: number
  grade: string
  info: Record<string, string>
}

export interface TraceResult {
  parsed: ParsedTrace
  analysis: Analysis
  parseMs: number
}

/** A trace loaded into the UI, in either the browser app or the Notepad++ panel */
export interface LoadedTrace {
  /** Changes on every load so views reset their state */
  id: number
  name: string
  size: number
  /** Lines for the raw and source views; null in Notepad++, where the editor shows them */
  source: LineSource | null
  result: TraceResult
}
