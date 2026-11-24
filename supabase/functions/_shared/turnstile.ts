// ตรวจ Cloudflare Turnstile ฝั่งเซิร์ฟเวอร์ (siteverify) · ล้มเหลวปิด: ไม่มี token/secret หรือตรวจไม่ได้ = ไม่ผ่าน
// token ใช้ได้ครั้งเดียวตามที่ Cloudflare กำหนด · ไม่ส่งข้อมูลส่วนตัวนอกจาก IP ของผู้เรียก (ตามที่ Turnstile ต้องการ)
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(token: string, ip: string, secret: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token || !secret) return false
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set('remoteip', ip)
    const r = await fetchFn(SITEVERIFY, { method: 'POST', body })
    if (!r.ok) return false
    const j = await r.json()
    return j?.success === true
  } catch {
    return false
  }
}
