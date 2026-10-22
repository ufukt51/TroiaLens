import { decodeState, encodeState, packState, unpackState } from '../src/lib/docState.ts'

// Snapshots of the Notepad++ panel's per-document view state: they must come back exactly and stay small.
const failures: string[] = []
const plain = (v: unknown): unknown =>
  v instanceof Set ? { set: [...v].sort() } : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v
const same = (a: Map<string, unknown>, b: Map<string, unknown>) =>
  JSON.stringify([...a].map(([k, v]) => [k, plain(v)])) === JSON.stringify([...b].map(([k, v]) => [k, plain(v)]))

const typical = new Map<string, unknown>([
  ['tab', 'tree'],
  ['detail', 4211],
  ['cursor', { ref: 4211, nonce: 1761100000000, open: true }],
  ['mark', { from: 120, to: 9800, line: 4300, lineEnd: 4302, word: 'GETDATA' }],
  ['tree.level', 3],
  // Collapses while filtering are kept as ~id, so the set holds negative numbers too
  ['tree.open', new Set([5, 1, 2, 3, 4, 40, 41, 900, -7, -12])],
  ['tree.query', 'IASMATBAL'],
  ['tree.y', 128730],
  ['issues.open', new Set(['3|A', '1|B'])],
  ['issues.active', null],
  ['sql.sort', 'count'],
  ['y.sql', 640],
])

const sizes: string[] = []
async function check(what: string, values: Map<string, unknown>, limit: number) {
  const json = encodeState(values)
  const packed = await packState(values)
  const back = await unpackState(packed)
  const expected = new Map(values)
  for (const [k, v] of expected) if (v && typeof v === 'object' && 'nonce' in v) expected.set(k, Object.fromEntries(Object.entries(v).filter(([f]) => f !== 'nonce')))
  if (!same(back, expected)) failures.push(`${what}: geri açılan durum farklı`)
  if (!same(decodeState(json), expected)) failures.push(`${what}: JSON çözümü farklı`)
  if (packed.bytes.length > limit) failures.push(`${what}: ${packed.bytes.length} bayt, sınır ${limit}`)
  if (packed.deflated && packed.bytes.length >= json.length) failures.push(`${what}: sıkıştırma büyüttü`)
  sizes.push(`  ${what}: JSON ${json.length} bayt → ${packed.bytes.length} bayt${packed.deflated ? ' (deflate)' : ''}`)
}

await check('tipik durum', typical, 400)
await check('boş', new Map(), 4)
await check('tek sekme', new Map([['tab', 'sql']]), 20)

// "Tümünü aç" on a large trace: every scope id is open
const all = new Set<number>()
for (let i = 1; i <= 50_000; i++) all.add(i)
await check('50.000 açık dal (tümü)', new Map([['tree.open', all]]), 200)

// Scattered by hand: random ids up to 200.000
let seed = 7
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const scattered = new Set<number>()
while (scattered.size < 2_000) scattered.add(1 + Math.floor(rand() * 200_000))
await check('2.000 dağınık açık dal', new Map([['tree.open', scattered]]), 4_000)

console.log(`\nDurum fotoğrafları:\n${sizes.join('\n')}`)
if (failures.length) {
  console.error(`BAŞARISIZ (${failures.length}):\n  ` + failures.join('\n  '))
  process.exitCode = 1
} else {
  console.log('Tüm fotoğraflar aynen geri açıldı.')
}
