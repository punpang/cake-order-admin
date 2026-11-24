// ทดสอบฟังก์ชันล้วนของแคมเปญสั่งล่วงหน้า (ตรวจ/วันรับ/สถานะ/แปลงแถว) · รัน: node src/lib/preorderCampaign.test.mjs
import assert from 'node:assert/strict'
import { blankCampaign, campaignError, pickupDays, campaignPhase, campaignToRow, rowToCampaign } from './preorderCampaign.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const valid = () => ({
  ...blankCampaign(),
  id: 'pc1', name: 'เค้กคริสต์มาส', status: 'open',
  orderFrom: '2026-12-01', orderTo: '2026-12-15',
  pickupFrom: '2026-12-24', pickupTo: '2026-12-26',
  payDueMin: 120,
  items: [{ retailId: 'A', dayCap: 2 }, { retailId: 'B', dayCap: null }],
})

t('blankCampaign: มัดจำตั้งต้น 50 และไม่มีค่าตั้งต้นของเวลาจ่าย', () => {
  const c = blankCampaign()
  assert.equal(c.depositPercent, 50)
  assert.equal(c.payDueMin, null)
  assert.equal(c.dayCap, null)
  assert.deepEqual(c.items, [])
})

t('campaignError: แคมเปญครบถ้วนผ่าน', () => {
  assert.equal(campaignError(valid()), '')
})

t('campaignError: เวลาจ่ายว่างหรือไม่ใช่จำนวนเต็ม > 0 → ไม่ผ่าน', () => {
  for (const v of [null, 0, -5, 1.5]) assert.notEqual(campaignError({ ...valid(), payDueMin: v }), '', `ค่า ${v} ควรไม่ผ่าน`)
})

t('campaignError: ชื่อว่าง ไม่มีสินค้า สินค้าซ้ำ หรือเพดานติดลบ/ทศนิยม → ไม่ผ่าน', () => {
  assert.notEqual(campaignError({ ...valid(), name: '  ' }), '')
  assert.notEqual(campaignError({ ...valid(), items: [] }), '')
  assert.notEqual(campaignError({ ...valid(), items: [{ retailId: 'A', dayCap: 1 }, { retailId: 'A', dayCap: 2 }] }), '')
  assert.notEqual(campaignError({ ...valid(), items: [{ retailId: 'A', dayCap: -1 }] }), '')
  assert.notEqual(campaignError({ ...valid(), items: [{ retailId: 'A', dayCap: 1.5 }] }), '')
  assert.notEqual(campaignError({ ...valid(), dayCap: -3 }), '')
})

t('campaignError: เปอร์เซ็นต์มัดจำนอก 1–100 หรือไม่ใช่จำนวนเต็ม → ไม่ผ่าน', () => {
  for (const v of [0, 101, 49.5]) assert.notEqual(campaignError({ ...valid(), depositPercent: v }), '', `มัดจำ ${v} ควรไม่ผ่าน`)
  assert.equal(campaignError({ ...valid(), depositPercent: 100 }), '')
})

t('campaignError: ช่วงวันผิดลำดับหรือรูปแบบผิด → ไม่ผ่าน', () => {
  assert.notEqual(campaignError({ ...valid(), orderFrom: '2026-12-20', orderTo: '2026-12-10' }), '')
  assert.notEqual(campaignError({ ...valid(), pickupFrom: '2026-12-30', pickupTo: '2026-12-24' }), '')
  assert.notEqual(campaignError({ ...valid(), pickupFrom: '24/12/2026' }), '')
  assert.notEqual(campaignError({ ...valid(), pickupTo: '2026-02-30' }), '')
})

t('pickupDays: ข้ามเดือนและข้ามปี', () => {
  assert.deepEqual(pickupDays({ pickupFrom: '2026-12-30', pickupTo: '2027-01-02' }),
    ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
})

t('pickupDays: แคมเปญวันเดียว และช่วงผิด', () => {
  assert.deepEqual(pickupDays({ pickupFrom: '2026-12-24', pickupTo: '2026-12-24' }), ['2026-12-24'])
  assert.deepEqual(pickupDays({ pickupFrom: '2026-12-26', pickupTo: '2026-12-24' }), [])
})

t('campaignPhase: สถานะร่างและปิดรับตามค่า status', () => {
  assert.equal(campaignPhase({ ...valid(), status: 'draft' }, '2026-12-05'), 'draft')
  assert.equal(campaignPhase({ ...valid(), status: 'closed' }, '2026-12-05'), 'closed')
})

t('campaignPhase: เปิดรับ — ก่อน/ระหว่าง/หลังช่วง (วันขอบยังเปิด)', () => {
  const c = valid()
  assert.equal(campaignPhase(c, '2026-11-30'), 'upcoming')
  assert.equal(campaignPhase(c, '2026-12-01'), 'open')
  assert.equal(campaignPhase(c, '2026-12-15'), 'open')
  assert.equal(campaignPhase(c, '2026-12-16'), 'ended')
})

t('campaignToRow/rowToCampaign: วนกลับได้ค่าเท่าเดิม และ dayCap null ไม่กลายเป็น 0', () => {
  const c = valid()
  const back = rowToCampaign(campaignToRow(c))
  assert.equal(back.id, 'pc1')
  assert.equal(back.payDueMin, 120)
  assert.equal(back.dayCap, null)
  assert.equal(back.items[1].dayCap, null)
  assert.deepEqual(back.items.map((i) => i.retailId), ['A', 'B'])
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
