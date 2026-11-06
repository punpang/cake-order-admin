// การยินยอมคุกกี้ (ฝั่งเบราว์เซอร์) · เก็บใน localStorage (ห่อ try/catch เพราะอาจใช้ไม่ได้ในหน้าต่างส่วนตัว/ปิดการเก็บข้อมูล)
// ใช้: cookieAllowed('analytics') ก่อนโหลดสคริปต์วิเคราะห์/การตลาดทุกครั้ง (ตอนนี้ยังไม่มีสคริปต์ดังกล่าว)
import { reactive } from 'vue'

const KEY = 'ck_consent'
export const COOKIE_TTL_MS = 365 * 24 * 3600e3
let memory = null // สำรองเมื่อ localStorage ใช้ไม่ได้ (หายเมื่อรีเฟรช → ถามใหม่)

export const cookieUi = reactive({ open: false })
export const openCookieSettings = () => (cookieUi.open = true)

export function readCookieConsent() {
  let raw = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return memory
  }
  try {
    return raw ? JSON.parse(raw) : memory
  } catch {
    return null
  }
}
// ต้องถามใหม่ไหม: ยังไม่เคยเลือก / เวอร์ชันนโยบายเปลี่ยน / เกิน 12 เดือน
export function cookieNeedsAsk(consent, version, now = Date.now()) {
  return !consent || consent.v !== version || !(now - Number(consent.at) < COOKIE_TTL_MS)
}
export function writeCookieConsent(version, { analytics = false, marketing = false } = {}) {
  const c = { v: version, necessary: true, analytics: !!analytics, marketing: !!marketing, at: Date.now() }
  memory = c
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* ใช้ค่าในหน่วยความจำแทน */
  }
  return c
}
export function cookieAllowed(kind, version) {
  if (kind === 'necessary') return true
  const c = readCookieConsent()
  return !!c && !cookieNeedsAsk(c, version) && !!c[kind]
}
