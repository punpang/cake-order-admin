// สื่อโฆษณาบนจอลูกค้า (จอที่สองของ POS) ตอนไม่มีการซื้อ: รูปภาพและวิดีโอ วนแสดงเต็มจอ
// เก็บใน db.storefront.displayAds (ค่าตั้งค่าร่วมทั้งร้าน · รูปที่ยังเป็นไฟล์ในเครื่องถูกอัปโหลดขึ้นที่เก็บสาธารณะตอนบันทึก)
// ฟังก์ชันล้วน ใช้ทั้งหน้าตั้งค่า POS และจอลูกค้า
export const AD_SECONDS = [5, 8, 10, 15, 20, 30] // เวลาแสดงรูปละ (วิดีโอเล่นจนจบ)
export const DEFAULT_AD_SECONDS = 8
export const MAX_AD_ITEMS = 10
export const MAX_VIDEO_MB = 30
export const VIDEO_TYPES = ['video/mp4', 'video/webm']

const isHttp = (u) => /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 1000
// รูป: ลิงก์ http(s) หรือรูปในเครื่องที่ยังไม่อัปโหลด (data:image/...) · วิดีโอ: ลิงก์ http(s) เท่านั้น (อัปโหลดทันทีที่เลือก)
const urlOk = (type, u) => (type === 'video' ? isHttp(u) : isHttp(u) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u))

export function normalizeDisplayAds(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const seconds = AD_SECONDS.includes(Number(r.seconds)) ? Number(r.seconds) : DEFAULT_AD_SECONDS
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((x) => ({ type: x?.type === 'video' ? 'video' : 'image', url: String(x?.url ?? '').trim() }))
    .filter((x) => urlOk(x.type, x.url))
    .slice(0, MAX_AD_ITEMS)
  return { enabled: r.enabled === true, seconds, items }
}

// สิ่งที่ POS ส่งให้จอลูกค้าตอนว่าง: เปิดใช้และมีสื่อ → { seconds, items } · ไม่อย่างนั้น null (จอแสดงหน้ายินดีต้อนรับแบบเดิม)
export function adsForDisplay(raw) {
  const a = normalizeDisplayAds(raw)
  return a.enabled && a.items.length ? { seconds: a.seconds, items: a.items } : null
}

// ลำดับถัดไปที่ยังเล่นได้ (ข้ามรายการที่โหลดไม่สำเร็จ) · ไม่เหลือรายการที่เล่นได้ = -1
export function nextAdIndex(current, count, failed = new Set()) {
  for (let step = 1; step <= count; step++) {
    const i = (current + step) % count
    if (!failed.has(i)) return i
  }
  return -1
}

// ตรวจไฟล์วิดีโอก่อนอัปโหลด · คืนข้อความผิดพลาด หรือ '' ถ้าใช้ได้
export function videoFileError(file) {
  if (!file) return 'ไม่พบไฟล์'
  if (!VIDEO_TYPES.includes(file.type)) return 'รองรับเฉพาะวิดีโอ MP4 หรือ WebM'
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) return `วิดีโอใหญ่เกิน ${MAX_VIDEO_MB} MB`
  return ''
}
