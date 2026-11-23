// สถานะจอลูกค้า (จอที่ 2) · ฟังก์ชันล้วน ไม่แตะ store/เครื่อง (เทสต์ได้ตรง ๆ)
// ลำดับความสำคัญ: QR ถุงเงินที่ค้างจากหน้าออร์เดอร์ > สถานะจาก POS > ต้อนรับ/โฆษณา

// หน้าพักของจอ (ไม่อยู่ในบิล): ยินดีต้อนรับ/โฆษณาวนเมื่อไม่มีรายการ
export function idleDisplay(shopName = '', ads = null) {
  return { status: 'idle', shopName: String(shopName || ''), ads: ads || null }
}

// QR ถุงเงินจากหน้าออร์เดอร์: แสดงยอดและ QR ให้ลูกค้าสแกน (ไม่มีรายการสินค้า)
export function orderQrDisplay({ amount, payload }, shopName = '') {
  const n = Number(amount) || 0
  return {
    status: 'paying',
    shopName: String(shopName || ''),
    total: n,
    remaining: n,
    payLines: [{ method: 'โอนเงิน (QR)', amount: n, done: false }],
    qr: { amount: n, payload },
  }
}

// ชำระแล้วจาก QR ถุงเงิน: ฉลองชั่วครู่แล้วคืนจอ
export function orderPaidDisplay(amount, shopName = '') {
  const n = Number(amount) || 0
  return { status: 'paid', shopName: String(shopName || ''), amount: n, total: n, remaining: 0, member: null }
}

// เลือกสถานะที่จะส่งจริง: QR ที่ค้างอยู่ชนะสถานะจาก POS เสมอ
export function pickDisplay(hold, posState) {
  return hold || posState
}

// สถานะของรายการชำระที่เปิด QR ค้างไว้: ยังรอ / ชำระแล้ว / ยกเลิกหรือหมดเวลา
export function holdStatusOf(payment, nowMs, expiresAtMs) {
  if (!payment) return 'gone'
  if (payment.status === 'confirmed') return 'paid'
  if (payment.status === 'cancelled') return 'gone'
  if (Number.isFinite(expiresAtMs) && nowMs > expiresAtMs) return 'gone'
  return 'waiting'
}
