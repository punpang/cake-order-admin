// ราคาใบเสนอ — โค้ดชุดเดียวกันทั้งในแอป (src/data/store.js) และเซิร์ฟเวอร์ (Edge Function quote-create ผ่าน schedlib)
// ล้วน: ไม่แตะฐานข้อมูล/DOM · รับแคตาล็อกเป็นพารามิเตอร์ (shop, priceLists, optionGroups, retailItems, bundles, posDiscounts, posBundles, posDeals)
// เวลาคิดตามเวลาไทย (UTC+7) ไม่ขึ้นกับโซนของเครื่องที่รัน (bkkWall) · เวลานัดที่ไม่มีโซนถือเป็นเวลาไทย
// ผลลัพธ์ต้องตรงกับ src/lib/quotePrice.golden.json (สร้างจากโค้ดเดิมของแอป) — ทดสอบที่ src/lib/quotePrice.test.mjs

import { activeLists, priceDetail } from './pricing.js'
import { applyPosPromos, round2 } from './posPromo.js'
import { cleanDelivery } from './delivery.js'
import { closureAt } from './shopHours.js'
import { toDateStr } from './format.js'
import { birthCakeDiscount } from './birthdayBenefit.js'
import { cashServiceOf, cashServicesOf } from './cashService.js'

const TH_MS = 7 * 3600000
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/ // เวลานัดไม่มีโซน (เวลาไทย)
const MD_RE = /^\d{2}-\d{2}$/
const MAX_ITEMS = 60
const MAX_QTY = 999
const MAX_PRICE = 10000000

// เวลาไทยเป็น "เวลาของเครื่อง" ของ Date: getHours/getDay/toDateStr ของโมดูลวันที่เดิมให้ค่าเวลาไทยเสมอ ไม่ว่าโซนจริงของเครื่องจะเป็นอะไร
export function bkkWall(ms) {
  const u = new Date(ms + TH_MS)
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds())
}

// เวลานัด (YYYY-MM-DDTHH:mm ไม่มีโซน = เวลาไทย) → ms · อ่านไม่ได้ = NaN
export function pickupMs(s) {
  const v = String(s || '')
  if (!v) return NaN
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(v)) return new Date(v).getTime()
  return new Date(`${v}${v.length === 16 ? ':00' : ''}+07:00`).getTime()
}

// ---- ค่าจากแคตาล็อก (เหมือนที่ store ใช้ — ย้ายมาไว้ที่นี่ให้ที่เดียว) ----
export const vatOf = (shop) => (shop?.vat?.enabled && Number(shop.vat.rate) > 0 ? { rate: Number(shop.vat.rate), mode: shop.vat.mode === 'exclusive' ? 'exclusive' : 'inclusive' } : null)

export function deliveryFieldsOf(p) {
  if (p.fulfillment !== 'delivery') return { address: '', shippingFee: 0, placeName: '', mapUrl: '', detail: '', distanceKm: null, feeManual: false }
  const bad = (f) => cleanDelivery({ [f]: p[f] }).error
  const v = cleanDelivery({
    ...p, mapUrl: bad('mapUrl') ? '' : p.mapUrl, distanceKm: bad('distanceKm') ? '' : p.distanceKm, shippingFee: bad('shippingFee') ? 0 : p.shippingFee,
  }).value
  return { address: v.address, shippingFee: v.shippingFee, placeName: v.placeName, mapUrl: v.mapUrl, detail: v.detail, distanceKm: v.distanceKm, feeManual: v.feeManual }
}

export const dealCatalogOf = (retailItems) => (retailItems || []).filter((x) => x.active !== false).map((x) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, stock: x.stock }))

export function priceItemOn(item, cat, dateStr) {
  const r = item.kind === 'retail' ? (cat.retailItems || []).find((x) => x.id === item.retailId) : null
  const consign = r?.consignment && String(r.consignorName ?? '').trim()
    ? { name: String(r.consignorName).trim(), payout: r.consignPayout === 'fixed' ? 'fixed' : 'percent', percent: Number(r.consignPercent) || 0, fixed: Number(r.consignFixed) || 0 }
    : null
  return { ...item, ...(r?.noPoints ? { noPoints: true } : {}), ...(consign ? { consign } : {}), ...priceDetail(item, cat.optionGroups || [], cat.retailItems || [], activeLists(cat.priceLists || [], dateStr), cat.bundles || []) }
}

export function giftRowOn(g, cat, dateStr) {
  const r = (cat.retailItems || []).find((x) => x.id === g.retailId)
  const it = priceItemOn({ id: `gift:${g.dealId}:${g.retailId}`, kind: 'retail', retailId: g.retailId, retailPrice: r?.price || 0, sizeId: r?.sizeId || null, typeId: r?.typeId || null, mods: [], name: r?.name || '', qty: g.qty, selections: {}, note: '', images: [] }, cat, dateStr)
  return { ...it, unitPrice: 0, discounts: [{ kind: 'gift', name: g.name, amount: it.unitPrice }], promoGift: { dealId: g.dealId, name: g.name } }
}

// โปรในออร์เดอร์ (สินค้าสำเร็จ + ยอดทั้งบิลรวมเค้กสั่งทำ) · items = รายการที่คิดราคาแล้ว (priceItemOn)
// ไม่แยกรายการเมื่อชิ้นได้ส่วนลดไม่เท่ากัน (เฉลี่ยต่อชิ้น) เพื่อให้รหัสรายการ/รูปงานคงเดิม · เรียกซ้ำกับรายการชุดเดิมได้ผลเท่าเดิม
export function withPromosOn(items, cat, { at, dateStr }) {
  const base = (items || []).filter((i) => !i.promoGift)
  const lines = base.map((i) => {
    const r = i.kind === 'retail' ? (cat.retailItems || []).find((x) => x.id === i.retailId) : null
    return { retailId: r ? i.retailId : null, category: r?.category || '', price: Number(i.unitPrice) || 0, qty: Number(i.qty) || 0, noItemPromo: !r }
  })
  const res = applyPosPromos(lines, { discounts: cat.posDiscounts || [], bundles: cat.posBundles || [], deals: cat.posDeals || [], catalog: dealCatalogOf(cat.retailItems), now: at })
  const out = base.map((i, k) => {
    const segs = res.lines[k]
    const total = round2(segs.reduce((n, sg) => n + sg.perUnit * sg.qty, 0))
    if (!(total > 0) || !(i.qty > 0)) return i
    const by = new Map()
    for (const sg of segs) for (const e of sg.entries) { const key = `${e.kind}|${e.name}`; by.set(key, { kind: e.kind, name: e.name, amount: (by.get(key)?.amount || 0) + e.amount * sg.qty }) }
    const entries = [...by.values()].map((e) => ({ ...e, amount: round2(e.amount / i.qty) }))
    return { ...i, unitPrice: round2(i.unitPrice - total / i.qty), discounts: [...(i.discounts || []), ...entries] }
  })
  const gifts = res.gifts.map((g) => giftRowOn(g, cat, dateStr))
  return { items: [...out, ...gifts], shipPromo: res.shipFree ? { name: res.shipFree.name, free: true } : null, hints: res.hints }
}

// ---- ทำความสะอาดข้อมูลที่ส่งมา (ไม่เชื่อค่าราคา/ส่วนลดจากเครื่องพนักงาน) ----
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const text = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '')
const idStr = (x) => (typeof x === 'string' && x.length > 0 && x.length <= 64 ? x : null)
const idOrNull = (x) => (x == null || x === '' ? null : idStr(x))
const numOr0 = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? n : 0 }

function cleanSelections(s) {
  if (!isObj(s)) return {}
  const out = {}
  for (const [k, v] of Object.entries(s).slice(0, 100)) {
    if (k.length > 64) continue
    if (typeof v === 'string') out[k] = v.slice(0, 500)
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, 500))
  }
  return out
}

const cleanBirthday = (b) => (isObj(b) && typeof b.md === 'string' && MD_RE.test(b.md) ? { name: text(b.name, 80), md: b.md } : null)

// รายการหนึ่งรายการ → ค่าที่ปลอดภัยและราคาจากแคตาล็อก (สินค้าหน้าร้าน: ราคา/ขนาด/ประเภท/ชื่อจากสินค้าในระบบ ไม่ใช่จากเครื่อง)
// ฟิลด์นำเข้าของรายการสินค้า (ตรงกับที่แอปส่ง) · อย่างอื่นไม่รับ
const ITEM_INPUT_KEYS = new Set(['id', 'images', 'kind', 'name', 'note', 'promoGift', 'qty', 'retailId', 'retailPrice', 'selections', 'sizeId', 'tiers', 'typeId', 'cashService'])
function cleanItem(raw, cat) {
  if (!isObj(raw)) return { error: 'รายการสินค้าไม่ถูกต้อง' }
  const id = idStr(raw.id)
  if (!id) return { error: 'รหัสรายการไม่ถูกต้อง' }
  if (raw.kind !== 'retail' && raw.kind !== 'custom') return { error: 'ประเภทรายการไม่ถูกต้อง' }
  const qty = Number(raw.qty)
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: 'จำนวนสินค้าต้องเป็นจำนวนเต็ม 1–999' }
  // เก็บเฉพาะฟิลด์นำเข้าที่แอปส่งจริง · ฟิลด์อื่นที่เครื่องส่งมา (เช่น price/total/net) ถูกทิ้ง ไม่ปนเข้าไปในรายการที่บันทึก
  const out = { ...raw, id, kind: raw.kind, qty }
  for (const k of Object.keys(out)) if (!ITEM_INPUT_KEYS.has(k)) delete out[k]
  delete out.promoGift
  if (raw.note !== undefined) out.note = text(raw.note, 1000)
  if (raw.name !== undefined) out.name = text(raw.name, 200)
  if (raw.images !== undefined) out.images = Array.isArray(raw.images) ? raw.images.filter((x) => typeof x === 'string').slice(0, 10).map((x) => x.slice(0, 1000)) : []
  if (raw.selections !== undefined) out.selections = cleanSelections(raw.selections)
  if (raw.tiers !== undefined) out.tiers = Array.isArray(raw.tiers) ? raw.tiers.slice(0, 10).map((t) => ({ ...(isObj(t) ? t : {}), selections: cleanSelections(isObj(t) ? t.selections : null) })) : []
  if (raw.sizeId !== undefined) out.sizeId = idOrNull(raw.sizeId)
  if (raw.typeId !== undefined) out.typeId = idOrNull(raw.typeId)
  if (raw.retailId !== undefined) out.retailId = idOrNull(raw.retailId)
  if (raw.retailPrice !== undefined) out.retailPrice = numOr0(raw.retailPrice)
  // บริการเกี่ยวกับเงินของรายการ: เก็บเฉพาะ kind/notes (ราคาและเงินพักคิดใหม่ที่เซิร์ฟเวอร์)
  if (raw.cashService === undefined || raw.cashService === null) delete out.cashService
  else if (isObj(raw.cashService)) out.cashService = { kind: raw.cashService.kind, ...(raw.cashService.notes !== undefined ? { notes: raw.cashService.notes } : {}) }
  else return { error: 'บริการเกี่ยวกับเงินไม่ถูกต้อง' }
  if (raw.kind === 'retail') {
    const rid = idStr(raw.retailId)
    const r = rid ? (cat.retailItems || []).find((x) => x.id === rid) : null
    if (!r || r.active === false) return { error: `สินค้า "${text(raw.name, 200) || rid || ''}" ไม่พร้อมขายในระบบ` }
    // สินค้าไม่กำหนดราคา (openPrice) ขายได้เฉพาะหน้าร้าน (POS) · ราคาตั้งตอนขาย ไม่มีราคาตั้งต้นให้เซิร์ฟเวอร์คิด
    if (r.openPrice) return { error: `สินค้า "${text(raw.name, 200) || rid || ''}" กำหนดราคาที่หน้าร้านเท่านั้น สั่งผ่านเว็บไม่ได้` }
    // สินค้าหน้าร้านคิดจากราคาตั้งต้นของสินค้าเท่านั้น (ไม่มีตัวเลือกเค้ก/ชั้น เหมือนการขายหน้าร้าน)
    delete out.tiers
    Object.assign(out, { retailId: rid, retailPrice: Number(r.price) || 0, sizeId: r.sizeId || null, typeId: r.typeId || null, name: r.name || '', selections: {} })
  }
  return { item: out }
}

const fail = (error, code = 'invalid') => ({ ok: false, code, error })

// ใบเสนอ 1 ใบ → payload ที่ส่งให้ลูกค้า (ราคาคิดจากแคตาล็อกล้วน) · ไม่ได้ข้อมูล/ร้านปิดรับนัด = { ok: false, error, code }
// draft: ข้อมูลที่พนักงานกรอก (fulfillment, pickupAt, items, birthday, ค่าจัดส่ง) · customerId: ลูกค้าของแชท · nowMs: เวลาปัจจุบัน (ms)
// birth = สิทธิเดือนเกิดจากเซิร์ฟเวอร์ (punpang_member_birth_for_quote) · ไม่มี = ไม่คิดส่วนลดเดือนเกิด
// customerFacing = ใบเสนอที่ส่งลูกค้า (รับเฉพาะบริการที่เปิดให้ลูกค้าเห็น) · ออร์เดอร์หน้าร้าน/ตรวจย้อนหลังไม่ตั้ง
export function buildQuotePayload({ draft, customerId, catalog, nowMs, checkClosure = true, birth = null, customerFacing = false }) {
  const d = isObj(draft) ? draft : {}
  const cat = catalog || {}
  if (d.fulfillment !== 'pickup' && d.fulfillment !== 'delivery') return fail('รูปแบบการรับสินค้าไม่ถูกต้อง')
  if (typeof d.pickupAt !== 'string' || !TIME_RE.test(d.pickupAt) || Number.isNaN(pickupMs(d.pickupAt))) return fail('วันเวลานัดไม่ถูกต้อง')
  if (!Array.isArray(d.items) || d.items.length < 1 || d.items.length > MAX_ITEMS) return fail(`ใบเสนอต้องมีรายการสินค้า 1–${MAX_ITEMS} รายการ`)

  if (checkClosure) {
    const closure = closureAt(cat.shop || {}, bkkWall(pickupMs(d.pickupAt)))
    if (closure) return fail(`ร้านปิด (${closure.reason}) เลือกวัน-เวลานัดอื่น`, 'closed')
  }

  const items = []
  for (const raw of d.items) {
    if (isObj(raw) && raw.promoGift) continue
    const r = cleanItem(raw, cat)
    if (r.error) return fail(r.error)
    items.push(r.item)
  }
  if (!items.length) return fail('ใบเสนอต้องมีรายการสินค้า')
  // บริการเกี่ยวกับเงิน: ค่าบริการเป็นรายการ (ราคาจากการตั้งค่าร้าน) · เงินพักคิดจากธนบัตรที่นี่ · รายการ kind 'service' จากเครื่องถูกปฏิเสธแล้วด้านบน
  // ต่อรายการเค้ก (cashService ในรายการ) · ออร์เดอร์เก่าที่บริการระดับออร์เดอร์ (d.cashService) ยังใช้ได้เมื่อไม่มีบริการในรายการ
  let cash = cashServicesOf(items, cat.shop, { customerFacing })
  if (!cash.ok) return fail(cash.error)
  if (d.cashService !== undefined && d.cashService !== null) {
    if (cash.items.length) return fail('ใช้บริการได้ทางเดียว (ต่อรายการหรือระดับออร์เดอร์)')
    const legacy = cashServiceOf(d.cashService, cat.shop, { customerFacing })
    if (!legacy.ok) return fail(legacy.error)
    cash = { ok: true, items: legacy.item ? [legacy.item] : [], holdMoney: legacy.holdMoney }
  }

  const wall = bkkWall(nowMs)
  const dateStr = toDateStr(wall)
  const w = withPromosOn(items.map((it) => priceItemOn(it, cat, dateStr)), cat, { at: wall, dateStr })
  // ส่วนลดเดือนเกิด (หมวดเค้กที่ร้านเลือก) คิดตอนออกใบเสนอ ใบเสนอจึงเก็บยอดนี้ไว้
  const bd = birth ? birthCakeDiscount({
    items: w.items.map((i) => ({ id: i.retailId || '', category: (cat.retailItems || []).find((r) => r.id === i.retailId)?.category || '', unitPrice: i.unitPrice, qty: i.qty })),
    cakeCategories: birth.cakeCategories || [], cakeItemIds: birth.cakeItemIds || [], birth,
  }) : { amount: 0, base: 0 }
  const payload = JSON.parse(JSON.stringify({
    ...(bd.amount > 0 ? { birthdayDiscount: { amount: bd.amount, rate: birth.rate, cap: birth.cap, base: bd.base } } : {}),
    customerId: customerId ?? null,
    pickupAt: d.pickupAt,
    fulfillment: d.fulfillment,
    ...deliveryFieldsOf(d),
    birthday: cleanBirthday(d.birthday),
    items: [...w.items, ...cash.items],
    ...(cash.holdMoney ? { holdMoney: cash.holdMoney } : {}),
    shipPromo: w.shipPromo,
    promoOn: true,
    vat: vatOf(cat.shop),
  }))
  return { ok: true, payload }
}
