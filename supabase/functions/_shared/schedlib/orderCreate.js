// สร้างข้อมูลออร์เดอร์ใหม่ (ชุดเดียวกับ createOrder ใน store.js) โดยราคาทุกบาทคิดที่นี่ ไม่เชื่อราคาที่ส่งมา
// · ใช้ทั้งในแอป และ Edge Function order-create (ผ่าน _shared/schedlib) เพื่อให้ได้ผลเหมือนกัน
// · กติกาที่ trigger ฐานข้อมูลเคยตรวจ (คะแนน/ส่วนลดตามสิทธิ์/คูปอง/ออร์เดอร์จากใบเสนอ) อยู่ในนี้ด้วย
//   เพราะบทบาทบริการ (service role) ข้าม trigger เหล่านั้น
// · รัน: node src/lib/orderCreate.test.mjs
import { buildQuotePayload, deliveryFieldsOf } from './quotePrice.js'
import { orderTotals } from './pricing.js'

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const fail = (error, kind = '') => ({ ok: false, error, ...(kind ? { kind } : {}) })

// เหมือน punpang_has_perm: ผู้จัดการ (manage) ทำได้ทุกอย่าง
export const hasPerm = (perms, p) => Array.isArray(perms) && (perms.includes('manage') || perms.includes(p))
export const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const ORDER_CODE_RE = /^OR-\d{6}-\d{6}$/
// โหมดทดสอบ: แอปเติม TEST- นำหน้าเลขออร์เดอร์ (ตรงกับ src/lib/testMode.js) · โหมดจริงต้องไม่มี TEST-
export const TEST_ORDER_PREFIX = 'TEST-'
// ตรวจเลขออร์เดอร์ตามโหมด: โหมดทดสอบต้องมี TEST- นำหน้า · โหมดจริงต้องเป็นรูปแบบปกติ (ไม่มี TEST-)
export const orderCodeOk = (code, test = false) => {
  const s = String(code || '')
  return test ? s.startsWith(TEST_ORDER_PREFIX) && ORDER_CODE_RE.test(s.slice(TEST_ORDER_PREFIX.length)) : ORDER_CODE_RE.test(s)
}
const MAX_TEXT = 500

// ยอดปรับราคาตอนสร้าง (ติดลบ = ส่วนลด): ต้องมีสิทธิ์ปรับราคา + เหตุผล + ไม่เกินยอดสินค้า
export function adjustmentOf(raw, perms, subtotal) {
  const amount = isObj(raw) ? Number(raw.amount ?? 0) : 0
  if (!Number.isFinite(amount)) return fail('ยอดปรับราคาไม่ถูกต้อง')
  if (amount === 0) return { ok: true, value: { amount: 0, reason: '' } }
  if (!hasPerm(perms, 'adjustPrice')) return fail('ไม่มีสิทธิ์ปรับราคาหรือส่วนลด', 'forbidden')
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, MAX_TEXT) : ''
  if (!reason) return fail('ต้องระบุเหตุผลการปรับราคา')
  if (amount < -subtotal) return fail('ส่วนลดเกินยอดสินค้า')
  return { ok: true, value: { amount: Math.round(amount * 100) / 100, reason } }
}

// ฟิลด์ที่แอปเก็บเมื่อกดบันทึกออร์เดอร์ (ตรงกับ createOrder)
export function buildOrderFromDraft({
  draft = /** @type {any} */ (null), customerId = /** @type {any} */ (null), catalog = /** @type {any} */ (null), nowMs, perms = /** @type {string[]} */ ([]), asDraft = false,
  id, code, chatId = null, quoteId = null, quotePayload = null, by = '', occasionKind = '', occasionConsent = false, test = false, birth = null,
}) {
  if (!ORDER_ID_RE.test(String(id || ''))) return fail('รหัสออร์เดอร์ไม่ถูกต้อง')
  if (!orderCodeOk(code, test)) return fail('เลขออร์เดอร์ไม่ถูกต้อง')

  // ใบเสนอที่ลูกค้ายืนยันแล้ว: ใช้ราคาที่เซิร์ฟเวอร์คิดไว้ตอนส่งใบเสนอ (ไม่คิดใหม่)
  let p
  if (quotePayload) {
    if (!isObj(quotePayload) || !Array.isArray(quotePayload.items) || !quotePayload.items.length) return fail('ใบเสนอไม่มีรายการสินค้า')
    p = quotePayload
  } else {
    const built = buildQuotePayload({ draft, customerId, catalog, nowMs, birth })
    if (!built.ok) return fail(built.error, built.kind || '')
    p = built.payload
  }

  const wall = new Date(nowMs).toISOString()
  const order = {
    id,
    code,
    customerId: p.customerId ?? customerId ?? null,
    pickupAt: p.pickupAt,
    fulfillment: p.fulfillment,
    chatId: chatId || null,
    ...(quoteId ? { quoteId } : {}),
    birthday: p.birthday?.md ? { name: p.birthday.name || '', md: p.birthday.md } : null,
    occasion: occasionConsent && occasionKind ? { kind: String(occasionKind).slice(0, 40), consent: true } : null,
    ...deliveryFieldsOf(p),
    items: p.items,
    shipPromo: p.shipPromo ?? null,
    promoOn: true,
    ...(p.birthdayDiscount ? { birthdayDiscount: p.birthdayDiscount } : {}), // ส่วนลดเดือนเกิด (ตรวจที่เซิร์ฟเวอร์)
    vat: p.vat !== undefined ? p.vat : null,
    adjustment: { amount: 0, reason: '' },
    pointsUsed: null, // คะแนนใช้กับออร์เดอร์ทีหลังผ่านเซิร์ฟเวอร์เท่านั้น
    couponsUsed: [], // คูปองจองทีหลังผ่านเซิร์ฟเวอร์เท่านั้น
    loyalty: null,
    status: asDraft ? 'draft' : 'awaiting_payment',
    payments: [],
    cancel: null,
    history: [{ at: wall, text: asDraft ? 'สร้างออร์เดอร์ (ร่าง)' : 'สร้างออร์เดอร์ → รอชำระ', by: String(by || '').slice(0, 60) }],
    createdAt: wall,
  }

  const adj = adjustmentOf(draft?.adjustment ?? null, perms, orderTotals(order).subtotal)
  if (!adj.ok) return adj
  order.adjustment = adj.value
  return { ok: true, order }
}

// คอลัมน์ของแถว punpang_orders (ตรงกับ orderToRow เดิมของ ordersSync) · balance คำนวณจากข้อมูลออร์เดอร์
export function balanceOf(o) {
  try { const b = orderTotals(o).balance; return Number.isFinite(b) ? Math.round(b * 100) / 100 : null } catch { return null }
}
export function orderRowOf(o) {
  const { id, code, customerId, status, fulfillment, channel, ...rest } = o
  // pickupAt เป็นเวลาท้องถิ่นแบบไม่มีโซน เก็บฉบับจริงใน data · คอลัมน์ pickup_at ไว้เรียง/ค้นหาเท่านั้น
  return { id, code, customer_id: customerId || null, status, fulfillment, channel: channel || null, pickup_at: o.pickupAt || null, balance: balanceOf(o), data: rest }
}
