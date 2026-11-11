// ทดสอบสถิติบอท AI · รัน: node src/lib/aiStats.test.mjs
import assert from 'node:assert/strict'
import { summarizeAiLog, thaiDay, shiftDay } from './aiStats.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

t('วันไทย: 23:30 UTC = วันถัดไปเวลาไทย', () => {
  assert.equal(thaiDay('2026-11-11T23:30:00Z'), '2026-11-12')
  assert.equal(thaiDay('2026-11-11T16:59:00Z'), '2026-11-11')
})
t('shiftDay ข้ามเดือน', () => {
  assert.equal(shiftDay('2026-11-01', -1), '2026-10-31')
  assert.equal(shiftDay('2026-11-11', -6), '2026-11-05')
})

// now = 2026-11-11 12:00 เวลาไทย (05:00 UTC)
const now = new Date('2026-11-11T05:00:00Z')
const rows = [
  { id: 'a', status: 'ok', model: 'm', ms: 1000, at: '2026-11-11T04:00:00Z' },
  { id: 'b', status: 'ok', model: 'm', ms: 3000, at: '2026-11-11T03:00:00Z' },
  { id: 'c', status: 'handoff', model: 'm', ms: 500, at: '2026-11-11T02:00:00Z' },
  { id: 'd', status: 'error', model: 'm', ms: 10000, at: '2026-11-10T02:00:00Z' },
  { id: 'e', status: 'limit', model: 'm', at: '2026-11-11T01:00:00Z' }, // ครบเพดาน: ไม่นับในการใช้งาน/เวลาเฉลี่ย
  { id: 'f', status: 'ok', model: 'm', ms: 2000, at: '2026-11-01T00:00:00Z' }, // นอก 7 วัน
  { id: 'g', status: 'weird', at: '2026-11-11T01:00:00Z' }, // สถานะไม่รู้จัก → ข้าม
]

t('สรุปวันนี้: ใช้ไป = ok+handoff+error, limit ไม่นับ', () => {
  const s = summarizeAiLog(rows, { now })
  assert.equal(s.today.ok, 2)
  assert.equal(s.today.handoff, 1)
  assert.equal(s.today.error, 0)
  assert.equal(s.today.limit, 1)
  assert.equal(s.today.used, 3)
})
t('เวลาเฉลี่ยไม่รวมครบเพดาน และรวมทุกวันใน 7 วัน', () => {
  const s = summarizeAiLog(rows, { now })
  // ok 1000, 3000 · handoff 500 · error 10000 (ของเมื่อวาน) → เฉลี่ย (1000+3000+500+10000)/4
  assert.equal(s.avgMs, Math.round(14500 / 4))
})
t('byDay: 7 วันล่าสุด เรียงเก่า→ใหม่ และไม่รวมข้อมูลนอกช่วง', () => {
  const s = summarizeAiLog(rows, { now })
  assert.equal(s.byDay.length, 7)
  assert.equal(s.byDay[6].day, '2026-11-11')
  assert.equal(s.byDay[0].day, '2026-11-05')
  assert.equal(s.byDay[5].error, 1) // 2026-11-10
  assert.equal(s.byDay[6].ok, 2)
  // a,b,c,e (11 พ.ย.) + d (10 พ.ย.) = 5 · f อยู่นอกช่วง, g สถานะไม่รู้จักถูกข้าม
  assert.equal(s.byDay.reduce((n, d) => n + d.total, 0), 5)
})
t('recent: เรียงล่าสุดก่อน และตัดตามจำนวนที่กำหนด', () => {
  const s = summarizeAiLog(rows, { now, recentLimit: 3 })
  // เรียงตามเวลา (ล่าสุดก่อน): a 04:00Z > b 03:00Z > c 02:00Z
  assert.deepEqual(s.recent.map((r) => r.id), ['a', 'b', 'c'])
})
t('ไม่มีข้อมูล: ค่าว่างทั้งหมด ไม่พัง', () => {
  const s = summarizeAiLog([], { now })
  assert.equal(s.today.used, 0)
  assert.equal(s.avgMs, null)
  assert.equal(s.recent.length, 0)
})

console.log(`ALL PASS (${pass})`)
