// ทดสอบการคืนสินค้ารายชิ้น (src/lib/refund.js) · รัน: node src/lib/refund.test.mjs
import assert from 'node:assert/strict'
import { returnedQtyOf, restockedQtyOf, itemReturnAmount, restockUnits } from './refund.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const order = {
  items: [{ id: 'a', qty: 3, unitPrice: 50 }, { id: 'b', qty: 1, unitPrice: 20 }],
  returns: [
    { items: [{ id: 'a', qty: 1, restock: 1 }], refunds: [{ method: 'cash', amount: 50 }] },
    { items: [{ id: 'a', qty: 2, restock: 0 }, { id: 'b', qty: 1, restock: 1 }], refunds: [{ method: 'cash', amount: 120 }] },
    { cancelled: { at: 'x' }, items: [{ id: 'a', qty: 5, restock: 5 }], refunds: [] },
    { refunds: [{ method: 'cash', amount: 10 }] },
  ],
}

t('returnedQtyOf: รวมเฉพาะการคืนที่ไม่ถูกยกเลิก และแยกตามรายการ', () => {
  assert.equal(returnedQtyOf(order, 'a'), 3)
  assert.equal(returnedQtyOf(order, 'b'), 1)
  assert.equal(returnedQtyOf(order, 'zzz'), 0)
  assert.equal(returnedQtyOf({}, 'a'), 0)
})
t('restockedQtyOf: นับจำนวนที่คืนเข้าสต็อกจริง ไม่นับการคืนที่ยกเลิก', () => {
  assert.equal(restockedQtyOf(order, 'a'), 1)
  assert.equal(restockedQtyOf(order, 'b'), 1)
})
t('itemReturnAmount: ราคาหลังส่วนลด × จำนวน ปัดเป็นสตางค์', () => {
  assert.equal(itemReturnAmount({ unitPrice: 33.33 }, 3), 99.99)
  assert.equal(itemReturnAmount({ unitPrice: 50 }, 2), 100)
  assert.equal(itemReturnAmount(undefined, 2), 0)
})
t('restockUnits: ไม่เกินจำนวนที่ตัดสต็อกตอนขาย หักจำนวนที่คืนเข้าสต็อกไปแล้ว', () => {
  assert.equal(restockUnits({ stockTaken: 4 }, 2, 0), 2)
  assert.equal(restockUnits({ stockTaken: 4 }, 3, 2), 2)
  assert.equal(restockUnits({ stockTaken: 4 }, 5, 0), 4)
  assert.equal(restockUnits({ stockTaken: 4 }, 2, 4), 0)
})
t('restockUnits: ไม่คืนเข้าสต็อก หรือตอนขายไม่ได้ตัดสต็อก = 0', () => {
  assert.equal(restockUnits({ stockTaken: 4 }, 2, 0, false), 0)
  assert.equal(restockUnits({}, 2, 0), 0)
  assert.equal(restockUnits({ stockTaken: 0 }, 2, 0), 0)
})

process.exitCode = fail ? 1 : 0
