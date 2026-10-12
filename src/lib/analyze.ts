import type { Analysis, Finding, HotLine, MethodStat, ParsedTrace, RepeatPattern, SqlGroup } from './types.ts'

export const THRESHOLDS = {
  repeatInLoop: 5,
  slowMs: 1000,
  warnMs: 200,
  hotLine: 1000,
  manySql: 100,
  tooManySql: 500,
  deepStack: 20,
}

export function fmtMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} dk`
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} sn`
  return `${Math.round(ms)} ms`
}

function add(list: Finding[], f: Finding, cap: { used: number; max: number }) {
  const p = Math.max(0, Math.min(f.penalty, cap.max - cap.used))
  cap.used += p
  list.push({ ...f, penalty: p })
}

export function analyze(p: ParsedTrace): Analysis {
  const { statements, scopes } = p

  // --- method aggregates
  const methodMap = new Map<string, MethodStat>()
  let maxDepth = 0
  for (const s of scopes) {
    if (s.id === 0) continue
    if (s.depth > maxDepth) maxDepth = s.depth
    let m = methodMap.get(s.name)
    if (!m) {
      m = { name: s.name, label: s.label, owner: s.owner, calls: 0, selfMs: 0, totalMs: 0, stmts: 0, sql: 0, firstScope: s.id }
      methodMap.set(s.name, m)
    }
    m.calls++
    m.selfMs += s.selfMs
    m.stmts += s.stmtCount
    m.sql += s.sqlCount
    // Avoid double counting recursion: only add total for the outermost occurrence
    let nested = false
    for (let q = s.parent; q > 0; q = scopes[q].parent) {
      if (scopes[q].name === s.name) {
        nested = true
        break
      }
    }
    if (!nested) m.totalMs += s.totalMs
  }
  const methods = [...methodMap.values()].sort((a, b) => b.totalMs - a.totalMs || b.calls - a.calls)

  // --- hot lines
  const hotMap = new Map<string, HotLine>()
  for (const st of statements) {
    const scopeName = scopes[st.scopeId].name
    const key = `${scopeName}#${st.srcLine}`
    let h = hotMap.get(key)
    if (!h) {
      h = { key, scopeName, srcLine: st.srcLine, code: st.code.split('\n')[0], kind: st.kind, count: 0, ms: 0, firstFileLine: st.fileLine }
      hotMap.set(key, h)
    }
    h.count++
    h.ms += st.ms
  }
  const hotLines = [...hotMap.values()].filter((h) => h.count > 1).sort((a, b) => b.count - a.count || b.ms - a.ms).slice(0, 100)

  // --- slowest statements
  const slowest = statements
    .filter((s) => s.ms > 0)
    .sort((a, b) => b.exclMs - a.exclMs || b.ms - a.ms)
    .slice(0, 50)
    .map((s) => s.id)

  // --- SQL groups
  const sqlMap = new Map<string, SqlGroup & { perLoop: Map<number, number>; locs: Set<string> }>()
  let sqlCount = 0
  let sqlDb = 0
  let sqlMs = 0
  for (const st of statements) {
    if (!st.sql) continue
    sqlCount++
    if (!st.sql.cached) sqlDb++
    sqlMs += st.ms
    let g = sqlMap.get(st.sql.normalized)
    if (!g) {
      g = {
        normalized: st.sql.normalized,
        verb: st.sql.verb,
        tables: st.sql.tables,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        rows: 0,
        dbHits: 0,
        cacheHits: 0,
        stmtIds: [],
        locations: [],
        maxInOneLoop: 0,
        perLoop: new Map(),
        locs: new Set(),
      }
      sqlMap.set(st.sql.normalized, g)
    }
    g.count++
    g.totalMs += st.ms
    g.maxMs = Math.max(g.maxMs, st.ms)
    g.rows += st.sql.rows ?? 0
    if (st.sql.cached) g.cacheHits++
    else g.dbHits++
    g.stmtIds.push(st.id)
    g.locs.add(`${scopes[st.scopeId].name} : ${st.srcLine}`)
    if (st.loopId >= 0) {
      const n = (g.perLoop.get(st.loopId) ?? 0) + 1
      g.perLoop.set(st.loopId, n)
      if (n > g.maxInOneLoop) g.maxInOneLoop = n
    }
  }
  const sqlGroups: SqlGroup[] = [...sqlMap.values()]
    .map(({ perLoop: _p, locs, ...g }) => ({ ...g, locations: [...locs] }))
    .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count)

  // --- repeated work inside loops (N+1 candidates)
  // First count per loop execution, then merge executions of the same loop line.
  const perRun = new Map<string, { kind: RepeatPattern['kind']; label: string; loopId: number; count: number; dbHits: number; ms: number; hasSql: boolean; fileLine: number }>()
  const bump = (kind: RepeatPattern['kind'], label: string, loopId: number, ms: number, hasSql: boolean, fileLine: number, dbHit: boolean) => {
    const key = `${kind}|${label}|${loopId}`
    let r = perRun.get(key)
    if (!r) {
      r = { kind, label, loopId, count: 0, dbHits: 0, ms: 0, hasSql, fileLine }
      perRun.set(key, r)
    }
    r.count++
    if (dbHit) r.dbHits++
    r.ms += ms
  }
  for (const st of statements) if (st.sql && st.loopId >= 0) bump('sql', st.sql.normalized, st.loopId, st.ms, true, st.fileLine, !st.sql.cached)
  for (const s of scopes) {
    if (s.id === 0 || s.implicit || s.callerLoop < 0) continue
    const parent = scopes[s.parent]
    // Count only the outermost call made inside the loop, not everything it calls in turn
    if (parent.id !== 0 && parent.callerLoop === s.callerLoop && statements[s.callerLoop].scopeId !== parent.id) continue
    bump('call', s.name, s.callerLoop, s.totalMs, s.totalSqlCount > 0, s.startLine, false)
  }
  const merged = new Map<string, RepeatPattern>()
  for (const r of perRun.values()) {
    const loop = statements[r.loopId]
    const key = `${r.kind}|${r.label}|${scopes[loop.scopeId].name}#${loop.srcLine}`
    let m = merged.get(key)
    if (!m) {
      m = {
        kind: r.kind,
        label: r.label,
        loopRuns: 0,
        maxPerRun: 0,
        loopStmtId: r.loopId,
        loopCode: loop.code.split('\n')[0],
        loopFileLine: loop.fileLine,
        count: 0,
        dbHits: 0,
        totalMs: 0,
        hasSql: r.hasSql,
        sampleFileLine: r.fileLine,
      }
      merged.set(key, m)
    }
    m.loopRuns++
    m.count += r.count
    m.dbHits += r.dbHits
    m.totalMs += r.ms
    if (r.count > m.maxPerRun) {
      m.maxPerRun = r.count
      m.loopStmtId = r.loopId
      m.loopFileLine = loop.fileLine
      m.sampleFileLine = r.fileLine
    }
  }
  const repeats = [...merged.values()].filter((r) => r.maxPerRun >= THRESHOLDS.repeatInLoop)
  repeats.sort((a, b) => Number(b.hasSql) - Number(a.hasSql) || b.dbHits - a.dbHits || b.count - a.count)

  // --- messages
  const messages = statements.filter((s) => s.message).map((s) => s.id)
  const errors = messages.filter((id) => statements[id].message!.type === 'E').length

  // --- totals
  const root = scopes[0]
  const totals = {
    statements: statements.length,
    scopes: scopes.length - 1,
    totalMs: root.totalMs,
    maxDepth,
    sql: sqlCount,
    sqlDb,
    sqlCache: sqlCount - sqlDb,
    sqlMs,
    loops: statements.filter((s) => s.kind === 'loop' || s.kind === 'while').length,
    messages: messages.length,
    errors,
  }

  // --- health findings
  const findings: Finding[] = []
  const capN1 = { used: 0, max: 40 }
  for (const r of repeats.filter((r) => r.kind === 'sql')) {
    const cacheOnly = r.dbHits < THRESHOLDS.repeatInLoop
    const runs = r.loopRuns > 1 ? ` (${r.loopRuns} döngü çalışmasında toplam ${r.count})` : ''
    add(
      findings,
      {
        id: `n1-${r.loopStmtId}-${r.label.slice(0, 40)}`,
        severity: cacheOnly ? 'info' : r.dbHits >= 20 ? 'critical' : 'warning',
        title: cacheOnly
          ? `Döngüde tekrarlanan sorgu (önbellekten): ${r.maxPerRun} kez${runs}`
          : `N+1 sorgu: aynı SQL döngüde ${r.dbHits} kez veritabanına gitti${runs}`,
        detail: `${r.label.slice(0, 160)} — döngü: ${r.loopCode.slice(0, 100)}. ${
          cacheOnly ? 'Çoğu önbellekten geldi, yine de döngü dışına alınabilir.' : 'Sorguyu döngü dışına alıp tek seferde okuyun.'
        }`,
        penalty: cacheOnly ? 2 : 15,
        fileLine: r.sampleFileLine,
      },
      capN1,
    )
  }
  const capCalls = { used: 0, max: 16 }
  for (const r of repeats.filter((r) => r.kind === 'call')) {
    add(
      findings,
      {
        id: `rc-${r.loopStmtId}-${r.label}`,
        severity: r.hasSql ? 'warning' : 'info',
        title: `Döngüde tekrarlanan çağrı: ${r.label} (${r.maxPerRun}×${r.loopRuns > 1 ? `, ${r.loopRuns} döngüde` : ''})`,
        detail: r.hasSql
          ? `Çağrılan metot SQL çalıştırıyor. Toplam ${fmtMs(r.totalMs)}. Döngü: ${r.loopCode.slice(0, 100)}. Veriyi toplu okumayı düşünün.`
          : `Toplam ${fmtMs(r.totalMs)}. Döngü: ${r.loopCode.slice(0, 100)}. Döngü dışına alınabilecek iş olup olmadığını kontrol edin.`,
        penalty: r.hasSql ? 8 : 2,
        fileLine: r.sampleFileLine,
      },
      capCalls,
    )
  }
  const capSlow = { used: 0, max: 25 }
  for (const id of slowest) {
    const st = statements[id]
    if (st.exclMs < THRESHOLDS.warnMs) break
    const crit = st.exclMs >= THRESHOLDS.slowMs
    add(
      findings,
      {
        id: `slow-${id}`,
        severity: crit ? 'critical' : 'warning',
        title: `Yavaş satır: ${fmtMs(st.exclMs)}`,
        detail: `${scopes[st.scopeId].name} : ${st.srcLine} — ${st.code.split('\n')[0].slice(0, 140)}`,
        penalty: crit ? 10 : 3,
        fileLine: st.fileLine,
      },
      capSlow,
    )
  }
  if (sqlDb > THRESHOLDS.manySql) {
    add(
      findings,
      {
        id: 'many-sql',
        severity: sqlDb > THRESHOLDS.tooManySql ? 'critical' : 'warning',
        title: `Çok sayıda veritabanı sorgusu: ${sqlDb}`,
        detail: `${sqlDb} veritabanı, ${sqlCount - sqlDb} önbellek. Toplam SQL süresi ${fmtMs(sqlMs)}. Tekrarlanan sorguları birleştirmek faydalı olabilir.`,
        penalty: sqlDb > THRESHOLDS.tooManySql ? 10 : 5,
      },
      { used: 0, max: 10 },
    )
  }
  const capMsg = { used: 0, max: 15 }
  for (const id of messages) {
    const st = statements[id]
    const m = st.message!
    if (m.type !== 'E' && m.type !== 'W') continue
    add(
      findings,
      {
        id: `msg-${id}`,
        severity: m.type === 'E' ? 'warning' : 'info',
        title: `${m.type === 'E' ? 'Hata' : 'Uyarı'} mesajı: ${m.module} ${m.type}${m.number}`,
        detail: m.text.replace(/\s+/g, ' ').slice(0, 200) || st.code.slice(0, 160),
        penalty: m.type === 'E' ? 5 : 1,
        fileLine: st.fileLine,
      },
      capMsg,
    )
  }
  const capHot = { used: 0, max: 10 }
  for (const h of hotLines) {
    const seqSearch = /LOCATERECORD\s+SEQUENTIAL/i.test(h.code)
    if (h.count >= THRESHOLDS.hotLine || (seqSearch && h.count >= 50)) {
      add(
        findings,
        {
          id: `hot-${h.key}`,
          severity: h.count >= THRESHOLDS.hotLine ? 'warning' : 'info',
          title: seqSearch ? `Döngüde sıralı arama: ${h.count} kez` : `Sık çalışan satır: ${h.count} kez`,
          detail: `${h.scopeName} : ${h.srcLine} — ${h.code.slice(0, 120)}${
            seqSearch ? '. Sıralı arama her satırda tabloyu baştan tarar; büyük tablolarda maliyet karesel artar.' : ''
          }`,
          penalty: h.count >= THRESHOLDS.hotLine ? 5 : 3,
          fileLine: h.firstFileLine,
        },
        capHot,
      )
    }
  }
  if (maxDepth >= THRESHOLDS.deepStack) {
    add(
      findings,
      { id: 'deep', severity: 'info', title: `Derin çağrı zinciri: ${maxDepth} seviye`, detail: 'Çok derin iç içe çağrılar takibi ve performansı zorlaştırır.', penalty: 3 },
      { used: 0, max: 3 },
    )
  }
  for (const w of p.warnings) findings.push({ id: `w-${w}`, severity: 'info', title: 'Ayrıştırma notu', detail: w, penalty: 0 })

  const order = { critical: 0, warning: 1, info: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.penalty - a.penalty)
  const score = statements.length ? Math.max(0, 100 - findings.reduce((s, f) => s + f.penalty, 0)) : 0
  const grade = score >= 90 ? 'Mükemmel' : score >= 75 ? 'İyi' : score >= 50 ? 'Orta' : 'Zayıf'

  const info: Record<string, string> = {}
  for (const s of p.meta.sections) for (const [k, v] of s.fields) if (!(k in info)) info[k] = v

  return { totals, methods, hotLines, slowest, sqlGroups, repeats, messages, findings, score, grade, info }
}
