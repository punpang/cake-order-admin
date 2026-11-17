// บิลหน้าร้าน (POS) ที่ผลตรวจอัตโนมัติพบรายการ high (hold) และยังไม่มีผู้จัดการตรวจหลังผลตรวจนั้น
// กติกาเดียวกับฐานข้อมูล (การตรวจโดยผู้จัดการต้องเกิดหลัง checked_at) · ไม่กันการขาย ใช้เป็นคิวให้ผู้จัดการตรวจเท่านั้น

// เวลาจาก PostgREST อาจมีไมโครวินาที ตัดเหลือมิลลิวินาทีให้ Date อ่านได้ในทุกเบราว์เซอร์
const toMs = (s) => {
  const str = String(s ?? '')
  const m = /^(.*?\.\d{3})\d*(.*)$/.exec(str)
  return Date.parse(m ? m[1] + m[2] : str)
}

// audits: [{ order_id, checked_at }] ที่ hold · reviews: [{ order_id, reviewed_at }] → Set ของรหัสที่ยังค้างตรวจ
// เวลาตรวจอ่านไม่ได้ = ถือว่ายังค้าง (ปลอดภัยไว้ก่อน)
export function pendingPosHolds(audits, reviews) {
  const latest = new Map()
  for (const r of reviews || []) {
    const t = toMs(r.reviewed_at)
    if (Number.isFinite(t) && t > (latest.get(r.order_id) ?? -Infinity)) latest.set(r.order_id, t)
  }
  const pending = new Set()
  for (const a of audits || []) {
    const checked = toMs(a.checked_at)
    const reviewed = Number.isFinite(checked) && latest.has(a.order_id) && latest.get(a.order_id) >= checked
    if (!reviewed) pending.add(a.order_id)
  }
  return pending
}
