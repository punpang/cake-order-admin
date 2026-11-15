// กติกาผูกยอดโอนที่รับชำระแล้วเข้าบิลค้าง (ใช้ใน Pos.vue · แยกไว้เพื่อทดสอบ)
// รายการที่ "รับแล้วแต่ยังไม่ได้ผูกเข้าบิล" = ยอดที่ยังไม่ได้บันทึก ถ้าปิดหน้าชำระตอนนี้จะหาย
const amountOf = (l) => Math.round((Number(l?.amount) || 0) * 100) / 100

// รับชำระแล้ว (ยืนยันแล้ว) ยอด > 0 และยังไม่ได้ผูก (ยังไม่ล็อก)
export const isUnsaved = (l) => !!l && !!l.confirmed && !l.locked && amountOf(l) > 0

// ต้องผูกทันที: ยังขาดยอด (ยอดรับยังไม่ครบ) และมียอดรับแล้วที่ยังไม่ได้ผูก
export const needBind = (lines, remaining) => remaining > 0 && lines.some(isUnsaved)

// เงินสดที่รับไม่ครบยอดกดผูกเป็นบิลค้างได้: ยอดรับ ≥ ยอดชำระของรายการ · ยังไม่ผูก · ยังขาดยอดรวม
export const canBindCash = (l, remaining) => !!l && l.method === 'cash' && !l.confirmed && !l.locked && amountOf(l) > 0 && (Number(l.received) || 0) >= amountOf(l) && remaining > 0

// ปิดหน้าชำระได้ไหม: ถ้ายังมียอดรับแล้วที่ไม่ได้ผูก ห้ามปิด และบอกว่าต้องทำอะไรก่อน
export function closeGuard(lines, remaining) {
  if (!lines.some(isUnsaved)) return { block: false, message: '' }
  if (remaining > 0) return { block: true, message: 'มียอดที่รับแล้วยังไม่ได้บันทึกเป็นบิลค้าง กด "บันทึกบิลค้างไว้" ก่อนปิด' }
  if (remaining === 0) return { block: true, message: 'มียอดที่รับแล้วยังไม่ได้บันทึก กด "ยืนยันรับเงิน" ก่อนปิด หรือกด "ยกเลิกการรับชำระ" ที่รายการนั้น' }
  return { block: true, message: 'ยอดที่รับแล้วเกินยอดชำระ ปรับยอดให้พอดีก่อนปิด หรือกด "ยกเลิกการรับชำระ" ที่รายการนั้น' }
}
