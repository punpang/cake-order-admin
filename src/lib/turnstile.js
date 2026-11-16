// Cloudflare Turnstile สำหรับหน้าเข้าสู่ระบบพนักงาน
// แสดงตัวยืนยันเฉพาะเมื่อ build มี VITE_TURNSTILE_SITE_KEY (ว่าง = พฤติกรรมเดิมทุกอย่าง)
// การบังคับจริงอยู่ที่ Supabase (Authentication → Bot and Abuse Protection) ไม่ใช่ที่หน้านี้
export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

export function turnstileSiteKey() {
  try { return String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim() } catch { return '' }
}

export const turnstileOn = () => turnstileSiteKey() !== ''

// ตัวเลือกของ signInWithPassword: ส่ง captchaToken เฉพาะเมื่อมีค่า (ไม่มีค่า = ไม่ส่งฟิลด์นี้)
export function signInCaptchaOptions(token) {
  const t = String(token || '').trim()
  return t ? { captchaToken: t } : {}
}

let pending = null

// โหลดสคริปต์ Turnstile ครั้งเดียว แล้วคืน window.turnstile เมื่อพร้อม
export function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('ไม่มี window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = TURNSTILE_SRC
      s.async = true
      s.onload = () => resolve(window.turnstile)
      s.onerror = () => { pending = null; s.remove(); reject(new Error('โหลดตัวยืนยันไม่ได้')) }
      document.head.appendChild(s)
    })
  }
  return pending
}
