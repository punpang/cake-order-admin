// ทดสอบระดับสมาชิก (ค่าตั้งค่า/ข้อความบัตร/ต้นทุนประมาณการ) · รัน: node src/lib/memberLevels.test.mjs
import assert from 'node:assert/strict'
import { DEFAULT_MEMBER_CFG, levelCost, memberCfgErrors, tierLines } from './memberLevels.js'

let fail = 0
const t = (name, fn) => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL ${name}: ${e.message}`)
  }
}
const cfg = (over = {}) => ({ ...structuredClone(DEFAULT_MEMBER_CFG), ...over })

t('ค่าตั้งต้นใช้ได้ (ไม่มีข้อผิดพลาด)', () => {
  assert.deepEqual(memberCfgErrors(DEFAULT_MEMBER_CFG), [])
})
t('โหมดนอกเหนือจาก off/shadow/live = ไม่ผ่าน', () => {
  assert.ok(memberCfgErrors(cfg({ mode: 'turbo' })).includes('โหมดไม่ถูกต้อง'))
})
t('ไม่มีระดับ หรือเกิน 10 ขั้น = ไม่ผ่าน', () => {
  assert.ok(memberCfgErrors(cfg({ levels: [] })).includes('ต้องมีระดับ 1–10 ขั้น'))
  assert.ok(memberCfgErrors(cfg({ levels: Array.from({ length: 11 }, (_, i) => ({ name: `L${i}`, min: i * 10, mult: 1 })) })).includes('ต้องมีระดับ 1–10 ขั้น'))
})
t('ขั้นแรกต้องเริ่มที่ 0', () => {
  assert.ok(memberCfgErrors(cfg({ levels: [{ name: 'LV1', min: 10, mult: 1 }] })).includes('ขั้นแรกต้องเริ่มที่ยอดสะสม 0'))
})
t('เกณฑ์ต้องเพิ่มขึ้นทุกขั้น (เท่ากันหรือน้อยกว่าไม่ได้)', () => {
  const e = memberCfgErrors(cfg({ levels: [{ name: 'LV1', min: 0, mult: 1 }, { name: 'LV2', min: 500, mult: 3 }, { name: 'LV3', min: 400, mult: 5 }] }))
  assert.ok(e.includes('ขั้นที่ 3: เกณฑ์ต้องมากกว่าขั้นก่อนหน้า'))
})
t('ตัวคูณต้อง ≥ 1 และชื่อระดับต้องไม่ว่าง', () => {
  const e = memberCfgErrors(cfg({ levels: [{ name: ' ', min: 0, mult: 0.5 }] }))
  assert.ok(e.includes('ขั้นที่ 1: ตัวคูณต้องเป็นตัวเลข ≥ 1'))
  assert.ok(e.includes('ขั้นที่ 1: ใส่ชื่อระดับ'))
})
t('ค่าที่ไม่ใช่ตัวเลข (เช่นข้อความ) = ไม่ผ่าน', () => {
  assert.ok(memberCfgErrors(cfg({ renewGross: '150' })).includes('renewGross ต้องเป็นตัวเลข'))
})
t('เกณฑ์ต่ออายุ ≤ 0 / ช่วงใช้งาน < 1 / วันทองติดลบ / บิลใหญ่ติดลบ = ไม่ผ่าน', () => {
  assert.ok(memberCfgErrors(cfg({ renewGross: 0 })).includes('เกณฑ์ต่ออายุต้องมากกว่า 0'))
  assert.ok(memberCfgErrors(cfg({ inactiveDays: 0 })).includes('ช่วงใช้งานต้องอย่างน้อย 1 วัน'))
  assert.ok(memberCfgErrors(cfg({ goldenDays: -1 })).includes('วันทองต้องไม่ติดลบ'))
  assert.ok(memberCfgErrors(cfg({ bigBill: -5 })).includes('บิลใหญ่ต้องไม่ติดลบ'))
})
t('รอบลดขั้นต้องมากกว่าช่วงใช้งาน (90 วันเท่ากันไม่ได้)', () => {
  assert.ok(memberCfgErrors(cfg({ downgradeDays: 90 })).includes('รอบลดขั้นต้องมากกว่าช่วงใช้งาน'))
})

t('บัตรระดับปิดอยู่ = ไม่มีข้อความ', () => {
  assert.deepEqual(tierLines({ enabled: false }), [])
  assert.deepEqual(tierLines(null), [])
})
t('บัตรใช้งานอยู่: บรรทัดระดับ + วันสิ้นสุดสิทธิ์ (ไม่เกิน 3 บรรทัด ไม่มียอดสะสม)', () => {
  const lines = tierLines({ enabled: true, levelNo: 2, levelName: 'LV2', mult: 3, status: 'active', golden: false, activeUntil: '2027-02-12', downgradeAt: '2027-11-14' })
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^LV2 · แต้มคูณ 3 เท่า$/)
  assert.ok(lines.every((l) => !/ยอด|cum|ledger/i.test(l)))
})
t('ระดับ 1 (ตัวคูณ 1) แสดงแต้มปกติ และไม่เกิน 3 บรรทัดแม้มีทุกเงื่อนไข', () => {
  const lines = tierLines({ enabled: true, levelName: 'LV1', mult: 1, status: 'paused', golden: true, activeUntil: null, downgradeAt: null })
  assert.match(lines[0], /แต้มปกติ/)
  assert.ok(lines.length <= 3)
})

t('ต้นทุนประมาณการ LV4 (x10) ต่อยอด 1,000 บาท เมื่อ 10 บาท = 1 แต้ม มูลค่า 0.10 บาท แลก 40%', () => {
  const r = levelCost({ mult: 10, base: 1000, earnPer: 10, pointValue: 0.1, redeem: 0.4 })
  assert.equal(Math.round(r.extraPoints), 900)
  assert.equal(Math.round(r.costBaht * 100) / 100, 36)
  assert.equal(Math.round(r.costPct * 100) / 100, 3.6)
})
t('ตัวคูณ 1 ไม่มีต้นทุนเพิ่ม และยอด 0 ไม่หารศูนย์', () => {
  assert.equal(levelCost({ mult: 1, base: 1000, earnPer: 10, pointValue: 0.1, redeem: 0.4 }).costBaht, 0)
  assert.equal(levelCost({ mult: 3, base: 0, earnPer: 10, pointValue: 0.1, redeem: 0.4 }).costPct, 0)
})

if (fail) { console.log(`ผิดพลาด ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
