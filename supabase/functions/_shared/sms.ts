// ส่ง SMS ผ่าน SMS Gateway API v1 (ตัวแปรสภาพแวดล้อม SMS_GATEWAY_URL / SMS_API_KEY) · คืน true เมื่อเกตเวย์รับข้อความ
import { gwFetch } from './gwfetch.ts'
export async function sendSmsGateway(local: string, text: string, idem: string): Promise<boolean> {
  const g = (Deno.env.get('SMS_GATEWAY_URL') || '').trim()
  const key = (Deno.env.get('SMS_API_KEY') || '').trim()
  let root = ''
  try { const u = new URL(g); if (/^https?:$/.test(u.protocol)) root = g.replace(/\/+$/, '').replace(/\/v1(\/sms|\/messages|\/status|\/health)?$/i, '') } catch { root = '' }
  if (!root || !key) return false
  try {
    const r = await gwFetch(`${root}/v1/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${key}`, 'Idempotency-Key': idem },
      body: JSON.stringify({ to: local, message: text }),
      signal: AbortSignal.timeout(15000),
    })
    return r.status === 202 || r.status === 200
  } catch { return false }
}
