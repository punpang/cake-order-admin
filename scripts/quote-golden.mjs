// สร้างไฟล์อ้างอิง (golden) ของการคิดราคาใบเสนอ จากโค้ดในแอป (store.sendQuote / sendQuoteLocal)
// รัน: TZ=Asia/Bangkok node scripts/quote-golden.mjs → เขียน src/lib/quotePrice.golden.json
// ล็อกเวลาไว้ 2026-11-15 10:00 น. (เวลาไทย) และใช้เวลาไทยเป็นโซนเครื่อง (เหมือนเครื่องพนักงาน)
// เทสต์ src/lib/quotePrice.test.mjs และ supabase/functions/_shared/quotecreate.test.ts ใช้ไฟล์นี้ตรวจว่าการคิดราคาฝั่งเซิร์ฟเวอร์ตรงกับแอป
import { createServer } from 'vite'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'lib', 'quotePrice.golden.json')
const NOW_MS = Date.parse('2026-11-15T03:00:00Z') // = 10:00 น. ตามเวลาไทย

const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false } })
try {
  const store = await vite.ssrLoadModule('/src/data/store.js')
  const { db } = store
  const sendQuoteSync = store.sendQuoteLocal || store.sendQuote

  // นาฬิกาคงที่ (เฉพาะช่วงที่สร้างเทสต์)
  const RealDate = Date
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(NOW_MS); else super(...a) }
    static now() { return NOW_MS }
  }

  // ---- ชุดข้อมูลทดสอบ: ใช้ค่าเริ่มต้นของแอป แล้วเปิดโปรโมชันตัวอย่างให้ทำงาน ----
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const stripRecipe = (groups) => (groups || []).map((g) => ({ ...g, options: (g.options || []).map(({ recipe, ...o }) => o) }))
  const catalog = {
    shop: clone(db.shop),
    priceLists: clone(db.priceLists),
    optionGroups: stripRecipe(clone(db.optionGroups)),
    bundles: clone(db.bundles),
    retailItems: clone(db.retailItems),
    posDiscounts: clone(db.posDiscounts),
    posBundles: clone(db.posBundles),
    posDeals: clone(db.posDeals),
  }
  catalog.shop.vat = { enabled: true, rate: 7, mode: 'inclusive' }
  catalog.shop.closures = { weekly: [], ranges: [], hours: [{ days: [], from: '13:00', to: '14:00', reason: 'พักเที่ยง' }] }
  for (const x of [...catalog.posDiscounts, ...catalog.posBundles, ...catalog.posDeals]) x.active = true
  for (const x of catalog.posDeals) if (x.schedule) x.schedule = { from: '', to: '', days: [], timeFrom: '', timeTo: '' }
  for (const x of catalog.posDiscounts) if (x.schedule) x.schedule = { from: '', to: '', days: [], timeFrom: '', timeTo: '' }
  Object.assign(db, { shop: catalog.shop, priceLists: catalog.priceLists, optionGroups: clone(db.optionGroups), bundles: catalog.bundles, retailItems: catalog.retailItems, posDiscounts: catalog.posDiscounts, posBundles: catalog.posBundles, posDeals: catalog.posDeals })
  db.chats.unshift({ id: 'golden-chat', channel: 'facebook', customerId: 'golden-cust', externalId: '', messages: [] })

  // ตัวเลือกเค้กสั่งทำ: เลือกตัวแรกของกลุ่มหลัก
  const pick = (keys) => {
    const sel = {}
    for (const g of catalog.optionGroups) {
      if (!keys.includes(g.key) || !g.options?.length) continue
      sel[g.id] = g.type === 'multi' ? [g.options[0].id] : g.options[0].id
    }
    return sel
  }
  const cake = (qty = 1, extra = {}) => ({ id: `c${qty}`, kind: 'custom', retailId: null, retailPrice: 0, sizeId: null, typeId: null, qty, note: 'ตามรูปตัวอย่าง', images: [], selections: pick(['size', 'type', 'flavor', 'style', 'shape']), tiers: [], ...extra })
  const retail = (id, qty, extra = {}) => {
    const r = catalog.retailItems.find((x) => x.id === id)
    return { id: `r-${id}`, kind: 'retail', retailId: id, retailPrice: Number(r?.price) || 0, sizeId: r?.sizeId || null, typeId: r?.typeId || null, name: r?.name || '', qty, note: '', images: [], selections: {}, ...extra }
  }
  const rtIds = catalog.retailItems.filter((x) => x.active !== false).map((x) => x.id)

  const cases = [
    { name: 'cake-pickup', draft: { fulfillment: 'pickup', pickupAt: '2026-11-20T10:00', items: [cake(1)], birthday: { name: 'น้องมิ้ว', md: '05-12' } } },
    { name: 'retail-promos-and-gift', draft: { fulfillment: 'pickup', pickupAt: '2026-11-21T15:00', items: [retail(rtIds[0], 4), retail(rtIds[1] ?? rtIds[0], 2), { ...retail(rtIds[2] ?? rtIds[0], 1), promoGift: true }, cake(2)], birthday: null } },
    { name: 'delivery-manual-fee', draft: { fulfillment: 'delivery', pickupAt: '2026-11-22T09:30', address: '12/3 ถนนตัวอย่าง', placeName: 'บ้าน', mapUrl: '', detail: 'ชั้น 2', distanceKm: '4.5', shippingFee: 60, feeManual: true, items: [cake(1), retail(rtIds[0], 1)], birthday: { name: '', md: '12-31' } } },
    { name: 'delivery-computed-fee', draft: { fulfillment: 'delivery', pickupAt: '2026-11-22T11:00', address: 'ซอย 5', placeName: '', mapUrl: '', detail: '', distanceKm: '', shippingFee: 0, feeManual: false, items: [cake(1)], birthday: null } },
    { name: 'bundle-combo', draft: { fulfillment: 'pickup', pickupAt: '2026-11-24T10:30', items: [retail('rt5', 1), retail('rt3', 1), retail('rt5', 2)], birthday: null } },
    { name: 'spend-tiers', draft: { fulfillment: 'pickup', pickupAt: '2026-11-25T12:00', items: [cake(3), cake(2, { id: 'c-b' }), retail(rtIds[0], 3)], birthday: null } },
    { name: 'closed-slot', draft: { fulfillment: 'pickup', pickupAt: '2026-11-20T13:30', items: [cake(1)], birthday: null } },
    { name: 'no-vat', draft: { fulfillment: 'pickup', pickupAt: '2026-11-23T16:00', items: [retail(rtIds[0], 1)], birthday: null, _noVat: true } },
  ]

  // ภาพแคตาล็อกก่อนรันเคส: db.shop ใช้ object เดียวกับ catalog.shop จึงต้องคัดลอกก่อน (เคสไม่มี VAT จะแก้ค่า shop.vat)
  const snap = clone(catalog)
  const out = { nowMs: NOW_MS, catalog: snap, cases: [] }
  for (const c of cases) {
    const draft = clone(c.draft)
    if (draft._noVat) { db.shop.vat = { enabled: false, rate: 7, mode: 'inclusive' }; delete draft._noVat } else db.shop.vat = clone(snap.shop.vat)
    const q = sendQuoteSync('golden-chat', draft)
    out.cases.push({ name: c.name, customerId: 'golden-cust', draft: c.draft, payload: q ? JSON.parse(JSON.stringify(q.payload)) : null, shopVat: clone(db.shop.vat) })
    // ปิด/เปิดช่องทางให้ตรงกับข้อมูลตั้งต้นของเคสนี้เสมอ
    db.quotes.length = 0
    for (const ch of db.chats) ch.messages.length = 0
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
  console.log(`wrote ${OUT} · ${out.cases.length} เคส · null = ${out.cases.filter((x) => !x.payload).map((x) => x.name).join(', ') || '-'}`)
} finally {
  await vite.close()
}
