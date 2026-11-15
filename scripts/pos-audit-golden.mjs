// สร้างไฟล์อ้างอิงบิลหน้าร้านจากโค้ดขายของแอป (store.posPromoInfo + รูปบิลแบบ posSale) สำหรับทดสอบ src/lib/posAudit.js
// รัน: TZ=Asia/Bangkok node scripts/pos-audit-golden.mjs → เขียน src/lib/posAudit.golden.json
// บิลที่ขายถูกต้องทุกใบต้องผ่านการตรวจ (ตัวสร้างจะหยุดถ้าไม่ผ่าน)
import { createServer } from 'vite'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'lib', 'posAudit.golden.json')

const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false } })
try {
  const store = await vite.ssrLoadModule('/src/data/store.js')
  const pricing = await vite.ssrLoadModule('/src/lib/pricing.js')
  const audit = await vite.ssrLoadModule('/src/lib/posAudit.js')
  const { db } = store
  const clone = (x) => JSON.parse(JSON.stringify(x))

  // โปรโมชันตัวอย่างให้ทำงาน (เปิดใช้ ไม่กำหนดช่วงเวลา) · VAT 7% รวมในราคา
  for (const x of [...db.posDiscounts, ...db.posBundles, ...db.posDeals]) x.active = true
  for (const x of [...db.posDiscounts, ...db.posDeals]) if (x.schedule) x.schedule = { from: '', to: '', days: [], timeFrom: '', timeTo: '' }
  db.shop.vat = { enabled: true, rate: 7, mode: 'inclusive' }

  const catalog = {
    retailItems: clone(db.retailItems).map(({ id, name, price, active }) => ({ id, name, price, active })),
    posModifiers: clone(db.posModifiers),
  }

  // รูปบิลแบบเดียวกับ posSale: รายการจาก posPromoInfo + ชำระแล้ว (หรือบางส่วนสำหรับ pos_pending)
  const bill = (name, cart, { status = 'delivered', adjustment = { amount: 0, reason: '' }, paidRatio = 1 } = {}) => {
    const info = store.posPromoInfo(cart)
    const o = {
      id: `pos-${name}`, code: `POS-${name}`, channel: 'pos', fulfillment: 'pickup', items: info.items, adjustment,
      vat: store.vatNow(), status, shipPromo: info.shipFree ? { name: info.shipFree.name, free: true } : null, promoOn: true,
      pointsUsed: null, couponsUsed: [], payments: [], createdAt: '2026-11-15T10:00',
    }
    const total = pricing.orderTotals(o).total
    const amt = Math.round(total * paidRatio * 100) / 100
    o.payments = amt > 0 ? [{ id: `pay-${name}`, amount: amt, status: 'confirmed', method: 'เงินสด', posMethod: 'cash', requested: amt, received: amt, change: 0 }] : []
    return clone(o)
  }

  const mod = [{ groupId: 'md3', optionId: 'o7' }]
  const cases = [
    bill('drinks-promo', [{ refId: 'rt5', qty: 2, mods: mod }, { refId: 'rt6', qty: 1, mods: [] }]),
    bill('bundle-cupcakes', [{ refId: 'rt5', qty: 1, mods: [] }, { refId: 'rt3', qty: 3, mods: [] }]),
    bill('spend-tier-gift', [{ refId: 'rt8', qty: 2, mods: [] }, { refId: 'rt3', qty: 3, mods: [] }]),
    bill('manual-discount', [{ refId: 'rt8', qty: 1, mods: [] }], { adjustment: { amount: -20, reason: 'ลูกค้าประจำ' } }),
    bill('partial-pending', [{ refId: 'rt8', qty: 1, mods: [] }], { status: 'pos_pending', paidRatio: 0.5 }),
  ]

  for (const c of cases) {
    const r = audit.auditPosOrder(c, catalog)
    if (!r.ok) throw new Error(`บิลขายถูกต้องแต่ตรวจไม่ผ่าน: ${c.code} ${JSON.stringify(r.flags)}`)
  }
  writeFileSync(OUT, JSON.stringify({ catalog, bills: cases }, null, 1) + '\n')
  console.log(`wrote ${OUT} · ${cases.length} บิล · ทุกบิลผ่านการตรวจ`)
} finally {
  await vite.close()
}
