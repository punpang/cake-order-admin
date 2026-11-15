// ทดสอบกติกาการผูกสลิปในแชท (โหมดแมนนวล) · รัน: node src/lib/slipBind.test.mjs
import assert from 'node:assert/strict'
import { pendingCustomerTotal, slipRoom, slipChoices, slipBindError, SLIP_RECEIVE_NOTE } from './slipBind.js'
import { PAY_MSG } from './payFields.js'

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('ยอดรอตรวจที่ลูกค้าแจ้งเอง: นับเฉพาะ reported + customerSubmitted', () => {
  const pays = [
    { status: 'reported', customerSubmitted: true, amount: 100 },
    { status: 'reported', amount: 500 }, // พนักงานแจ้งเอง ไม่นับ
    { status: 'confirmed', customerSubmitted: true, amount: 300 }, // ยืนยันแล้ว ไม่นับ
    { status: 'cancelled', customerSubmitted: true, amount: 200 }, // ยกเลิกแล้ว ไม่นับ
  ]
  assert.equal(pendingCustomerTotal(pays), 100)
  assert.equal(pendingCustomerTotal(undefined), 0)
})

t('ยอดที่ผูกได้ = ยอดคงค้าง − ยอดรอตรวจ และไม่ติดลบ', () => {
  assert.equal(slipRoom(540, []), 540)
  assert.equal(slipRoom(540, [{ status: 'reported', customerSubmitted: true, amount: 200 }]), 340)
  assert.equal(slipRoom(540, [{ status: 'reported', customerSubmitted: true, amount: 540 }]), 0)
  assert.equal(slipRoom(0, []), 0)
  assert.equal(slipRoom(-20, []), 0)
  assert.equal(slipRoom(100.1, [{ status: 'reported', customerSubmitted: true, amount: 100 }]), 0.1)
})

t('ตัวเลือกออร์เดอร์: แนะนำขึ้นก่อน แล้วตามด้วยออร์เดอร์อื่นของลูกค้าคนเดียวกันที่ยังไม่ปิด', () => {
  const orders = [
    { id: 'a', customerId: 'c1', status: 'awaiting_payment', channel: 'facebook' },
    { id: 'b', customerId: 'c1', status: 'draft', channel: 'facebook' },
    { id: 'c', customerId: 'c1', status: 'cancelled', channel: 'facebook' },
    { id: 'd', customerId: 'c1', status: 'payment_reported', channel: 'pos' },
    { id: 'e', customerId: 'c1', status: 'preparing', channel: 'facebook' },
    { id: 'f', customerId: 'c2', status: 'awaiting_payment', channel: 'facebook' },
  ]
  const { suggested, others } = slipChoices({ suggestedId: 'a', orders, customerId: 'c1' })
  assert.equal(suggested.id, 'a')
  assert.deepEqual(others.map((o) => o.id), ['e'])
})

t('ไม่มีออร์เดอร์แนะนำ → แสดงเฉพาะออร์เดอร์ของลูกค้า', () => {
  const orders = [{ id: 'x', customerId: 'c1', status: 'awaiting_payment', channel: 'facebook' }]
  assert.deepEqual(slipChoices({ suggestedId: null, orders, customerId: 'c1' }), { suggested: null, others: [orders[0]] })
})

t('แชทที่ยังไม่ผูกลูกค้า → ไม่มีออร์เดอร์อื่นให้เลือก แต่ออร์เดอร์แนะนำยังแสดง', () => {
  const orders = [{ id: 'x', customerId: 'c1', status: 'awaiting_payment', channel: 'facebook' }]
  const r = slipChoices({ suggestedId: 'x', orders, customerId: null })
  assert.equal(r.suggested.id, 'x')
  assert.deepEqual(r.others, [])
})

t('ข้อความบันทึกการผูก: ระบุว่าพนักงานผูกเองและยังไม่ได้ตรวจยอดกับธนาคาร', () => {
  assert.match(SLIP_RECEIVE_NOTE, /รับชำระ/)
  assert.match(SLIP_RECEIVE_NOTE, /ยังไม่ได้ตรวจยอด/)
})

// กติกาก่อนผูก: เวลาคงที่ (ไทย 10:00 วันที่ 11 พ.ย. 2026) · ออร์เดอร์สร้าง 09:00
const NOW = Date.parse('2026-11-11T10:00:00+07:00')
const base = { slip: { status: 'manual', slipRef: 'sb://punpang-slips/manual/ch1/a.jpg', ref: 'A1B2C3D4E5F6G7H8' }, room: 540, amount: 540, paidAt: '2026-11-11T09:30', createdAt: '2026-11-11T09:00:00+07:00', nowMs: NOW }

t('ผูกสลิป: ข้อมูลครบและผ่านทุกกติกา → ว่าง (ผ่าน)', () => {
  assert.equal(slipBindError(base), '')
})

t('ผูกสลิป: สลิปที่ไม่ได้รอผูก (อัตโนมัติ/ผูกแล้ว/ไม่มีรูป) → ไม่ผ่าน', () => {
  assert.equal(slipBindError({ ...base, slip: { ...base.slip, status: 'matched' } }), 'สลิปนี้ไม่ได้รอรับชำระ')
  assert.equal(slipBindError({ ...base, slip: { status: 'manual', ref: 'A1B2C3D4E5F6G7H8' } }), 'สลิปนี้ไม่ได้รอรับชำระ')
  assert.equal(slipBindError({ ...base, slip: undefined }), 'สลิปนี้ไม่ได้รอรับชำระ')
})

t('ผูกสลิป: ออร์เดอร์ร่าง/ยกเลิก/หน้าร้าน → ไม่ผ่าน', () => {
  assert.equal(slipBindError({ ...base, orderInactive: true }), 'ออร์เดอร์นี้รับยอดจากสลิปไม่ได้')
})

t('ผูกสลิป: ยอดผูกได้เป็นศูนย์ (ชำระครบ/มียอดรอตรวจ) → ไม่ผ่าน', () => {
  assert.equal(slipBindError({ ...base, room: 0 }), 'ออร์เดอร์นี้ชำระครบแล้ว หรือมียอดรอตรวจอยู่แล้ว')
})

t('ผูกสลิป: ยอดต้องมากกว่า 0 และไม่เกินยอดที่ผูกได้', () => {
  assert.equal(slipBindError({ ...base, amount: 0 }), 'กรอกยอดเงิน')
  assert.equal(slipBindError({ ...base, amount: NaN }), 'กรอกยอดเงิน')
  assert.match(slipBindError({ ...base, amount: 540.5 }), /^ยอดเกินยอดที่รับได้/)
  assert.equal(slipBindError({ ...base, amount: 540.004 }), '') // ยอมคลาดเคลื่อนไม่เกินสตางค์
})

t('ผูกสลิป: วัน-เวลาชำระ ต้องมี ไม่ก่อนวันสร้างออร์เดอร์ และไม่เกินเวลาปัจจุบัน', () => {
  assert.equal(slipBindError({ ...base, paidAt: '' }), PAY_MSG.txn)
  assert.equal(slipBindError({ ...base, paidAt: '2026-11-11T08:59' }), PAY_MSG.beforeOrder)
  assert.equal(slipBindError({ ...base, paidAt: '2026-11-11T10:30' }), PAY_MSG.future)
})

t('ผูกสลิป: เลขอ้างอิงว่าง หรือถูกใช้แล้ว → ไม่ผ่าน', () => {
  assert.equal(slipBindError({ ...base, slip: { ...base.slip, ref: '' } }), PAY_MSG.ref)
  assert.equal(slipBindError({ ...base, refUsed: true }), PAY_MSG.refTaken)
})

let pass = 0
for (const [name, fn] of cases) {
  fn()
  pass++
  console.log(`ok - ${name}`)
}
console.log(`\n${pass}/${cases.length} ผ่าน`)
