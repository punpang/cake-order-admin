// ทดสอบสูตรแต้ม/สิทธิ์หมุน (pointsFor) ที่ระดับ store จริง (โหลดผ่าน Vite SSR แบบเดียวกับแอป)
// ฐาน = ยอดสินค้าสุทธิ "ก่อน VAT" (ตรงกับข้อกำหนดข้อ 8): VAT ใน หารออก · VAT นอก/ไม่มี VAT ไม่เปลี่ยน · ไม่รวมค่าส่ง
// ค่าตั้งต้นของเทสต์: earnPer 100 บาท/คะแนน · spinPer 500 บาท/สิทธิ์หมุน
// รัน: node src/data/pointsVat.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const S = await server.ssrLoadModule('/src/data/store.js')
  const { db, pointsFor } = S
  db.loyalty.earnPer = 100
  db.loyalty.spinPer = 500
  db.pointPromos.length = 0

  const order = (lines, extra = {}) => ({
    createdAt: new Date().toISOString(),
    items: lines.map(([unitPrice, qty], i) => ({ id: 'i' + i, kind: 'custom', unitPrice, qty })),
    couponsUsed: [], pointsUsed: null, adjustment: { amount: 0, reason: '' }, shippingFee: 0, fulfillment: 'pickup',
    ...extra,
  })
  const IN = { rate: 7, mode: 'inclusive' }
  const OUT = { rate: 7, mode: 'exclusive' }

  const cases = [
    ['ไม่มี VAT: 107 บาท → ฐาน 107 · 1 คะแนน', () => {
      const r = pointsFor(order([[107, 1]]))
      assert.deepEqual(r, { points: 1, bonus: 0, spins: 0, base: 107 })
    }],
    ['VAT ใน 7%: 107 บาท → ฐาน 100 · 1 คะแนน', () => {
      const r = pointsFor(order([[107, 1]], { vat: IN }))
      assert.deepEqual(r, { points: 1, bonus: 0, spins: 0, base: 100 })
    }],
    ['VAT ใน 7%: 106 บาท → ฐาน 99.07 · 0 คะแนน (เดิมได้ 1)', () => {
      const r = pointsFor(order([[106, 1]], { vat: IN }))
      assert.equal(r.points, 0)
      assert.equal(r.base, 99.07)
    }],
    ['VAT ใน 7%: 535 บาท → ฐาน 500 · 5 คะแนน · 1 สิทธิ์หมุน', () => {
      const r = pointsFor(order([[535, 1]], { vat: IN }))
      assert.deepEqual(r, { points: 5, bonus: 0, spins: 1, base: 500 })
    }],
    ['VAT ใน 7%: 534 บาท → ฐาน 499.07 · 4 คะแนน · 0 สิทธิ์หมุน (เดิมได้ 1)', () => {
      const r = pointsFor(order([[534, 1]], { vat: IN }))
      assert.deepEqual(r, { points: 4, bonus: 0, spins: 0, base: 499.07 })
    }],
    ['VAT นอก 7%: ราคา 100 ไม่มี VAT ในยอด → ฐาน 100 · 1 คะแนน (ไม่เปลี่ยนจากเดิม)', () => {
      const r = pointsFor(order([[100, 1]], { vat: OUT }))
      assert.deepEqual(r, { points: 1, bonus: 0, spins: 0, base: 100 })
    }],
    ['อัตรา VAT 0 หรือไม่มีค่า = ไม่หาร', () => {
      assert.equal(pointsFor(order([[107, 1]], { vat: { rate: 0, mode: 'inclusive' } })).base, 107)
      assert.equal(pointsFor(order([[107, 1]], { vat: {} })).base, 107)
    }],
    ['ส่วนลดระดับบิลหักก่อน แล้วค่อยหาร VAT: 2 × 107 − คูปอง 107 → ฐาน 100', () => {
      const r = pointsFor(order([[107, 2]], { vat: IN, couponsUsed: [{ amount: 107 }] }))
      assert.deepEqual(r, { points: 1, bonus: 0, spins: 0, base: 100 })
    }],
    ['ค่าส่งไม่นับในฐาน (VAT ใน): สินค้า 107 + ส่ง 100 → ฐาน 100', () => {
      const r = pointsFor(order([[107, 1]], { vat: IN, fulfillment: 'delivery', shippingFee: 100 }))
      assert.equal(r.base, 100)
    }],
    ['หลายรายการ: (107 + 214) VAT ใน → ฐาน 300 · 3 คะแนน', () => {
      const r = pointsFor(order([[107, 1], [214, 1]], { vat: IN }))
      assert.deepEqual(r, { points: 3, bonus: 0, spins: 0, base: 300 })
    }],
    ['ตัวคูณโปร ×2 ใช้กับฐานก่อน VAT: 214 VAT ใน → ฐาน 200 · 4 คะแนน (โบนัส 2)', () => {
      db.pointPromos.length = 0
      db.pointPromos.push({ id: 'tp', name: 'ทดสอบ ×2', scope: 'all', multiplier: 2, active: true })
      try {
        const r = pointsFor(order([[214, 1]], { vat: IN }))
        assert.deepEqual(r, { points: 4, bonus: 2, spins: 0, base: 200 })
      } finally { db.pointPromos.length = 0 }
    }],
    ['ใช้ VAT ที่บันทึกในออร์เดอร์ ไม่ใช้ค่าตั้งร้านปัจจุบัน', () => {
      const before = { ...db.shop.vat }
      db.shop.vat = { ...before, enabled: true, rate: 7, mode: 'inclusive' }
      try {
        assert.equal(pointsFor(order([[107, 1]])).base, 107) // ออร์เดอร์ไม่มี vat = ไม่หาร แม้ร้านเปิด VAT อยู่
      } finally { db.shop.vat = before }
    }],
  ]

  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
} catch (e) {
  fails++
  console.log('ERROR', e?.stack || e)
} finally {
  await server.close()
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
