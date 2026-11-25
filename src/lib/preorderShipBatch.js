// กรอกการส่งสั่งล่วงหน้าทั้งชุด (ฟังก์ชันล้วน): เลือกออร์เดอร์ที่พร้อมส่ง · แยกเลขพัสดุจากข้อความที่วาง · จับคู่ตามลำดับแถว · ตรวจก่อนบันทึก
// กติกาเลขพัสดุและค่าไปรษณีย์ตรงกับฐานข้อมูล (punpang_preorder_set_shipping): ความยาว 3–60 ตัวอักษร A–Z 0–9 และขีด · ค่าไปรษณีย์ 0–100000 ทศนิยมไม่เกิน 2 ตำแหน่ง

export const TRACKING_RE = /^[A-Za-z0-9-]{3,60}$/
export const POSTAGE_MAX = 100000

// ออร์เดอร์ที่พร้อมส่ง: จัดส่งพัสดุ ชำระครบแล้ว และยังอยู่สถานะรอส่ง
export function shippableOrders(list) {
  return (Array.isArray(list) ? list : []).filter((o) => o.status === 'payment_confirmed' && o.fulfillment === 'delivery' && Number(o.paid) >= Number(o.total))
}

// แยกเลขพัสดุจากข้อความที่วาง: หนึ่งบรรทัดต่อหนึ่งรายการ ข้ามบรรทัดว่าง
export function splitPaste(text) {
  return String(text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

// จับคู่เลขพัสดุกับแถวตามลำดับ · แถวที่เกินจำนวนเลขจะไม่ถูกแก้ · คืนจำนวนเลขที่เหลือเกินแถวด้วย
export function applyPaste(rows, lines) {
  const out = rows.map((r, i) => (i < lines.length ? { ...r, tracking: lines[i] } : r))
  return { rows: out, leftover: Math.max(0, lines.length - rows.length) }
}

// ค่าไปรษณีย์จากช่องกรอก: ว่าง = 0 · คืน null เมื่อไม่ถูกต้อง
export function postageValue(s) {
  if (s === '' || s == null) return 0
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > POSTAGE_MAX || Math.round(n * 100) !== n * 100) return null
  return n
}

// ตรวจทั้งชุดก่อนบันทึก: ขนส่ง (ใช้ร่วมกันทั้งชุด) · เลขพัสดุผิดรูปแบบ · เลขซ้ำในชุดเดียวกัน · ค่าไปรษณีย์ผิด
// rows = [{orderId, tracking, postage}] · คืน { carrierError, rowErrors: { [orderId]: ข้อความ } }
export function validateBatch(rows, carrier) {
  const rowErrors = {}
  const seen = new Map()
  const c = String(carrier ?? '').trim()
  const carrierError = c === '' ? 'ต้องเลือกขนส่ง' : c.length > 40 ? 'ชื่อขนส่งยาวเกินไป' : ''
  for (const r of rows) {
    const t = String(r.tracking ?? '').trim().toUpperCase()
    if (t === '') rowErrors[r.orderId] = 'ยังไม่กรอกเลขพัสดุ'
    else if (!TRACKING_RE.test(t)) rowErrors[r.orderId] = 'เลขพัสดุต้องเป็น A–Z 0–9 หรือขีด 3–60 ตัว'
    else if (seen.has(t)) rowErrors[r.orderId] = `เลขซ้ำกับแถวอื่นในชุดนี้ (${seen.get(t)})`
    else seen.set(t, r.orderId)
    if (!rowErrors[r.orderId] && postageValue(r.postage) === null) rowErrors[r.orderId] = 'ค่าไปรษณีย์ต้องเป็นตัวเลข 0–100000 ทศนิยมไม่เกิน 2 ตำแหน่ง'
  }
  return { carrierError, rowErrors }
}
