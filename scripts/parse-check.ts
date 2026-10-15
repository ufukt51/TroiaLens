import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseTrace } from '../src/lib/parser.ts'
import { analyze } from '../src/lib/analyze.ts'
import { refAtLine } from '../src/lib/locate.ts'

// Known results for the test traces. A change here must be deliberate.
// Real traces and their expectations live in samples/ (not committed): samples/expected.json
type Expected = { match: string; score: number; sql?: number; sqlDb?: number; sqlCache?: number; scopes?: number; traceErrors?: number; missingParams?: number }
const EXPECTED: Expected[] = [
  { match: 'sample-trace[.]txt$', score: 66 },
  ...(existsSync('samples/expected.json') ? (JSON.parse(readFileSync('samples/expected.json', 'utf8')) as Expected[]) : []),
]
const failures: string[] = []
let checked = 0

const files = process.argv.slice(2)
// samples/ holds real traces and is not committed; pass file paths to test other traces
const targets = files.length ? files : [
  ...(existsSync('samples') ? readdirSync('samples').filter((f) => !f.endsWith('.json')).map((f) => join('samples', f)) : []),
  join('public', 'sample-trace.txt'),
]

for (const file of targets) {
  let text: string
  try { text = readFileSync(file, 'utf8') } catch { continue }
  const t0 = performance.now()
  const p = parseTrace(text)
  const a = analyze(p)
  console.log(`\n=== ${file} (${(performance.now() - t0).toFixed(1)} ms)`)
  console.log('meta:', p.meta.title, '| sections:', p.meta.sections.map((s) => s.name).join(', '), '| refs:', p.meta.dialogRefs.length, p.meta.classRefs.length)
  console.log('totals:', a.totals, 'score:', a.score, a.grade)
  const exp = EXPECTED.find((e) => new RegExp(e.match).test(file))
  if (exp) {
    checked++
    const actual: Record<string, number> = {
      score: a.score,
      sql: a.totals.sql,
      sqlDb: a.totals.sqlDb,
      sqlCache: a.totals.sqlCache,
      scopes: a.totals.scopes,
      traceErrors: a.totals.traceErrors,
      missingParams: a.totals.missingParams,
    }
    for (const [k, v] of Object.entries(exp)) {
      if (k === 'match') continue
      if (actual[k] !== v) failures.push(`${file}: ${k} beklenen ${v}, bulunan ${actual[k]}`)
    }
  }
  // Editor caret -> tree row must land on the row that printed the line
  for (const st of p.statements) {
    const ref = refAtLine(p, st.fileLine)
    if (ref !== st.id) { failures.push(`${file}: satır ${st.fileLine} ifade ${st.id} yerine ${ref} buldu`); break }
  }
  for (const s of p.scopes) {
    if (s.id === 0 || s.implicit || p.statements.some((st) => st.fileLine === s.startLine)) continue
    const ref = refAtLine(p, s.startLine)
    if (ref !== ~s.id) { failures.push(`${file}: satır ${s.startLine} kapsam ${s.id} yerine ${ref} buldu`); break }
  }
  const show = (id: number, ind = '') => {
    const s = p.scopes[id]
    console.log(`${ind}${s.name} [${s.startLine}-${s.endLine}] self=${s.selfMs} total=${s.totalMs} stmts=${s.stmtCount} loop=${s.callerLoop}${s.implicit ? ' (implicit)' : ''}`)
    for (const k of s.kids) if (k < 0) show(~k, ind + '  ')
  }
  show(0)
  console.log('findings:'); for (const f of a.findings) console.log(`  [${f.severity}] -${f.penalty} ${f.title} :: ${f.detail.slice(0, 100)}`)
  console.log('sql groups:'); for (const g of a.sqlGroups) console.log(`  ${g.count}x ${g.totalMs}ms maxLoop=${g.maxInOneLoop} ${g.normalized.slice(0, 90)}`)
  console.log('repeats:'); for (const r of a.repeats) console.log(`  ${r.kind} ${r.count}x ${r.label.slice(0, 80)} @loop ${r.loopFileLine}`)
  console.log('loops:', p.statements.filter((s) => s.kind === 'loop' || s.kind === 'while').map((s) => `${s.fileLine}:rows=${s.loopRows} it=${s.iterations}`).join(' '))
  console.log('kinds:', Object.entries(p.statements.reduce((m: Record<string, number>, s) => (m[s.kind] = (m[s.kind] ?? 0) + 1, m), {})))
}

console.log(`\n${checked} referans dosya kontrol edildi.`)
if (failures.length) {
  console.error('BAŞARISIZ:\n  ' + failures.join('\n  '))
  process.exitCode = 1
} else {
  console.log('Tüm beklenen değerler tuttu.')
}
