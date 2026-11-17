// บิล POS ที่ปิดแล้วย้อนหลัง (หน้า /admin/pos/bills) · ฟังก์ชันล้วน ไม่แตะฐานข้อมูล
// ปิดแล้ว = บิลหน้าร้านที่ไม่ใช่บิลค้างชำระ (pos_pending) · บิลที่ยกเลิกยังแสดง แต่หน้าเรียกไม่นับยอด
import { returnedByMethod } from './refund.js'

export const isClosedPosBill = (o) => !!o && o.channel === 'pos' && o.status !== 'pos_pending'

// วันที่ขายของบิลหน้าร้าน (YYYY-MM-DD) ใช้ pickupAt ก่อน เพราะเป็นเวลาท้องถิ่นและตรงกับตัวกรองฐานข้อมูล
export const posBillDay = (o) => String(o?.pickupAt || o?.createdAt || '').slice(0, 10)

// บิลปิดแล้วในช่วงวันที่ (รวมทั้งสองวัน) · ว่าง = ไม่จำกัด · เรียงจากใหม่สุดไปเก่าสุด
export function closedPosBillsInRange(items, from = '', to = '') {
  return (items || [])
    .filter((o) => isClosedPosBill(o))
    .filter((o) => {
      const d = posBillDay(o)
      return (!from || d >= from) && (!to || d <= to)
    })
    .sort((a, b) => String(b.createdAt || b.pickupAt || '').localeCompare(String(a.createdAt || a.pickupAt || '')))
}

// วิธีชำระที่ยืนยันแล้วของบิล (เช่น ['cash', 'card'] เมื่อแบ่งจ่าย) · ไม่ระบุวิธี = เงินสด (เหมือนระบบเดิม)
export const payMethodsOf = (o) => [...new Set((o?.payments || []).filter((p) => p.status === 'confirmed').map((p) => p.posMethod || 'cash'))]

// เงินรับสุทธิแยกวิธีชำระ (ไม่นับบิลยกเลิก · หักยอดคืนบางส่วนตามวิธีเดียวกับสรุปกะ)
export function posMethodTotals(items) {
  const out = { cash: 0, transfer: 0, card: 0 }
  for (const o of items || []) {
    if (o.status === 'cancelled') continue
    for (const p of o.payments || []) {
      if (p.status !== 'confirmed') continue
      const m = p.posMethod || 'cash'
      out[m] = (out[m] || 0) + (Number(p.amount) || 0)
    }
    const rb = returnedByMethod(o)
    if (rb.cash) out.cash -= rb.cash
    if (rb.transfer) {
      const m = o.payments?.find((p) => p.status === 'confirmed' && (p.posMethod || 'cash') !== 'cash')?.posMethod || 'transfer'
      out[m] = (out[m] || 0) - rb.transfer
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100
  return out
}

// กรองบิลที่ปิดแล้ว · status: 'all' | 'closed' | 'cancelled' · method: '' | 'cash' | 'transfer' | 'card'
// q ค้นจากข้อความที่ textOf(o) คืนมา (เลขบิล ชื่อลูกค้า ชื่อสินค้า) ไม่สนตัวพิมพ์
export function filterPosBills(items, { q = '', status = 'all', method = '', textOf = () => '' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return (items || []).filter((o) => {
    if (status === 'cancelled' && o.status !== 'cancelled') return false
    if (status === 'closed' && o.status === 'cancelled') return false
    if (method && !payMethodsOf(o).includes(method)) return false
    return !needle || String(textOf(o) || '').toLowerCase().includes(needle)
  })
}
