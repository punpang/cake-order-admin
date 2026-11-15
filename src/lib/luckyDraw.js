// ลุ้นโชคท้ายบิล (ฝั่งแอป): ค่าเริ่มต้น การตรวจตั้งค่า การสร้าง token/hash และ URL ของ QR
// กติกาการสุ่มจริงอยู่ที่ Edge Function lucky-spin (supabase/functions/_shared/lucky.ts) · token เต็มไม่เก็บในฐานข้อมูล

export const LUCKY_SITE_URL = 'https://cake-order-admin.pages.dev'

export const luckyDefaults = () => ({ enabled: false, from: '', to: '', siteUrl: LUCKY_SITE_URL, prizeDays: 30, prizes: [] })

// ตรวจรายการรางวัลก่อนบันทึก (กติกาเดียวกับเซิร์ฟเวอร์): ชื่อไม่ว่าง โอกาส ≥ 0 และรวมไม่เกิน 100
export function validateLuckyPrizes(prizes) {
  if (!Array.isArray(prizes)) return 'รูปแบบรายการรางวัลไม่ถูกต้อง'
  if (prizes.some((p) => !String(p?.name ?? '').trim())) return 'ทุกรางวัลต้องมีชื่อ'
  if (prizes.some((p) => !(Number(p?.chance) >= 0))) return 'โอกาสต้องไม่ติดลบ'
  const sum = prizes.reduce((s, p) => s + (Number(p.chance) || 0), 0)
  if (sum > 100 + 1e-9) return `โอกาสรวมเกิน 100% (ตอนนี้ ${sum.toFixed(2)}%)`
  return ''
}

// เปิดให้ลุ้นอยู่หรือไม่: เปิดใช้งาน และเวลาปัจจุบันอยู่ในช่วง from–to
export function luckyActive(cfg, nowMs = Date.now()) {
  if (!cfg?.enabled) return false
  const f = cfg.from ? Date.parse(cfg.from) : NaN
  const t = cfg.to ? Date.parse(cfg.to) : NaN
  if (Number.isNaN(f) || Number.isNaN(t)) return false
  return nowMs >= f && nowMs <= t
}

const b64url = (bytes) => {
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// token สุ่ม 192 บิต (32 ตัว) สำหรับ QR หนึ่งใบ
export function genLuckyToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(24)))
}

// hash ที่เก็บในฐานข้อมูล (SHA-256 ของ "luckydraw:" + token · ตรงกับฝั่งเซิร์ฟเวอร์)
export async function hashLuckyToken(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`luckydraw:${token}`))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// URL ที่ QR ชี้ไป (หน้าลุ้นโชคของบิลนั้น)
export function luckyUrl(siteUrl, token) {
  const base = String(siteUrl || LUCKY_SITE_URL).replace(/\/+$/, '')
  return `${base}/#/luck/${token}`
}

// รูปแบบรหัสรางวัลที่พนักงานกรอก (6 ตัวจากตัวอักษรที่กำหนด · ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่าง)
export const normalizeLuckyCode = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
export const isLuckyCodeShape = (s) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(normalizeLuckyCode(s))
