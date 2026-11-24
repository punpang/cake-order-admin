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

// ---- เฟส 2B: ส่วนลดตามยอด (deals) และการส่งพัสดุ (parcel) ----
const spendDeal = (tiers) => ({ kind: 'spend_off', name: 'ครบยอดลด', tiers })
t('2B: blankCampaign มี deals ว่างและ parcel ปิดอยู่', () => {
  assert.deepEqual(blankCampaign().deals, [])
  assert.deepEqual(blankCampaign().parcel, { enabled: false })
})
t('2B: ขั้นส่วนลดซ้ำยอดเดียวกัน → ไม่ผ่าน', () => {
  const c = { ...valid(), items: [{ retailId: 'A', dayCap: null }], deals: [spendDeal([{ min: 500, type: 'amount', value: 50 }, { min: 500, type: 'percent', value: 5 }])] }
  assert.equal(campaignError(c), 'ขั้นส่วนลดซ้ำยอดเดียวกัน')
})
t('2B: เปอร์เซ็นต์เกิน 100 → ไม่ผ่าน', () => {
  const c = { ...valid(), items: [{ retailId: 'A', dayCap: null }], deals: [spendDeal([{ min: 500, type: 'percent', value: 150 }])] }
  assert.equal(campaignError(c), 'ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100')
})
t('2B: min หรือ value ไม่ถูกต้อง → ไม่ผ่าน', () => {
  const a = { ...valid(), items: [{ retailId: 'A', dayCap: null }], deals: [spendDeal([{ min: 0, type: 'amount', value: 50 }])] }
  const b = { ...valid(), items: [{ retailId: 'A', dayCap: null }], deals: [spendDeal([{ min: 500, type: 'amount', value: 0 }])] }
  assert.match(campaignError(a), /ขั้นส่วนลดต้องเป็นจำนวนเต็มบาทหรือเปอร์เซ็นต์ที่มากกว่า 0/)
  assert.match(campaignError(b), /ขั้นส่วนลดต้องเป็นจำนวนเต็มบาทหรือเปอร์เซ็นต์ที่มากกว่า 0/)
})
t('2B: ดีลที่ไม่ใช่ spend_off ใช้ในแคมเปญไม่ได้', () => {
  const c = { ...valid(), items: [{ retailId: 'A', dayCap: null }], deals: [{ kind: 'bogo', name: 'x', tiers: [] }] }
  assert.equal(campaignError(c), 'ดีลนี้ใช้ในแคมเปญไม่ได้')
})
t('2B: parcel.enabled ต้องเป็น boolean', () => {
  const c = { ...valid(), items: [{ retailId: 'A', dayCap: null }], parcel: { enabled: 'yes' } }
  assert.equal(campaignError(c), 'ค่า parcel.enabled ต้องเป็น true/false')
})
t('2B: แคมเปญถูกต้องที่มีขั้นส่วนลดและพัสดุ → ผ่าน', () => {
  const c = { ...valid(), items: [{ retailId: 'A', dayCap: null }], deals: [spendDeal([{ min: 500, type: 'amount', value: 50 }, { min: 1000, type: 'percent', value: 8 }])], parcel: { enabled: true }, shipFrom: '2026-12-22', shipTo: '2026-12-23' }
  assert.equal(campaignError(c), '')
})
t('2B: round-trip แถวฐานข้อมูลเก็บ deals และ parcel', () => {
  const c = { ...valid(), items: [{ retailId: 'A', dayCap: null }], deals: [spendDeal([{ min: 500, type: 'amount', value: 50 }])], parcel: { enabled: true } }
  const back = rowToCampaign(campaignToRow(c))
  assert.deepEqual(back.deals, c.deals)
  assert.deepEqual(back.parcel, { enabled: true })
})
t('2B: แถวเก่าที่ไม่มี deals/parcel อ่านได้ค่าเริ่มต้น', () => {
  const r = { id: 'old', status: 'draft', order_from: '2026-12-01', order_to: '2026-12-15', pickup_from: '2026-12-24', pickup_to: '2026-12-26', deposit_percent: 50, pay_due_min: 120, data: { name: 'เก่า', dayCap: null, items: [] } }
  const c = rowToCampaign(r)
  assert.deepEqual(c.deals, [])
  assert.deepEqual(c.parcel, { enabled: false })
})

// ---- ช่วงวันจัดส่งพัสดุต่อแคมเปญ (ใช้เมื่อเปิดส่งพัสดุเท่านั้น) ----
const parcelOn = (extra = {}) => ({ ...valid(), parcel: { enabled: true }, shipFrom: '2026-12-22', shipTo: '2026-12-23', ...extra })
t('shipping: parcel เปิดแต่ไม่มีช่วงวันจัดส่ง → ไม่ผ่าน', () => {
  assert.equal(campaignError(parcelOn({ shipFrom: '', shipTo: '' })), 'ช่วงวันจัดส่งพัสดุต้องเป็นวันที่ที่ถูกต้อง')
})
t('shipping: วันจัดส่งรูปแบบผิดหรือวันที่ไม่มีจริง → ไม่ผ่าน', () => {
  assert.notEqual(campaignError(parcelOn({ shipFrom: '22/12/2026' })), '')
  assert.notEqual(campaignError(parcelOn({ shipTo: '2026-02-30' })), '')
})
t('shipping: วันเริ่มจัดส่งหลังวันสิ้นสุด → ไม่ผ่าน', () => {
  assert.equal(campaignError(parcelOn({ shipFrom: '2026-12-25', shipTo: '2026-12-22' })), 'วันเริ่มจัดส่งต้องไม่เกินวันสิ้นสุด')
})
t('shipping: วันเริ่มเท่ากับวันสิ้นสุด (วันเดียว) → ผ่าน', () => {
  assert.equal(campaignError(parcelOn({ shipFrom: '2026-12-23', shipTo: '2026-12-23' })), '')
})
t('shipping: parcel ปิด ไม่ต้องมีช่วงวันจัดส่ง → ผ่าน', () => {
  assert.equal(campaignError({ ...valid(), parcel: { enabled: false }, shipFrom: '', shipTo: '' }), '')
})
t('shipping: round-trip เก็บช่วงวันจัดส่งใน data.shipping', () => {
  const c = parcelOn()
  const row = campaignToRow(c)
  assert.deepEqual(row.data.shipping, { shipFrom: '2026-12-22', shipTo: '2026-12-23' })
  const back = rowToCampaign(row)
  assert.equal(back.shipFrom, '2026-12-22')
  assert.equal(back.shipTo, '2026-12-23')
})
t('shipping: แถวเก่าไม่มี shipping อ่านได้ค่าว่าง', () => {
  const r = { id: 'old', status: 'draft', order_from: '2026-12-01', order_to: '2026-12-15', pickup_from: '2026-12-24', pickup_to: '2026-12-26', deposit_percent: 50, pay_due_min: 120, data: { name: 'เก่า', dayCap: null, items: [] } }
  const c = rowToCampaign(r)
  assert.equal(c.shipFrom, '')
  assert.equal(c.shipTo, '')
})
t('shipping: blankCampaign มีช่วงวันจัดส่งว่าง', () => {
  assert.equal(blankCampaign().shipFrom, '')
  assert.equal(blankCampaign().shipTo, '')
})

// ---- คำเตือน (ไม่บล็อกการบันทึก): ช่วงจัดส่งอยู่นอกช่วงรับสินค้า ----
import { shipOutsidePickupWarning } from './preorderCampaign.js'
t('shipping warning: ช่วงจัดส่งอยู่ในช่วงรับ → ไม่มีคำเตือน', () => {
  assert.equal(shipOutsidePickupWarning(parcelOn({ shipFrom: '2026-12-24', shipTo: '2026-12-25' })), '')
})
t('shipping warning: ช่วงจัดส่งต่างจากช่วงรับ → มีคำเตือนและบันทึกได้ (ไม่ใช่ข้อผิดพลาด)', () => {
  const c = parcelOn({ shipFrom: '2026-12-20', shipTo: '2026-12-21' })
  assert.notEqual(shipOutsidePickupWarning(c), '')
  assert.equal(campaignError(c), '')
})
t('shipping warning: parcel ปิดหรือยังไม่กรอกวัน → ไม่มีคำเตือน', () => {
  assert.equal(shipOutsidePickupWarning({ ...valid(), parcel: { enabled: false } }), '')
  assert.equal(shipOutsidePickupWarning(parcelOn({ shipFrom: '', shipTo: '' })), '')
})

t('ขั้นส่วนลดค่าส่ง: บันทึกเป็นแถวและอ่านกลับได้ตรงกัน', () => {
  const c = { ...valid(), shipOff: [{ min: 300, value: 20 }, { min: 1000, value: 50 }] }
  assert.deepEqual(rowToCampaign(campaignToRow(c, 'pc1')).shipOff, [{ min: 300, value: 20 }, { min: 1000, value: 50 }])
})
t('ขั้นส่วนลดค่าส่ง: แถวเก่าไม่มีฟิลด์ → []', () => {
  assert.deepEqual(rowToCampaign({ id: 'x', data: {}, status: 'draft' }).shipOff, [])
})
t('ขั้นส่วนลดค่าส่ง: ขั้นไม่เรียง → แคมเปญบันทึกไม่ได้', () => {
  assert.notEqual(campaignError({ ...valid(), shipOff: [{ min: 1000, value: 50 }, { min: 300, value: 20 }] }), '')
})
t('ขั้นส่วนลดค่าส่ง: ค่าว่างบันทึกได้', () => {
  assert.equal(campaignError({ ...valid(), shipOff: [] }), '')
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
