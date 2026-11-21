// ตัวช่วยแสดงผลของหน้าคิวรอตรวจ (ใช้กับ ManageSyncReview.vue) · ไม่แตะฐานข้อมูล ยกเว้นการอ่านชื่อลูกค้าที่ RLS อนุญาต
import { orderTotals } from './pricing.js'
import { money } from './format.js'

// หัวข้อภาษาไทยของรหัสที่เข้าคิวได้จริง (ออร์เดอร์ใหม่ที่ฐานข้อมูลปฏิเสธด้วย P0001)
// รหัสอื่นแสดงข้อความเดิมทั้งหมด ไม่เดาความหมายเพิ่ม
const REASON_LABELS = {
  punpang_over_bill: 'ยอดชำระเกินยอดบิล',
  punpang_card_unconfirmed: 'รับบัตรแต่ยังไม่ยืนยันรับบัตร',
  punpang_customer_deleted: 'ลูกค้าถูกลบแล้ว',
}
// ข้อความที่ไม่มีคำนำหน้า แต่เข้าคิวได้จริงจากด่านคูปองของตารางออร์เดอร์ (รหัสสิทธิ์ 42501)
const EXACT_LABELS = {
  'coupon is not claimed for this order or the discount is too large': 'คูปองใช้ไม่ได้: ถูกใช้ไปแล้วหรือส่วนลดเกินที่คูปองให้',
}
export function reasonText(message) {
  const text = String(message || '')
  if (EXACT_LABELS[text]) return { label: EXACT_LABELS[text], detail: '' }
  const m = /^(punpang_[a-z_]+):\s*([\s\S]*)$/.exec(text)
  if (m && REASON_LABELS[m[1]]) return { label: REASON_LABELS[m[1]], detail: m[2].trim() }
  return { label: 'ระบบไม่รับออร์เดอร์', detail: text }
}

// อายุรายการที่เข้าคิว เป็นข้อความสั้นอ่านเร็ว
export function ageText(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 1) return 'เมื่อสักครู่'
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`
  return `${Math.round(h / 24)} วันที่แล้ว`
}

// สรุปยอดของรายการ: ยอดบิลหลังส่วนลด ยอดที่ชำระแล้ว และส่วนต่าง · คำนวณไม่ได้ = null
export function billSummary(src) {
  if (!src) return null
  try {
    const t = orderTotals({ ...src, items: src?.items || [], payments: src?.payments || [] })
    const diff = Math.round((t.paid - t.total) * 100) / 100
    const state = diff > 0.005 ? 'over' : diff < -0.005 ? 'short' : 'ok'
    return { total: t.total, paid: t.paid, diff, state }
  } catch {
    return null
  }
}

// การชำระที่ยังไม่ถูกขีดฆ่า (off = รายการ index → true) · ใช้ทั้งยอดสด และตอนบันทึก เพื่อให้สองค่าตรงกัน
export const activePays = (list, off) => list.filter((_, i) => !off[i])

// ข้อความและสีของส่วนต่างยอด (เกิน = แดง · ขาด = เหลือง · ครบ = เขียว)
export function balanceText(s) {
  if (!s) return null
  if (s.state === 'over') return { tone: 'text-rose-700', text: `เกินยอดบิล ${money(Math.abs(s.diff))}` }
  if (s.state === 'short') return { tone: 'text-amber-700', text: `ขาดอีก ${money(Math.abs(s.diff))}` }
  return { tone: 'text-emerald-700', text: 'ชำระครบพอดี' }
}

// รายการสินค้าแบบสั้น: ชื่อ ×จำนวน สูงสุด 3 รายการ
export function itemsText(src) {
  const items = Array.isArray(src?.items) ? src.items : []
  const parts = items.slice(0, 3).map((i) => `${i.name} ×${i.qty}`)
  const more = items.length - parts.length
  return parts.join(' · ') + (more > 0 ? ` และอีก ${more} รายการ` : '')
}

// ชื่อลูกค้าจากตารางลูกค้า · RLS ให้อ่านเฉพาะบัญชีที่มีสิทธิ์ · อ่านไม่ได้ = ไม่มีชื่อ (หน้าจอแสดงรหัสแทน)
export async function customerNames(client, ids) {
  const out = new Map()
  const uniq = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < uniq.length; i += 100) {
    const r = await client.from('punpang_customers').select('id,name').in('id', uniq.slice(i, i + 100))
    if (r.error) return out
    for (const c of r.data || []) if (c.name) out.set(c.id, c.name)
  }
  return out
}
