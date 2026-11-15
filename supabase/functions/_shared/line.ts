// LINE OA (Messaging API): ลายเซ็น webhook · แยกเหตุการณ์ · ส่งข้อความ push · ดึงชื่อผู้ใช้
// โทเค็นและ secret อยู่ใน Edge Function secrets เท่านั้น: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
export const LINE_API = 'https://api.line.me'
export const LINE_TEXT_MAX = 5000

// รหัสผู้ใช้ LINE: U + hex 32 ตัว
export const isLineUserId = (v: unknown): v is string => typeof v === 'string' && /^U[0-9a-f]{32}$/.test(v)

const enc = new TextEncoder()
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

// เทียบแบบไม่รั่วเวลา (ความยาวต่างกัน = ไม่ตรง)
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// ลายเซ็น: HMAC-SHA256(channel secret, เนื้อหาดิบ) เป็น base64 ต้องตรงกับหัว x-line-signature
export async function verifyLineSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
  return safeEq(toB64(mac), signature.trim())
}

export type LineEvent = {
  type: string
  sourceType: string
  userId: string
  webhookEventId: string
  timestamp: number
  message: { id: string; type: string; text: string } | null
}

// แยกเหตุการณ์จาก webhook (ข้อมูลผิดรูปแบบ = ไม่มีเหตุการณ์)
export function parseLineEvents(raw: string): LineEvent[] {
  let j: any
  try { j = JSON.parse(raw) } catch { return [] }
  const list: any[] = Array.isArray(j?.events) ? j.events : []
  return list.map((e) => ({
    type: String(e?.type ?? ''),
    sourceType: String(e?.source?.type ?? ''),
    userId: String(e?.source?.userId ?? ''),
    webhookEventId: String(e?.webhookEventId ?? ''),
    timestamp: Number(e?.timestamp) || 0,
    message: e?.message ? { id: String(e.message.id ?? ''), type: String(e.message.type ?? ''), text: typeof e.message.text === 'string' ? e.message.text : '' } : null,
  }))
}

// ข้อความที่เก็บในแชท: ตัวอักษรตามจริง (ทำความสะอาดและจำกัดความยาว) · ชนิดอื่นเป็นป้าย (รูป/สติกเกอร์ยังไม่ดึงไฟล์)
const PLACEHOLDER: Record<string, string> = { image: '[รูปภาพ]', sticker: '[สติกเกอร์]', video: '[วิดีโอ]', audio: '[ข้อความเสียง]', file: '[ไฟล์]', location: '[ตำแหน่งที่ตั้ง]' }
export function lineMessageText(m: { type: string; text: string }): string {
  if (m.type !== 'text') return PLACEHOLDER[m.type] || '[ข้อความที่ยังไม่รองรับ]'
  return String(m.text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, LINE_TEXT_MAX)
}

// ส่งข้อความ push ไปยังผู้รับ (userId) · คืนผลและไม่ throw
export async function linePush(token: string, to: string, text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!token) return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE OA' }
  if (!isLineUserId(to)) return { ok: false, error: 'ผู้รับไม่ถูกต้อง' }
  try {
    const r = await fetch(`${LINE_API}/v2/bot/message/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, LINE_TEXT_MAX) }] }),
      signal: AbortSignal.timeout(10000),
    })
    if (r.ok) return { ok: true, status: r.status }
    const j = await r.json().catch(() => null)
    return { ok: false, status: r.status, error: String(j?.message || `LINE ตอบ ${r.status}`).slice(0, 200) }
  } catch {
    return { ok: false, error: 'เชื่อมต่อ LINE ไม่ได้' }
  }
}

// ชื่อที่แสดงของผู้ใช้ LINE (ไม่ได้ = ค่าว่าง)
export async function lineDisplayName(token: string, userId: string): Promise<string> {
  if (!token || !isLineUserId(userId)) return ''
  try {
    const r = await fetch(`${LINE_API}/v2/bot/profile/${userId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return ''
    const j = await r.json()
    return String(j?.displayName ?? '').trim().slice(0, 60)
  } catch {
    return ''
  }
}
