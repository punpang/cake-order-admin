// เงินพัก (ซ่อนเงิน/ดึงเงิน): กติกาธนบัตรและยอดคืน · ฟังก์ชันล้วน ใช้ร่วมทั้งแอปและเทสต์
// ธนบัตรที่ใช้ได้ 20/50/100/500/1000 บาท · จำนวนธนบัตรสูงสุดตั้งในหน้าตั้งค่า (0 = ไม่จำกัด)

export const NOTE_VALUES = [20, 50, 100, 500, 1000]
export const HOLD_KINDS = ['hide', 'pull'] // ซ่อนเงิน · ดึงเงิน

const countOf = (notes, v) => Math.max(0, Math.floor(Number(notes?.[v]) || 0))

// จำนวนธนบัตรรวม (ใบ)
export function holdCountOf(notes = {}) {
  return NOTE_VALUES.reduce((s, v) => s + countOf(notes, v), 0)
}

// มูลค่ารวมของธนบัตร (บาท)
export function holdAmountOf(notes = {}) {
  return Math.round(NOTE_VALUES.reduce((s, v) => s + v * countOf(notes, v), 0) * 100) / 100
}

// ตรวจเงินพัก → ข้อความผิดพลาด ('' = ผ่าน)
// hm = { kind, notes, amount } · opts = { maxNotes } (0 = ไม่จำกัดจำนวนใบ)
export function holdErrors(hm, { maxNotes = 0 } = {}) {
  if (!HOLD_KINDS.includes(hm?.kind)) return 'ประเภทเงินพักไม่ถูกต้อง'
  for (const v of NOTE_VALUES) {
    const n = Number(hm.notes?.[v] ?? 0)
    if (!Number.isInteger(n) || n < 0) return `จำนวนธนบัตร ${v} บาทต้องเป็นจำนวนเต็มไม่ติดลบ`
  }
  const count = holdCountOf(hm.notes)
  if (!(count > 0)) return 'ต้องระบุธนบัตรอย่างน้อย 1 ใบ'
  if (maxNotes > 0 && count > maxNotes) return `จำนวนธนบัตรเกินที่ตั้งไว้ (สูงสุด ${maxNotes} ใบ)`
  if (Math.abs(holdAmountOf(hm.notes) - Number(hm.amount)) > 0.005) return 'ยอดเงินพักไม่ตรงกับจำนวนธนบัตร'
  return ''
}

// ยอดคืนตอนยกเลิก = ไม่เกินเงินพักที่ค้าง และไม่เกินส่วนที่ชำระเกินยอดบิล (ไม่ติดลบ)
// liability = เงินพักที่ยังค้างอยู่ · paidNet = ยอดชำระสุทธิ · total = ยอดสินค้า+ค่าบริการ
export function holdCancelRefundOf({ liability = 0, paidNet = 0, total = 0 }) {
  const v = Math.min(Number(liability) || 0, (Number(paidNet) || 0) - (Number(total) || 0))
  return Math.max(0, Math.round(v * 100) / 100)
}

// เปลี่ยนเป็นจัดส่ง/ส่งมอบได้หรือไม่ · จัดส่ง: ต้องชำระครบเสมอ · รับที่ร้าน: ชำระครบ หรือ เงินพักชำระครบและมากกว่ายอดสินค้า (ยอดสินค้าค้างเป็นลูกหนี้)
export function canHandOver({ fulfillment, balance = 0, paidNet = 0, hold = 0, total = 0 }) {
  if (!(Number(balance) > 0.005)) return true
  if (fulfillment === 'delivery') return false
  return Number(hold) > 0 && Number(paidNet) + 0.005 >= Number(hold) && Number(hold) > Number(total)
}
