import { readFileSync } from 'node:fs'
import { tokenizeCode, tokenizeLine, tokenizeTrail } from '../src/lib/syntax.ts'

// Expected colouring from the reference implementation (ref-syntax.mjs, make-fixtures.mjs); the Notepad++
// plugin is held to the same file. A change here must be deliberate and made in all three.
type Fixtures = {
  lines: { in: string; color: unknown; deco: unknown; band: boolean }[]
  code: { in: string; color: unknown }[]
  trail: { in: string; color: unknown; deco: unknown }[]
}
const fx = JSON.parse(readFileSync(new URL('./fixtures/syntax.json', import.meta.url), 'utf8')) as Fixtures
const failures: string[] = []
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const check = (what: string, input: string, actual: unknown, expected: unknown) => {
  if (!same(actual, expected)) failures.push(`${what} ${JSON.stringify(input).slice(0, 100)}\n    beklenen ${JSON.stringify(expected)}\n    bulunan  ${JSON.stringify(actual)}`)
}

for (const f of fx.lines) check('satır', f.in, tokenizeLine(f.in), { color: f.color, deco: f.deco, band: f.band })
for (const f of fx.code) check('kod', f.in, tokenizeCode(f.in), f.color)
for (const f of fx.trail) check('değerlendirme', f.in, tokenizeTrail(f.in), { color: f.color, deco: f.deco })

const total = fx.lines.length + fx.code.length + fx.trail.length
console.log(`\nSözdizimi: ${total} örnek kontrol edildi.`)
if (failures.length) {
  console.error(`BAŞARISIZ (${failures.length}):\n  ` + failures.join('\n  '))
  process.exitCode = 1
} else {
  console.log('Tüm renklendirmeler referansla aynı.')
}
