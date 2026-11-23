// สินค้าไม่กำหนดราคา (openPrice): ผู้ขายหน้าร้านกรอกราคาตอนขาย · ใช้ได้เฉพาะ POS (เว็บ/สร้างออร์เดอร์ผ่านเซิร์ฟเวอร์ไม่รับ)
// ฟังก์ชันล้วน ใช้ร่วมกันทั้งหน้า POS และการบันทึกบิล
export const OPEN_PRICE_MAX = 1000000

// ตรวจราคาที่กรอก: จำนวนบาท > 0 ไม่เกินเพดาน สูงสุดทศนิยม 2 ตำแหน่ง
export function openPriceOk(raw) {
  const s = String(raw ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, value: 0, error: 'กรอกราคาเป็นตัวเลขไม่เกิน 2 ตำแหน่งทศนิยม' }
  const v = Math.round(Number(s) * 100) / 100
  if (!(v > 0)) return { ok: false, value: 0, error: 'ราคาต้องมากกว่า 0' }
  if (v > OPEN_PRICE_MAX) return { ok: false, value: 0, error: `ราคาต้องไม่เกิน ${OPEN_PRICE_MAX.toLocaleString('en-US')} บาท` }
  return { ok: true, value: v, error: '' }
}
