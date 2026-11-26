// ย้ายคะแนนจากระบบเดิม (ทีละคน): แต้มที่ได้ = แต้มที่กรอก × 2 × ตัวคูณระดับสูงสุด
// ลูกค้าได้ระดับสูงสุดโดยใส่ยอดสะสม = เกณฑ์ระดับสูงสุด + 1 · ฟังก์ชันล้วน ใช้ในหน้าแอดมิน
export const LEGACY_POINT_FACTOR = 2

// ระดับสูงสุด (เกณฑ์สูงสุด) จากการตั้งค่า · ไม่มีค่าที่ใช้ได้ = null
export function topLevelOf(levels) {
  const list = (Array.isArray(levels) ? levels : []).filter((l) => Number.isFinite(Number(l?.min)) && Number.isFinite(Number(l?.mult)))
  if (!list.length) return null
  const top = list.reduce((a, b) => (Number(b.min) > Number(a.min) ? b : a))
  return { name: top.name, min: Number(top.min), mult: Number(top.mult) }
}

// แต้มที่จะได้ · ต้องเป็นจำนวนเต็มบวก ไม่ถูกต้อง = null
export function legacyPointsOf(oldPoints, topMult) {
  const n = Number(oldPoints)
  const m = Number(topMult)
  if (!Number.isInteger(n) || n < 1 || !(m >= 1)) return null
  return Math.round(n * LEGACY_POINT_FACTOR * m)
}

// ยอดสะสมที่ใส่ให้ลูกค้า (ระดับสูงสุด + 1 บาท)
export function legacySpendOf(topMin) {
  const m = Number(topMin)
  return Number.isFinite(m) && m >= 0 ? m + 1 : null
}
