// ทดสอบหน้าบันเดิ้ลแบบเลือกตัวเลือกหนึ่งตัว · รัน: node src/lib/bundleByOption.test.mjs
import assert from 'node:assert/strict'
import { bundlesWithOption, conflictsOf, usageOf, discountRows, setSizeDiscount, createBundleDraft } from './bundleByOption.js'

let fail = 0
const t = (name, fn) => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

const G = 'g_top'
const opt = (id, name) => ({ id, name, active: true, priceType: 'size', sizePrices: { s1: 50 } })
const groups = [{ id: G, name: 'ขอบบน', key: 'topping', active: true, options: [opt('cherry', 'เชอร์รี่'), opt('kit', 'คิทแคท'), opt('beng', 'เบงเบง'), opt('oreo', 'โอริโอ้')] }]
const sizes = [{ id: 's1', name: '1 ปอนด์' }]
const A = { groupId: G, optionId: 'cherry' }
const B = { groupId: G, optionId: 'kit' }
const D = { groupId: G, optionId: 'oreo' }
const C = { groupId: G, optionId: 'beng' }
const mk = (id, items, s1) => ({ id, name: id, items, discount: { s1 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true })
// ตัวอย่างจากผู้ใช้: 1 คิทแคท+เชอร์รี่ · 2 คิทแคท+โอริโอ้ · 3 คิทแคท+เชอร์รี่+โอริโอ้
const b1 = mk('b1', [B, A], 100)
const b2 = mk('b2', [B, D], 40)
const b3 = mk('b3', [B, A, D], 150)
const all = [b1, b2, b3]

t('bundlesWithOption: คิทแคทผูกกับทั้ง 3 ชุด เรียงจากตัวเลือกมากไปน้อย', () => {
  assert.deepEqual(bundlesWithOption(all, B, sizes).map((b) => b.id), ['b3', 'b1', 'b2'])
})

t('bundlesWithOption: เชอร์รี่ผูกกับ 2 ชุด (ชุด 1 และชุด 3)', () => {
  assert.deepEqual(bundlesWithOption(all, A, sizes).map((b) => b.id), ['b3', 'b1'])
})

t('conflictsOf: ชุด 2 ถูกข้ามเมื่อเลือกชุด 3 หรือชุด 1 ที่มีตัวเลือกร่วม', () => {
  assert.deepEqual(conflictsOf(b2, all, sizes).map((b) => b.id).sort(), ['b1', 'b3'])
})

t('conflictsOf: ชุดที่ใหญ่สุดไม่ถูกข้ามโดยใคร', () => {
  assert.deepEqual(conflictsOf(b3, all, sizes), [])
})

t('usageOf: ชุดที่ปิดอยู่หรือไม่มีส่วนลดแสดงสถานะเฉพาะ', () => {
  assert.equal(usageOf({ ...b1, active: false }, all, sizes).status, 'off')
  assert.equal(usageOf({ ...b1, discount: {} }, all, sizes).status, 'nodiscount')
  assert.equal(usageOf(b3, all, sizes).status, 'ok')
  assert.equal(usageOf(b2, all, sizes).status, 'skipped')
})

t('discountRows: ราคาปกติรวมตามตัวเลือกจริง และส่วนลดของแต่ละขนาด', () => {
  const rows = discountRows(b1, groups, sizes)
  assert.deepEqual(rows, [{ sizeId: 's1', sizeName: '1 ปอนด์', regular: 100, amount: 100 }])
})

t('setSizeDiscount: คืนชุดใหม่ ไม่แก้ต้นฉบับ และว่างคือลบค่า', () => {
  const r = setSizeDiscount(b1, 's1', 70)
  assert.equal(r.discount.s1, 70)
  assert.equal(b1.discount.s1, 100)
  assert.equal(setSizeDiscount(b1, 's1', null).discount.s1, undefined)
})

t('createBundleDraft: ชื่ออัตโนมัติและรายการตัวเลือกข้ามกลุ่มรองได้', () => {
  const d = createBundleDraft([A, B, D], groups)
  assert.equal(d.name, 'เชอร์รี่ + คิทแคท + โอริโอ้')
  assert.equal(d.id, null)
  assert.equal(d.items.length, 3)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
