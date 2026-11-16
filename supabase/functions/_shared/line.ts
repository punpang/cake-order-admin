// LINE Messaging API: ตรวจลายเซ็นคำขอ แยกเหตุการณ์ และเตรียมข้อความตอบกลับ (ฟังก์ชันล้วน ทดสอบได้)
// ลายเซ็น = base64(HMAC-SHA256(channel secret, body ดิบ)) ส่งมาในหัว x-line-signature

export const LINE_TEXT_MAX = 5000 // ความยาวสูงสุดของข้อความหนึ่งข้อความ (อักขระ)
export const LINE_REPLY_MAX_MESSAGES = 5 // ตอบกลับได้สูงสุด 5 ข้อความต่อหนึ่งครั้ง

const enc = new TextEncoder()

export async function lineSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
  let bin = ''
  for (const b of sig) bin += String.fromCharCode(b)
  return btoa(bin)
}

// เทียบแบบใช้เวลาเท่ากันทุกครั้ง (กันการเดาทีละตัวจากเวลาตอบ)
export function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function verifyLineSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!secret || !header) return false
  return safeEq(await lineSignature(secret, body), header.trim())
}

export type LineEvent = {
  type?: string
  mode?: string
  webhookEventId?: string
  replyToken?: string
  timestamp?: number
  source?: { type?: string; userId?: string }
  message?: { id?: string; type?: string; text?: string }
  postback?: { data?: string }
}

export function parseLineEvents(body: string): LineEvent[] {
  try {
    const j = JSON.parse(body)
    return Array.isArray(j?.events) ? j.events : []
  } catch {
    return []
  }
}

export function clampText(s: unknown): string {
  const t = String(s ?? '').trim()
  return t.length > LINE_TEXT_MAX ? t.slice(0, LINE_TEXT_MAX) : t
}

// เนื้อหาคำขอ reply (ต้องมีอย่างน้อยหนึ่งข้อความ)
export function replyBody(replyToken: string, texts: string[]): string {
  const messages = texts.slice(0, LINE_REPLY_MAX_MESSAGES).map((t) => ({ type: 'text', text: clampText(t) }))
  return JSON.stringify({ replyToken, messages })
}
