// สร้างการทดสอบความเท่ากันของยอดบิล: ฟังก์ชันในฐานข้อมูล punpang__bill_total ต้องได้ยอดเท่ากับ orderTotals ใน src/lib/pricing.js
// รัน: node scripts/bill-parity-golden.mjs → เขียน supabase/tests/payment_bill_parity.test.sql
// ใช้บิลหน้าร้านจาก src/lib/posAudit.golden.json และบิลสังเคราะห์ที่ครอบคลุมค่าส่ง ส่งฟรี VAT แบบรวม/แยก ปรับราคา คะแนน คูปอง และยอดติดลบ
import { createServer } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'supabase', 'tests', 'payment_bill_parity.test.sql')

const item = (id, unitPrice, qty = 1) => ({
  id, kind: 'retail', name: id, qty, unitPrice, regularPrice: unitPrice, fullPrice: unitPrice,
  mods: [], selections: {}, note: '', images: [], discounts: [], specials: [], bundles: [],
})

const synthetic = [
  { name: 'pickup-plain', order: { fulfillment: 'pickup', items: [item('a1', 100, 2)], payments: [] } },
  { name: 'delivery-shipping-fee', order: { fulfillment: 'delivery', shippingFee: 50, items: [item('a2', 100, 2)], payments: [] } },
  { name: 'delivery-free-ship-promo', order: { fulfillment: 'delivery', shippingFee: 50, shipPromo: { free: true, name: 'ส่งฟรี' }, items: [item('a3', 100, 2)], payments: [] } },
  { name: 'vat-inclusive-7', order: { fulfillment: 'pickup', vat: { rate: 7, mode: 'inclusive' }, items: [item('a4', 107)], payments: [] } },
  { name: 'vat-exclusive-7', order: { fulfillment: 'pickup', vat: { rate: 7, mode: 'exclusive' }, items: [item('a5', 100)], payments: [] } },
  { name: 'vat-exclusive-fraction', order: { fulfillment: 'pickup', vat: { rate: 7, mode: 'exclusive' }, items: [item('a6', 33.33, 3)], payments: [] } },
  { name: 'adjust-points-coupon', order: { fulfillment: 'pickup', adjustment: { amount: -50, reason: 'ลดพิเศษ' }, pointsUsed: { points: 30, amount: 30 }, couponsUsed: [{ couponId: 'c1', name: 'คูปอง', amount: 20 }], items: [item('a7', 300)], payments: [] } },
  { name: 'discount-over-goods', order: { fulfillment: 'pickup', couponsUsed: [{ couponId: 'c2', name: 'เกินยอดสินค้า', amount: 150 }], items: [item('a8', 100)], payments: [] } },
]

const golden = JSON.parse(readFileSync(join(ROOT, 'src', 'lib', 'posAudit.golden.json'), 'utf8'))
const bills = golden.bills.map((b) => ({ name: `pos-${b.id}`, order: b }))

const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false } })
try {
  const { orderTotals } = await vite.ssrLoadModule('/src/lib/pricing.js')
  const rows = [...bills, ...synthetic].map(({ name, order }) => {
    const json = JSON.stringify(order)
    if (json.includes('$p$')) throw new Error(`ตัวคั่นชนกับข้อมูล: ${name}`)
    return { name, json, total: Number(orderTotals(order).total).toFixed(2) }
  })
  const body = rows.map((r) => `select test.ok('parity: ${r.name} ยอดบิล ${r.total} บาท', public.punpang__bill_total($p$${r.json}$p$::jsonb) = ${r.total});`).join('\n')
  const sql = `-- สร้างอัตโนมัติจาก scripts/bill-parity-golden.mjs · อย่าแก้ด้วยมือ (รันใหม่เมื่อสูตร orderTotals เปลี่ยน)
-- ยอดบิลในฐานข้อมูล (punpang__bill_total) ต้องเท่ากับ orderTotals(...).total ของแอปทุกกรณี · รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok)

${body}

select 'ยอดบิลในฐานข้อมูลตรงกับแอปทุกกรณี' as bill_parity_tests;
`
  writeFileSync(OUT, sql)
  console.log(`เขียน ${OUT} · ${rows.length} กรณี`)
  for (const r of rows) console.log(`  ${r.name}: ${r.total}`)
} finally {
  await vite.close()
}
