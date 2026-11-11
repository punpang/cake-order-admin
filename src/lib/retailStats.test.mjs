// ทดสอบสถิติสินค้าพร้อมขายสำหรับหน้าร้าน · รัน: node src/lib/retailStats.test.mjs
import assert from 'node:assert/strict'
import { computeRetailStats, alsoBoughtIds, personalIds, topSalesIds, RETAIL_STATS } from './retailStats.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

const now = new Date('2026-11-11T05:00:00Z')
const day = (n) => new Date(now.getTime() - n * 86400e3).toISOString()
const line = (id, qty = 1) => ({ kind: 'retail', retailId: id, qty })
const orders = [
  { id: 'o1', status: 'delivered', createdAt: day(1), items: [line('A', 2), line('B'), line('C')] },
  { id: 'o2', status: 'preparing', createdAt: day(2), items: [line('A'), line('B')] },
  { id: 'o3', status: 'draft', createdAt: day(1), items: [line('A', 9)] }, // ร่าง ไม่นับ
  { id: 'o4', status: 'cancelled', createdAt: day(1), items: [line('B', 9)] }, // ยกเลิก ไม่นับ
  { id: 'o5', status: 'delivered', createdAt: day(40), items: [line('A', 50)] }, // เกิน 30 วัน ไม่นับ
  { id: 'o6', status: 'delivered', createdAt: day(3), items: [{ kind: 'custom', qty: 1 }, line('C')] }, // เค้กสั่งทำ ไม่นับ
  { id: 'o7', status: 'delivered', createdAt: day(3), items: [line('D')] }, // สินค้าเดียว ไม่มีคู่
]

t('ยอดขาย: นับเฉพาะออร์เดอร์ที่ใช้ได้และอยู่ในช่วง 30 วัน', () => {
  const s = computeRetailStats(orders, { now })
  assert.equal(s.sales.A, 3) // 2 (o1) + 1 (o2)
  assert.equal(s.sales.B, 2)
  assert.equal(s.sales.C, 2)
  assert.equal(s.sales.D, 1)
})

t('คู่สินค้า: ต้องพบอย่างน้อย pairMin ออร์เดอร์', () => {
  const s = computeRetailStats(orders, { now })
  assert.equal(RETAIL_STATS.pairMin, 2)
  // A+B พบใน o1 และ o2 = 2 ครั้ง → เข้าเกณฑ์ · A+C และ B+C พบครั้งเดียว → ไม่เข้า
  assert.deepEqual(s.pairs.A, [{ id: 'B', n: 2 }])
  assert.deepEqual(s.pairs.B, [{ id: 'A', n: 2 }])
  assert.equal(s.pairs.C, undefined)
  assert.equal(s.pairs.D, undefined)
})

t('alsoBoughtIds: คืนรายการตามลำดับจำนวนที่พบ หรือว่างถ้าไม่มี', () => {
  const s = computeRetailStats(orders, { now })
  assert.deepEqual(alsoBoughtIds(s.pairs, 'A'), ['B'])
  assert.deepEqual(alsoBoughtIds(s.pairs, 'Z'), [])
  assert.deepEqual(alsoBoughtIds(undefined, 'A'), [])
})

t('personalIds: แนะนำจากที่เคยสั่ง และตัดของที่เคยสั่งออก', () => {
  const pairs = { A: [{ id: 'B', n: 5 }, { id: 'X', n: 2 }], C: [{ id: 'X', n: 4 }, { id: 'A', n: 3 }], B: [{ id: 'Y', n: 1 }] }
  // เคยสั่ง A และ C → B ได้ 5 · X ได้ 2+4 = 6 · A ถูกตัดเพราะเคยสั่งแล้ว
  assert.deepEqual(personalIds(pairs, ['A', 'C']), ['X', 'B'])
  assert.deepEqual(personalIds(pairs, []), [])
  assert.deepEqual(personalIds(undefined, ['A']), [])
})

t('topSalesIds: เรียงยอดมาก→น้อย ตัดยอดศูนย์', () => {
  assert.deepEqual(topSalesIds({ A: 3, B: 0, C: 7 }), ['C', 'A'])
  assert.deepEqual(topSalesIds({}), [])
})

t('ไม่มีออร์เดอร์: สถิติว่างทั้งหมด', () => {
  const s = computeRetailStats([], { now })
  assert.deepEqual(s, { sales: {}, pairs: {} })
})

console.log(`ALL PASS (${pass})`)
