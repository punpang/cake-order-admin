// ตัวช่วยหน้าบัญชีลูกค้า (ฟังก์ชันล้วน ไม่แตะ DOM)
// ค่าตัวอย่างตั้งต้นที่ยังไม่ได้แก้หลังบ้าน (มี "(ตัวอย่าง)") ไม่ควรแสดงให้ลูกค้า
export const isSampleName = (name) => /\(ตัวอย่าง\)/.test(String(name ?? ''))

// คำนำหน้าชื่อที่ไม่ใช่ชื่อจริง
const PREFIX = /^(คุณ|นางสาว|นาง|นาย|ด\.ช\.|ด\.ญ\.|Mrs?\.?|Ms\.?|Miss)\s*/i
// สระหน้า (เ แ โ ใ ไ) และเครื่องหมายกำกับ ข้ามเพื่อหาพยัญชนะตัวแรก
const SKIP = /[เแโใไัิ-ฺ็-๎\s]/

// อักษรในวงกลมชื่อ: ข้ามคำนำหน้า และสระหน้า/เครื่องหมายกำกับ เพื่อให้ได้พยัญชนะตัวแรกจริง
export function initialOf(name) {
  const s = String(name ?? '').trim().replace(PREFIX, '')
  for (const ch of s) if (!SKIP.test(ch)) return ch.toUpperCase()
  return '?'
}

// คะแนนที่ยังขาดก่อนแลกรางวัลนี้ (0 = พอแล้ว)
export const pointsShortfall = (points, required) => Math.max(0, Number(required || 0) - Number(points || 0))
