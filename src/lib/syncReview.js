// คิวรอตรวจของผู้จัดการ (ตาราง punpang_sync_review) · ออร์เดอร์ใหม่ที่ระบบไม่รับถาวรและมีการเงิน/แต้ม/คูปอง/รูปที่อัปโหลดแล้ว
// เครื่องพนักงานเก็บลงคิวก่อน แล้วค่อยเอาออกจากเครื่อง · ผู้จัดการอ่านได้ทุกเครื่อง แล้วส่งซ้ำ แก้ไขการชำระแล้วส่ง หรือปิดพร้อมเหตุผล
import { isTransientError } from './tableSync'

export const REVIEW_TABLE = 'punpang_sync_review'
const REVIEW_COLS = 'id,order_id,order_code,channel,reason_code,reason_message,payload,edited_payload,status,created_by,created_at,resolved_by,resolved_at,resolution_note'

// แถวที่เก็บในคิว: ต้นฉบับทั้งออร์เดอร์เป็น JSON ล้วน (ค่าที่ไม่ใช่ข้อมูล เช่น เวอร์ชันในเครื่อง ไม่ถูกเก็บ) + เหตุผลที่ระบบปฏิเสธ
export function reviewRowOf(o, err) {
  return {
    order_id: String(o.id),
    order_code: String(o.code || '').slice(0, 40),
    channel: o.channel || null,
    reason_code: String(err?.code || err?.status || '').slice(0, 20),
    reason_message: String(err?.message || 'ไม่ผ่านการตรวจ').slice(0, 500),
    payload: JSON.parse(JSON.stringify(o)),
  }
}

// เก็บลงคิว → { ok:true } · ไม่สำเร็จ → { ok:false, transient, message }
// ชั่วคราว (เน็ตหลุด/เซิร์ฟเวอร์ล่ม) → ลองใหม่ตามรอบ · ถาวร (ไม่มีสิทธิ์/ข้อมูลไม่ผ่าน) → ออร์เดอร์ค้างในเครื่องให้เห็น
// 23505 = มีรายการเปิดของออร์เดอร์นี้อยู่แล้ว (เก็บไปแล้วแต่คำตอบหาย) → นับว่าสำเร็จ กันเก็บซ้ำ
export async function queueForReview(client, o, err) {
  const r = await client.from(REVIEW_TABLE).insert(reviewRowOf(o, err))
  if (!r.error || String(r.error.code) === '23505') return { ok: true }
  return { ok: false, transient: isTransientError({ code: r.error.code, status: r.status }), message: r.error.message || 'เก็บเข้าคิวไม่สำเร็จ' }
}

// ---------- ฝั่งผู้จัดการ ----------

// จำนวนรายการที่ยังรอตรวจ (ป้ายบนหน้าตั้งค่า) · ไม่มีสิทธิ์อ่านคิวหรือไม่ได้เชื่อมต่อ = 0
export async function countOpenReview(client) {
  if (!client) return 0
  try {
    const r = await client.from(REVIEW_TABLE).select('id', { count: 'exact', head: true }).eq('status', 'open')
    return r.error ? 0 : (r.count || 0)
  } catch { return 0 }
}

// รายการในคิวตามสถานะ (เก่าสุดขึ้นก่อน)
export async function fetchReview(client, status = 'open', limit = 200) {
  const r = await client.from(REVIEW_TABLE).select(REVIEW_COLS).eq('status', status).order('created_at').limit(limit)
  if (r.error) return { error: r.error.message }
  return { items: r.data || [] }
}

// เปลี่ยนเฉพาะรายการที่ยังเปิด (กันทับกันเมื่อมีคนแก้พร้อมกัน) · ผู้ทำและเวลาฐานข้อมูลบันทึกเอง
async function setOpen(client, id, values) {
  const r = await client.from(REVIEW_TABLE).update(values, { count: 'exact' }).eq('id', id).eq('status', 'open')
  if (r.error) return { error: r.error.message || 'บันทึกไม่สำเร็จ' }
  if (!r.count) return { error: 'รายการนี้ถูกเปลี่ยนไปแล้ว กดโหลดใหม่แล้วลองอีกครั้ง' }
  return { ok: true }
}
// บันทึกฉบับที่ผู้จัดการแก้การชำระไว้ (ยังไม่ส่ง)
export const saveEditedReview = (client, row, edited) => setOpen(client, row.id, { edited_payload: edited })
// ปิดพร้อมเหตุผล: ฐานข้อมูลคืนคูปองที่จองไว้กับออร์เดอร์นี้ให้ลูกค้าใช้ได้อีก และตรวจว่ารายการยังเปิดอยู่
export async function closeReview(client, row, note) {
  const r = await client.rpc('punpang_review_close', { p_id: row.id, p_note: String(note || '').trim() })
  if (r.error) return { error: r.error.message || 'ปิดรายการไม่สำเร็จ' }
  return { ok: true }
}

// ส่งซ้ำ: ฐานข้อมูลอ่านต้นฉบับหรือฉบับที่แก้จากคิวเอง (เบราว์เซอร์ไม่ส่งออร์เดอร์) และทำทั้งหมดในธุรกรรมเดียว
// confirmed = ผู้จัดการตรวจคูปองและส่วนลดแล้ว (จำเป็นเมื่อมี) · ฐานข้อมูลตรวจซ้ำทุกด่านและปฏิเสธเมื่อไม่ผ่าน รายการยังอยู่ในคิว
export async function resendReview(client, row, confirmed = false) {
  const r = await client.rpc('punpang_review_resend', { p_id: row.id, p_confirmed: !!confirmed })
  if (r.error) return { error: r.error.message || 'ส่งซ้ำไม่สำเร็จ' }
  return { ok: true }
}
// เหตุที่ส่งซ้ำจากคิวไม่ได้ (แสดงให้ผู้จัดการเห็นก่อนกด · ฐานข้อมูลตรวจซ้ำเสมอ)
export function resendBlockers(src) {
  const out = []
  if (src?.pointsUsed) out.push('มีแต้มที่ใช้')
  if (src?.loyalty) out.push('มีสิทธิ์สมาชิก')
  if (src?.quoteId) out.push('มาจากใบเสนอราคา')
  if ((src?.returns || []).length) out.push('มีการคืนสินค้า')
  if (src?.cancel) out.push('มีการยกเลิก')
  return out
}
// คูปองและส่วนลดปรับเองที่ผู้จัดการต้องตรวจก่อนส่งซ้ำ
export function reviewExtras(src) {
  const coupons = Array.isArray(src?.couponsUsed) ? src.couponsUsed : []
  return { coupons, adjustment: Number(src?.adjustment?.amount) || 0 }
}
export const needsConfirm = (src) => { const x = reviewExtras(src); return x.coupons.length > 0 || x.adjustment !== 0 }

// การชำระเงินที่ผู้จัดการแก้ได้: ยอดและการยืนยันบัตร · ลบรายการได้ · ส่วนอื่นของออร์เดอร์ไม่แก้ที่หน้านี้
export const paymentsOf = (src) => (src?.payments || []).map((p) => ({ ...p }))
export const withPayments = (base, payments) => ({ ...base, payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })) })
export function paymentsError(payments) {
  if (payments.some((p) => !(Number(p.amount) > 0))) return 'ยอดของทุกรายการต้องมากกว่า 0'
  return ''
}
