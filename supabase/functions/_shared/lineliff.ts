// ผูกบัญชี LINE กับลูกค้า (LIFF) และคำตอบลิงก์ของบอท · ฟังก์ชันบริสุทธิ์ ทดสอบได้โดยไม่ต้องต่อ LINE
// LIFF ID = รหัสช่อง LINE Login ตามด้วย "-" และรหัสแอป (ค่านี้ไม่ใช่ความลับ)
export const LINE_LOGIN_CHANNEL_ID = '2012641404'
export const MENU_URL = 'https://cake-order-admin.pages.dev/#/menu'
export const ACCOUNT_URL = 'https://liff.line.me/2012641404-DlSIXAZp?line=link'

export type LinkRequest = { accessToken: string; session: string }

// คำขอผูกบัญชี: โทเค็น LIFF (ตัวอักษรทั่วไปของ LINE) + โทเค็นเซสชันลูกค้า (hex 64 ตัว)
export function parseLinkRequest(b: unknown): LinkRequest | null {
  const o = (b && typeof b === 'object') ? b as Record<string, unknown> : {}
  const accessToken = String(o.accessToken ?? '')
  const session = String(o.session ?? '')
  if (!/^[A-Za-z0-9._~+/=-]{20,600}$/.test(accessToken)) return null
  if (!/^[a-f0-9]{64}$/.test(session)) return null
  return { accessToken, session }
}

// โทเค็นต้องออกให้ช่อง LINE Login ของร้าน และยังไม่หมดอายุ
export function liffTokenOk(verify: unknown, clientId = LINE_LOGIN_CHANNEL_ID): boolean {
  const v = (verify && typeof verify === 'object') ? verify as Record<string, unknown> : null
  if (!v) return false
  return String(v.client_id ?? '') === clientId && Number(v.expires_in) > 0
}

// userId ของ LINE: U ตามด้วยเลขฐานสิบหก 32 ตัว
export function lineUserIdOk(id: unknown): id is string {
  return typeof id === 'string' && /^U[0-9a-f]{32}$/.test(id)
}

// บอทตอบลิงก์เมื่อลูกค้าถามเรื่องสั่งเค้กหรือคะแนน (ไม่ตอบคำถามเรื่องบัญชีโอนเงิน)
export function lineLinkReply(text: string): string | null {
  const t = String(text || '')
  if (/สั่งเค้ก|สั่งทำ/.test(t)) return `สั่งเค้กออนไลน์ได้ที่นี่ค่ะ ${MENU_URL}`
  if (/คะแนน|แต้ม|บัญชีของฉัน|บัญชีสมาชิก|ดูบัญชี/.test(t)) {
    return `ดูคะแนนและบัญชีของคุณได้ที่นี่ค่ะ (ครั้งแรกเข้าสู่ระบบด้วยเบอร์และ PIN เพื่อเชื่อมบัญชี LINE) ${ACCOUNT_URL}`
  }
  return null
}
