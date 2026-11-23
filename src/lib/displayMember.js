// ข้อมูลสมาชิกบนจอลูกค้า (ปิดบังแล้ว) · ไม่ส่งชื่อ/เบอร์เต็มออกจากเครื่อง POS ไปจอลูกค้า
// ชื่อ: ตัวแรก + ●●● · เบอร์: 4 ตัวท้าย · ระดับและหลอดเลื่อนขั้นแสดงเฉพาะโหมดใช้จริง (โหมดทดลองลูกค้าไม่เห็นระดับ)
export function maskName(name) {
  const first = Array.from(String(name || '').trim())[0]
  return first ? `${first}●●●` : ''
}

export function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  return d.length >= 4 ? `•••••• ${d.slice(-4)}` : ''
}

// card = ป้ายระดับจาก punpang_member_staff_card · points = แต้มที่บิลนี้จะได้ (0 = ไม่แสดง)
export function displayMember(customer, card, points) {
  if (!customer) return null
  const out = {
    name: maskName(customer.name),
    phone: maskPhone(customer.phone),
    points: Math.max(0, Math.floor(Number(points) || 0)),
  }
  if (card?.enabled && card.mode === 'live') {
    // progress = false เมื่อ RPC ยังเป็นรุ่นเดิม (ไม่มีความคืบหน้า) → แสดงแค่ชื่อระดับ ไม่ขึ้น "ระดับสูงสุด" ผิด ๆ
    const progress = card.pct !== undefined
    out.tier = {
      levelName: String(card.levelName || ''),
      mult: Number(card.mult) || 1,
      progress,
      nextName: progress && card.nextName ? String(card.nextName) : '',
      toNext: Math.max(0, Number(card.toNext) || 0),
      pct: Math.min(100, Math.max(0, Math.round(Number(card.pct) || 0))),
    }
  }
  return out
}
