// ทดสอบกติกาแก้รายการบิลค้าง POS · รัน: node src/lib/billEdit.test.mjs
import assert from 'node:assert/strict'
import { cartOfBill, paidGuard } from './billEdit.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }
const keyOf = (l) => `${l.refId}|${l.mods.map((m) => `${m.groupId}:${m.optionId}`).join(',')}`

t('ตะกร้าจากบิลค้าง: รวมรายการที่โปรแยกเป็นหลายบรรทัดกลับเป็นสินค้าเดียวกัน', () => {
  const items = [
    { retailId: 'a', qty: 2, mods: [] },
    { retailId: 'a', qty: 1, mods: [] },
    { retailId: 'b', qty: 1, mods: [{ groupId: 'g', optionId: 'o1', name: 'x', price: 10 }] },
    { retailId: 'b', qty: 2, mods: [{ groupId: 'g', optionId: 'o2', name: 'y', price: 0 }] },
  ]
  const cart = cartOfBill(items, keyOf)
  assert.deepEqual(cart, [
    { kind: 'retail', refId: 'a', qty: 3, mods: [] },
    { kind: 'retail', refId: 'b', qty: 1, mods: [{ groupId: 'g', optionId: 'o1' }] },
    { kind: 'retail', refId: 'b', qty: 2, mods: [{ groupId: 'g', optionId: 'o2' }] },
  ])
})

t('ตะกร้าจากบิลค้าง: ไม่เอาของแถมจากโปร และข้ามรายการจำนวนศูนย์', () => {
  const items = [
    { retailId: 'a', qty: 1, mods: [] },
    { retailId: 'c', qty: 1, mods: [], promoGift: { dealId: 'd1', name: 'แถม' } },
    { retailId: 'e', qty: 0, mods: [] },
  ]
  assert.deepEqual(cartOfBill(items, keyOf), [{ kind: 'retail', refId: 'a', qty: 1, mods: [] }])
  assert.deepEqual(cartOfBill([], keyOf), [])
})

t('ยอดหลังแก้: ต้องไม่ต่ำกว่าที่รับไปแล้ว', () => {
  assert.equal(paidGuard(75, 30), '')
  assert.equal(paidGuard(30, 30), '')
  assert.equal(paidGuard(30.01, 30.01), '') // เท่ากันพอดีผ่าน
  const msg = paidGuard(20, 30)
  assert.match(msg, /20\.00/)
  assert.match(msg, /30\.00/)
})

console.log(`ผ่าน ${pass} กรณี`)
