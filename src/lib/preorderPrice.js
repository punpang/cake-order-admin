// ราคาออร์เดอร์สั่งล่วงหน้า (ฟังก์ชันล้วน · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib)
// ลำดับ: ราคาสินค้าจากแคตาล็อก → โปรของแคมเปญเท่านั้น (ส่วนลดตามยอด) → ค่าส่งพัสดุคิดใหม่เสมอ → แต้มจำกัดด้วยยอดสินค้าที่ไม่ใช่ noPoints → orderTotals
// ไม่รับราคา ค่าส่ง หรือแต้มที่คำนวณจากผู้ใช้ (ค่าที่ส่งมาทั้งหมดถูกทิ้ง ยกเว้นรหัสสินค้า จำนวน และจำนวนแต้มที่ขอ)

import { buildQuotePayload } from './quotePrice.js'
import { orderTotals } from './pricing.js'
import { parcelFee } from './parcelShipping.js'

const fail = (error, extra = {}) => ({ ok: false, error, ...extra })

// lines = [{retailId, qty}] · campaign = แคมเปญที่ผ่านการตรวจแล้ว (items, deals, parcel)
// catalog = แคตาล็อกจาก loadCatalog (shop, retailItems, priceLists, optionGroups, bundles)
export function priceCampaignOrder({ campaign, catalog, lines, pickupDate, fulfillment, points = 0, pointValue = 1, nowMs }) {
  if (fulfillment !== 'pickup' && fulfillment !== 'delivery') return fail('รูปแบบการรับสินค้าไม่ถูกต้อง')
  if (fulfillment === 'delivery' && !campaign?.parcel?.enabled) return fail('แคมเปญนี้ไม่เปิดส่งพัสดุ')
  if (!Array.isArray(lines) || lines.length === 0) return fail('ต้องเลือกสินค้าอย่างน้อย 1 รายการ')
  const allowed = new Set((campaign.items || []).map((i) => i.retailId))
  for (const l of lines) {
    if (!allowed.has(l?.retailId)) return fail('สินค้าไม่อยู่ในแคมเปญ', { itemId: l?.retailId ?? null })
  }

  // ราคา: ใช้ตัวคิดใบเสนอชุดเดียวกับแอป แต่แทนโปรทั้งร้านด้วยโปรของแคมเปญ
  const cat = { ...catalog, posDiscounts: [], posBundles: [], posDeals: campaign.deals || [] }
  const draft = {
    fulfillment,
    pickupAt: `${pickupDate}T00:00`,
    items: lines.map((l, i) => ({ id: `ln${i}`, kind: 'retail', retailId: l.retailId, qty: l.qty, mods: [], selections: {}, note: '', images: [], discounts: [], specials: [], bundles: [] })),
  }
  const q = buildQuotePayload({ draft, customerId: null, catalog: cat, nowMs, checkClosure: false })
  if (!q.ok) return fail(q.error)

  // ค่าส่ง: คิดจากตารางพัสดุของร้านเท่านั้น (ไม่ใช้ค่าจากผู้ใช้)
  let shippingFee = 0
  let shipDetail = null
  if (fulfillment === 'delivery') {
    const pf = parcelFee(lines, catalog.retailItems || [], catalog.shop?.parcel)
    if (!pf.ok) return fail(pf.error === 'overweight' ? 'น้ำหนักเกินขั้นสูงสุดของตารางค่าส่ง' : pf.error === 'no_rates' ? 'ยังไม่ได้ตั้งตารางค่าส่งพัสดุ' : 'สินค้าบางรายการไม่มีน้ำหนักหรือขนาด', { itemId: pf.itemId ?? null })
    shippingFee = pf.fee
    shipDetail = pf.detail
  }

  // แต้ม: จำกัดด้วยยอดสินค้าหลังส่วนลดที่ไม่ใช่ noPoints และไม่เกินแต้มที่ขอ (ตรวจยอดคงเหลือในธุรกรรมฐานข้อมูลอีกครั้ง)
  const pv = Number(pointValue) > 0 ? Number(pointValue) : 1
  const goodsNoPoints = q.payload.items
    .filter((i) => !i.noPoints)
    .reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const maxPoints = Math.floor(goodsNoPoints / pv + 1e-9)
  const usePoints = Math.max(0, Math.min(Number(points) || 0, maxPoints))
  const amount = Math.round(usePoints * pv * 100) / 100

  const order = {
    ...q.payload,
    fulfillment,
    shippingFee,
    shipPromo: null,
    pointsUsed: usePoints > 0 ? { points: usePoints, amount, entryId: null } : null,
    couponsUsed: [],
    payments: [],
    returns: [],
    cancel: null,
  }
  const totals = orderTotals(order)
  return {
    ok: true,
    order,
    totals,
    pointsUsed: usePoints,
    snapshot: {
      pickupDate,
      campaignId: campaign.id ?? null,
      pointValue: pv,
      shippingFee,
      parcel: shipDetail,
    },
  }
}
