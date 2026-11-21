// คิวรอตรวจของผู้จัดการ (ตาราง punpang_sync_review) · ออร์เดอร์ใหม่ที่ระบบไม่รับถาวรและมีการเงิน/แต้ม/คูปอง/รูปที่อัปโหลดแล้ว
// เครื่องพนักงานเก็บลงคิวก่อน แล้วค่อยเอาออกจากเครื่อง · ผู้จัดการอ่านได้ทุกเครื่อง แล้วส่งซ้ำ แก้ไขการชำระแล้วส่ง หรือปิดพร้อมเหตุผล
import { isTransientError } from './tableSync'
import { orderRowOf } from './orderCreate.js'

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
// ปิดพร้อมเหตุผล (ต้องมีเหตุผล · ฐานข้อมูลตรวจซ้ำอีกชั้น)
export const closeReview = (client, row, note) => setOpen(client, row.id, { status: 'closed', resolution_note: String(note || '').trim() })

// ส่งซ้ำเป็นบิลหน้าร้านใหม่ (เขียนตรงเหมือนบิล POS) · ใช้ฉบับที่แก้ไว้ถ้ามี
// ออร์เดอร์นี้มีอยู่แล้ว (pkey ซ้ำ) = เคยส่งไปแล้ว → ปรับสถานะต่อ · ช่องทางอื่นไม่รองรับที่นี่
export async function resendReview(client, row, source) {
  if (row.channel !== 'pos') return { error: 'ส่งซ้ำได้เฉพาะบิลหน้าร้าน · ช่องทางนี้ให้ปิดพร้อมเหตุผลแล้วสร้างใหม่ในระบบ' }
  const ins = await client.from('punpang_orders').insert(orderRowOf(source))
  const existed = String(ins.error?.code) === '23505' && /pkey/.test(ins.error?.message || '')
  if (ins.error && !existed) return { error: ins.error.message || 'ส่งซ้ำไม่สำเร็จ' }
  return setOpen(client, row.id, { status: 'resent' })
}

// การชำระเงินที่ผู้จัดการแก้ได้: ยอดและการยืนยันบัตร · ลบรายการได้ · ส่วนอื่นของออร์เดอร์ไม่แก้ที่หน้านี้
export const paymentsOf = (src) => (src?.payments || []).map((p) => ({ ...p }))
export const withPayments = (base, payments) => ({ ...base, payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })) })
export function paymentsError(payments) {
  if (payments.some((p) => !(Number(p.amount) > 0))) return 'ยอดของทุกรายการต้องมากกว่า 0'
  return ''
}
