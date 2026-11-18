// ทดสอบตัวแปรสรุปยอดประจำวัน · รัน: node src/lib/dailySummary.test.mjs
import assert from 'node:assert/strict'
import { methodLines, dailySummaryVars } from './dailySummary.js'
import { money } from './format.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('methodLines: เรียงเงินสด โอน บัตร และข้ามช่องทางที่เป็นศูนย์', () => {
  assert.deepEqual(methodLines({ card: 200, cash: 1200, transfer: 0 }), [`• เงินสด ${money(1200)}`, `• บัตร ${money(200)}`])
})
t('methodLines: ช่องทางที่ไม่รู้จักยังแสดงด้วยชื่อเดิม', () => {
  assert.deepEqual(methodLines({ qr: 50 }), [`• qr ${money(50)}`])
})
t('methodLines: ไม่มีข้อมูลให้ได้รายการว่าง', () => {
  assert.deepEqual(methodLines({}), [])
  assert.deepEqual(methodLines(undefined), [])
})

const shift = { openedAt: '2026-11-20T02:00:00.000Z' }
const summary = { bills: 5, cancelled: 1, byMethod: { cash: 1000, transfer: 500 }, total: 1500, expectedCash: 1300 }

t('dailySummaryVars: ค่าครบตามสรุปกะ', () => {
  const v = dailySummaryVars({ shopName: 'ร้านทดสอบ', shift, summary, counted: 1300, closedBy: 'admin', closedAt: '2026-11-20T12:00:00.000Z' })
  assert.equal(v.ร้าน, 'ร้านทดสอบ')
  assert.equal(v.วันที่, '2026-11-20')
  assert.equal(v.บิล, '5')
  assert.equal(v.ยกเลิก, '1')
  assert.equal(v.ยอดสุทธิ, money(1500))
  assert.equal(v.เงินสดคาด, money(1300))
  assert.equal(v.เงินสดนับได้, money(1300))
  assert.equal(v.ส่วนต่าง, money(0))
  assert.equal(v.ปิดกะโดย, 'admin')
  assert.equal(v.ช่องทาง, `• เงินสด ${money(1000)}\n• โอนเงิน ${money(500)}`)
})
t('dailySummaryVars: เงินสดเกินแสดงเครื่องหมาย +', () => {
  const v = dailySummaryVars({ shift, summary, counted: 1350 })
  assert.equal(v.ส่วนต่าง, `+${money(50)}`)
})
t('dailySummaryVars: เงินสดขาดแสดงเป็นลบ', () => {
  const v = dailySummaryVars({ shift, summary, counted: 1200 })
  assert.equal(v.ส่วนต่าง, money(-100))
})
t('dailySummaryVars: ไม่มีวันปิดกะ ใช้วันที่เปิดกะแทน', () => {
  assert.equal(dailySummaryVars({ shift, summary }).วันที่, '2026-11-20')
})
t('dailySummaryVars: ไม่มีสรุปก็ไม่ล้ม', () => {
  const v = dailySummaryVars({ shift })
  assert.equal(v.บิล, '0')
  assert.equal(v.ช่องทาง, '')
})

if (fail) { console.log(`\n${fail} ข้อล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
