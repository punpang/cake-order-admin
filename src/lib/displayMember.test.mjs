// ทดสอบข้อมูลสมาชิกบนจอลูกค้า (ปิดบัง + ระดับเฉพาะโหมดใช้จริง) · รัน: node src/lib/displayMember.test.mjs
import assert from 'node:assert/strict'
import { maskName, maskPhone, displayMember } from './displayMember.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const cust = { name: 'มานี ใจดี', phone: '081-234-5678' }
const liveCard = { enabled: true, mode: 'live', levelName: 'LV2', mult: 3, status: 'active', nextName: 'LV3', toNext: 2000, pct: 50 }

t('ชื่อแสดงแค่ตัวแรก + ●●●', () => assert.equal(maskName('มานี ใจดี'), 'ม●●●'))
t('ชื่อภาษาอังกฤษ/อีโมจิไม่แตกคู่อักษร', () => assert.equal(maskName('😀 x'), '😀●●●'))
t('ชื่อว่างไม่แสดงอะไร', () => assert.equal(maskName('  '), ''))
t('เบอร์แสดง 4 ตัวท้ายเท่านั้น', () => assert.equal(maskPhone('081-234-5678'), '•••••• 5678'))
t('เบอร์สั้นกว่า 4 หลักไม่แสดง', () => assert.equal(maskPhone('12'), ''))
t('ไม่มีลูกค้า = null', () => assert.equal(displayMember(null, liveCard, 10), null))
t('ข้อมูลที่ส่งไปจอไม่มีชื่อ/เบอร์เต็ม', () => {
  const s = JSON.stringify(displayMember(cust, liveCard, 10))
  assert.ok(!s.includes('มานี ใจดี') && !s.includes('081') && !s.includes('234'))
})
t('โหมดใช้จริง: มีระดับ ตัวคูณ และหลอดเลื่อนขั้น', () => {
  const d = displayMember(cust, liveCard, 25)
  assert.deepEqual(d.tier, { levelName: 'LV2', mult: 3, progress: true, nextName: 'LV3', toNext: 2000, pct: 50 })
  assert.equal(d.points, 25)
})
t('โหมดทดลอง: ไม่มีระดับ (ลูกค้าไม่เห็น)', () => {
  const d = displayMember(cust, { ...liveCard, mode: 'shadow' }, 25)
  assert.equal(d.tier, undefined)
  assert.equal(d.points, 25)
})
t('โหมดปิด/ไม่เปิดใช้: ไม่มีระดับ', () => {
  assert.equal(displayMember(cust, { enabled: false }, 0).tier, undefined)
  assert.equal(displayMember(cust, null, 0).tier, undefined)
})
t('ระดับสูงสุด: nextName ว่าง', () => {
  const d = displayMember(cust, { ...liveCard, levelName: 'LV4', mult: 10, nextName: null, toNext: null, pct: 100 }, 0)
  assert.equal(d.tier.nextName, '')
  assert.equal(d.tier.pct, 100)
})
t('RPC รุ่นเดิม (ไม่มี pct): แสดงระดับ แต่ไม่มีความคืบหน้า', () => {
  const old = { enabled: true, mode: 'live', levelName: 'LV1', mult: 2, status: 'active' }
  const d = displayMember(cust, old, 10)
  assert.equal(d.tier.progress, false)
  assert.equal(d.tier.nextName, '')
  assert.equal(d.tier.levelName, 'LV1')
})
t('ค่าผิดปกติถูกบีบให้อยู่ในช่วง (pct 0–100, toNext ≥ 0, แต้ม ≥ 0 จำนวนเต็ม)', () => {
  const d = displayMember(cust, { ...liveCard, pct: 250, toNext: -5 }, -3.7)
  assert.equal(d.tier.pct, 100)
  assert.equal(d.tier.toNext, 0)
  assert.equal(d.points, 0)
})

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1) }
console.log('\nALL PASS')
