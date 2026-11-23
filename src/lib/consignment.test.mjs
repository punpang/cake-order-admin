// ทดสอบสินค้าฝากขาย: ข้อตกลง · การตรวจกรอก · ยอดจ่ายผู้ฝากขาย · การสรุปรอบ · การกันรอบซ้ำซ้อน
import assert from 'node:assert/strict'
import { consignTermsError, consignTermsOf, overlapsRound, payoutOf, settlementOf, validRange } from './consignment.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }
const dayOf = (o) => o.day
const C = (name, payout, extra = {}) => ({ name, payout, percent: 0, fixed: 0, ...extra })
const line = (id, unitPrice, qty, consign, extra = {}) => ({ id, retailId: id, name: id, unitPrice, qty, kind: 'retail', consign, ...extra })
const ord = (id, day, items, status = 'delivered') => ({ id, code: id, day, status, items })

t('ข้อตกลงมาจากรายการที่ฝากขายเท่านั้น (ชื่อว่างใช้ไม่ได้)', () => {
  assert.equal(consignTermsOf({ name: 'x' }), null)
  assert.equal(consignTermsOf({ consign: { name: '  ', payout: 'percent', percent: 10 } }), null)
  assert.deepEqual(consignTermsOf({ consign: { name: 'คุณใหม่', payout: 'percent', percent: 30 } }), { name: 'คุณใหม่', payout: 'percent', percent: 30, fixed: 0 })
})

t('ตรวจข้อตกลงที่กรอก: ต้องมีชื่อ · เปอร์เซ็นต์ 0–100 · ค่าคงที่ 0 ขึ้นไป', () => {
  assert.match(consignTermsError({ consignment: true, consignorName: '', consignPayout: 'percent', consignPercent: 10 }), /ชื่อ/)
  assert.match(consignTermsError({ consignment: true, consignorName: 'ก', consignPayout: 'percent', consignPercent: 0 }), /เปอร์เซ็นต์/)
  assert.match(consignTermsError({ consignment: true, consignorName: 'ก', consignPayout: 'percent', consignPercent: 101 }), /เปอร์เซ็นต์/)
  assert.equal(consignTermsError({ consignment: true, consignorName: 'ก', consignPayout: 'percent', consignPercent: 100 }), '')
  assert.match(consignTermsError({ consignment: true, consignorName: 'ก', consignPayout: 'fixed', consignFixed: '' }), /ค่าคงที่/)
  assert.equal(consignTermsError({ consignment: true, consignorName: 'ก', consignPayout: 'fixed', consignFixed: 0 }), '')
  assert.equal(consignTermsError({ consignment: false }), '')
})

t('ยอดจ่าย: เปอร์เซ็นต์คิดจากยอดขาย · ค่าคงที่ไม่เกินยอดขาย', () => {
  assert.equal(payoutOf({ payout: 'percent', percent: 30, fixed: 0 }, 1000), 300)
  assert.equal(payoutOf({ payout: 'percent', percent: 33.33, fixed: 0 }, 100), 33.33)
  assert.equal(payoutOf({ payout: 'fixed', percent: 0, fixed: 200 }, 1000), 200)
  assert.equal(payoutOf({ payout: 'fixed', percent: 0, fixed: 200 }, 150), 150)
})

t('ช่วงวันที่: รูปแบบ YYYY-MM-DD และ from ≤ to', () => {
  assert.equal(validRange('2026-11-01', '2026-11-30'), true)
  assert.equal(validRange('2026-11-30', '2026-11-01'), false)
  assert.equal(validRange('01/11/2026', '30/11/2026'), false)
})

t('สรุปรอบ: นับเฉพาะออร์เดอร์ส่งมอบแล้ว ผู้ฝากขายคนนั้น และวันในช่วง', () => {
  const orders = [
    ord('a', '2026-11-02', [line('k1', 200, 2, C('คุณสมชาย', 'percent', { percent: 30 })), line('x', 50, 1, null)]),
    ord('b', '2026-11-05', [line('k2', 100, 1, C('คุณสมชาย', 'percent', { percent: 30 }))]),
    ord('c', '2026-11-05', [line('k3', 999, 1, C('คนอื่น', 'fixed', { fixed: 10 }))]),
    ord('d', '2026-10-31', [line('k4', 500, 1, C('คุณสมชาย', 'percent', { percent: 30 }))]),
    ord('e', '2026-11-06', [line('k5', 500, 1, C('คุณสมชาย', 'percent', { percent: 30 }))], 'cancelled'),
  ]
  const s = settlementOf({ orders, consignor: 'คุณสมชาย', from: '2026-11-01', to: '2026-11-30', dayOf })
  assert.equal(s.ok, true)
  assert.equal(s.sales, 500)
  assert.equal(s.payout, 150)
  assert.equal(s.shop, 350)
  assert.deepEqual(s.orderIds, ['a', 'b'])
})

t('สรุปรอบ: ไม่มียอดขายก็ได้ 0 และช่วงผิดให้ผลผิดพลาด', () => {
  const s = settlementOf({ orders: [], consignor: 'ใครก็ได้', from: '2026-11-01', to: '2026-11-30', dayOf })
  assert.deepEqual([s.sales, s.payout, s.shop], [0, 0, 0])
  assert.equal(settlementOf({ orders: [], consignor: 'ก', from: '2026-12-01', to: '2026-11-01', dayOf }).ok, false)
})

t('กันรอบซ้ำซ้อน: ช่วงที่ทับกับรอบเดิมของผู้ฝากขายคนเดิมไม่ได้ แต่คนอื่นได้', () => {
  const rounds = [{ consignor: 'ก', from: '2026-11-01', to: '2026-11-15' }]
  assert.equal(overlapsRound(rounds, 'ก', '2026-11-15', '2026-11-20'), true)
  assert.equal(overlapsRound(rounds, 'ก', '2026-11-16', '2026-11-30'), false)
  assert.equal(overlapsRound(rounds, 'ข', '2026-11-05', '2026-11-10'), false)
})

console.log(`ผ่าน ${pass} การทดสอบ`)
