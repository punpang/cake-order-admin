// ทดสอบการ์ดสมาชิกฝั่งลูกค้า: หลอดวันหมดสิทธิ · ค่าที่แสดงด้านหน้า
// รัน: node src/lib/memberCard.test.mjs
import assert from 'node:assert/strict'
import { validityPct, memberCardView, progressToNext, VALIDITY_WINDOW_DAYS } from './memberCard.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }
const NOW = new Date('2026-11-27T05:00:00Z')
const active = (downgradeAt) => ({ enabled: true, status: 'active', levelName: 'LV4', mult: 5, levelNo: 4, activeUntil: downgradeAt, downgradeAt })

t('หลอด: เหลือ 365 วัน = 100%', () => {
  assert.equal(validityPct(active('2027-11-27'), NOW), 100)
})
t('หลอด: เหลือครึ่งปี ≈ 50%', () => {
  const pct = validityPct(active('2027-05-28'), NOW)
  assert.ok(pct >= 49 && pct <= 51, String(pct))
})
t('หลอด: หมดแล้ว = 0', () => {
  assert.equal(validityPct(active('2026-11-01'), NOW), 0)
})
t('หลอด: ไม่ active หรือไม่มีวันที่ = 0', () => {
  assert.equal(validityPct({ enabled: true, status: 'paused', downgradeAt: '2027-01-01' }, NOW), 0)
  assert.equal(validityPct({ enabled: true, status: 'active' }, NOW), 0)
  assert.equal(validityPct(null, NOW), 0)
  assert.equal(validityPct({ enabled: false }, NOW), 0)
})
t('หลอด: ไม่เกิน 100 แม้วันที่ไกลกว่าช่วง', () => {
  assert.equal(validityPct(active('2030-01-01'), NOW), 100)
  assert.equal(VALIDITY_WINDOW_DAYS, 365)
})
t('การ์ด: เบอร์จัดรูป คะแนนเป็นจำนวนเต็ม ชื่อระดับและบรรทัดแรก', () => {
  const v = memberCardView({ phone: '0864735562', points: 5954.9 }, active('2027-11-27'), NOW)
  assert.equal(v.phone, '086-473-5562')
  assert.equal(v.points, 5954)
  assert.equal(v.levelName, 'LV4')
  assert.match(v.line, /^LV4 · แต้มคูณ 5 เท่า$/)
  assert.equal(v.validPct, 100)
})
t('การ์ด: ไม่มีระดับ ไม่แสดงชื่อระดับและหลอด', () => {
  const v = memberCardView({ phone: '0864735562', points: 0 }, { enabled: false }, NOW)
  assert.equal(v.levelName, null)
  assert.equal(v.line, '')
  assert.equal(v.validPct, 0)
  assert.equal(v.points, 0)
})


t('ยอดสะสม: กลางทาง คำนวณเปอร์เซ็นต์และยอดที่ขาดแบบปัดขึ้น', () => {
  const p = progressToNext({ enabled: true, cum: 2500, nextMin: 5000, levelName: 'LV3' })
  assert.equal(p.top, false)
  assert.equal(p.pct, 50)
  assert.equal(p.remaining, 2500)
})
t('ยอดสะสม: เกินเกณฑ์แล้วเต็มหลอดและเหลือ 0', () => {
  const p = progressToNext({ enabled: true, cum: 5200, nextMin: 5000 })
  assert.equal(p.pct, 100)
  assert.equal(p.remaining, 0)
})
t('ยอดสะสม: ระดับสูงสุด (nextMin เป็น null) แสดงว่าสูงสุดแล้ว', () => {
  const p = progressToNext({ enabled: true, cum: 5057, nextMin: null })
  assert.equal(p.top, true)
  assert.equal(p.remaining, 0)
})
t('ยอดสะสม: ทศนิยมปัดขึ้นเป็นบาท', () => {
  assert.equal(progressToNext({ enabled: true, cum: 499.2, nextMin: 500 }).remaining, 1)
})
t('การ์ด: ส่งความคืบหน้าและชื่อระดับถัดไปถึงหน้าจอ', () => {
  const v = memberCardView({ phone: '0864735562', points: 10 }, { enabled: true, levelName: 'LV2', mult: 2, levelNo: 2, status: 'active', cum: 1200, nextMin: 2500, nextName: 'LV3', downgradeAt: '2027-11-27' }, NOW)
  assert.equal(v.progress.pct, 48)
  assert.equal(v.progress.remaining, 1300)
  assert.equal(v.progress.nextName, 'LV3')
})

t('การ์ด: ส่งตัวคูณของระดับถัดไปถึงหน้าจอ และไม่มีค่าเมื่อไม่ได้ส่งมา', () => {
  const v = memberCardView({ phone: '0864735562', points: 10 }, { enabled: true, levelName: 'LV2', mult: 2, levelNo: 2, status: 'active', cum: 1200, nextMin: 2500, nextName: 'LV3', nextMult: 3, downgradeAt: '2027-11-27' }, NOW)
  assert.equal(v.progress.nextMult, 3)
  const w = memberCardView({ phone: '0864735562', points: 10 }, { enabled: true, levelName: 'LV4', mult: 5, levelNo: 4, status: 'active', cum: 5200, nextMin: null, nextName: null, nextMult: null, downgradeAt: '2027-11-27' }, NOW)
  assert.equal(w.progress.nextMult, null)
  const x = memberCardView({ phone: '0864735562', points: 10 }, { enabled: true, levelName: 'LV2', mult: 2, levelNo: 2, status: 'active', cum: 1200, nextMin: 2500, nextName: 'LV3', downgradeAt: '2027-11-27' }, NOW)
  assert.equal(x.progress.nextMult, null)
})

console.log(fail ? `ล้มเหลว ${fail} รายการ` : 'ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
