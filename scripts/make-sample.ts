// Generates public/sample-trace.txt: a synthetic trace with made-up data that exercises every analysis.
import { writeFileSync } from 'node:fs'

const O = '\u258E'
const C = '\u258F'
const out: string[] = []
const sep = '-----------------------------------------------'
const st = (ms: number, scope: string, line: number, code: string, close = 0) =>
  out.push(` [${ms >= 1000 ? `${Math.round(ms / 1000)} sec` : `${ms} ms`}]${ms >= 1000 ? '   ' : '    '}[${scope} ${line}] : ${code}${close ? ' ' + Array(close).fill(C).join(' ') : ''}`)
const open = (scope: string) => out.push(` \t${scope} ${O}`)
const d = (s: string) => out.push(`\t${s}`)

out.push('TROIA CODE EXECUTION TRACE', '', `TRACE INFORMATION${O}`, sep, '', 'LOGIN INFORMATION ')
for (const [k, v] of [['Client', '00'], ['Language', 'T'], ['Database', 'DEMO'], ['DB Server', 'CANIAS'], ['Server', 'demo-server:27499/iasClientManager'], ['User Name', 'demo.kullanici'], ['Session ID', 'demo.kullanici_0000000000'], ['Login Date', '12.10.2026 10:15:00']])
  out.push(`${k.padEnd(21)}: [${v}] `)
out.push(sep, '', 'GENERAL INFORMATION ')
for (const [k, v] of [['CANIAS Version', '9.03'], ['DB Vendor', 'Microsoft SQL Server']]) out.push(`${k.padEnd(21)}: [${v}] `)
out.push(sep, '', 'TRACE INFORMATION ')
for (const [k, v] of [['Transaction', 'SALT01'], ['Trace Date', 'Mon Oct 12 10:30:00 TRT 2026']]) out.push(`${k.padEnd(21)}: [${v}] `)
out.push(sep, '', 'DIALOG CROSS REFERENCES ', '[Old Dialog] -> [New Dialog] ', 'SALT01F001 -> DMOSALT01F001, (SYSDLGREF) ', sep + C, '')

const EV = 'DMOSALT01F001.SAVE.2'
const CLS = '(DMOSALESITEM.CSALESITEM) CSALESITEMREC'
open(EV)
st(0, EV, 2, 'OBJECT: INTEGER ROWCNT, DECIMAL TOTAL; ')
d('->DB [SELECT * FROM IASSALITEM WHERE CLIENT = \'00\' AND DOCNUM = \'S-2026-0042\']')
st(14, EV, 4, 'SELECT  *\tFROM IASSALITEM\tWHERE CLIENT = SYS_CLIENT AND DOCNUM = DOCNUM')
d(' INTO ITEMS ')
d('[SELECTED[1], NOTSELECTED[0], SYS_STATUS[0]]')
d('[Number of rows : 24]')
st(1, EV, 6, 'LOOP AT ITEMS BEGIN   : TOTAL 24 ROWS')
for (let i = 1; i <= 24; i++) {
  d(`+ACTIVE ROW: ${i} at ITEMS`)
  open(`${CLS}.GETPRICE.0`)
  st(0, `${CLS}.GETPRICE.0`, 2, 'PARAMETERS ')
  d(`PMATERIAL[M-${1000 + i}] <= ITEMS_MATERIAL[M-${1000 + i}]`)
  const cached = i % 4 === 0
  d(`->DB${cached ? ' CACHE' : ''} [SELECT PRICE, CURRENCY FROM IASSALPRICE WHERE CLIENT = '00' AND MATERIAL = 'M-${1000 + i}']`)
  st(cached ? 0 : 6 + (i % 5), `${CLS}.GETPRICE.0`, 5, 'SELECT  PRICE, CURRENCY\tFROM IASSALPRICE\tWHERE CLIENT = SYS_CLIENT AND MATERIAL = PMATERIAL')
  d(' INTO TMPPRICE ')
  d('[Number of rows : 1]')
  st(0, `${CLS}.GETPRICE.0`, 7, 'RETURN TMPPRICE_PRICE  : TMPPRICE_PRICE[12.5]', 1)
  st(cached ? 0 : 8 + (i % 5), EV, 8, `ITEMS_PRICE = ${CLS.split(' ')[1]}.GETPRICE(ITEMS_MATERIAL); [12.5]`)
  st(0, EV, 9, 'LOCATERECORD SEQUENTIAL COLUMNS MATERIAL VALUES ITEMS ON STOCKTAB  ')
  d(`MATERIAL:M-${1000 + i}`)
  st(0, EV, 10, 'TOTAL = TOTAL + ITEMS_PRICE * ITEMS_QUANTITY; [' + (i * 25) + ']')
  st(0, EV, 11, `IF ITEMS_QUANTITY > 100 THEN : ITEMS_QUANTITY[${i * 3}] > 100[100] -> ${i * 3 > 100 ? 1 : 0}`)
  d('-ELSE BLOCK ENDED')
}
d('ENDLOOP')
st(0, EV, 14, 'IF TOTAL > 500 THEN : TOTAL[600] > 500[500] -> 1')
d('+TRUE BLOCK STARTED')
st(2, EV, 15, "MESSAGE SAL W1043 WITH TOTAL  : MSG[Sipariş toplamı kredi limitine yaklaştı]")
d('-TRUE BLOCK ENDED')
d("->DB [UPDATE IASSALHEAD SET TOTAL = 600 WHERE CLIENT = '00' AND DOCNUM = 'S-2026-0042']")
st(1240, EV, 18, 'UPDATE IASSALHEAD SET TOTAL = TOTAL WHERE CLIENT = SYS_CLIENT AND DOCNUM = DOCNUM')
d('[Number of rows : 1]')
st(0, EV, 20, 'RETURN 1 ', 1)

writeFileSync('public/sample-trace.txt', out.join('\r\n') + '\r\n')
console.log(`wrote ${out.length} lines`)
