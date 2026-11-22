// ส่ง SMS ผ่าน SMS Gateway API v1 (ที่อยู่ฝังใน gwfetch.ts · คีย์ = secret SMS_API_KEY) · คืน true เมื่อเกตเวย์รับข้อความ
import { gwFetch, SMS_GATEWAY_URL } from './gwfetch.ts'
export async function sendSmsGateway(local: string, text: string, idem: string): Promise<boolean> {
  const key = (Deno.env.get('SMS_API_KEY') || '').trim()
  if (!key) return false
  try {
    const r = await gwFetch(`${SMS_GATEWAY_URL}/v1/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${key}`, 'Idempotency-Key': idem },
      body: JSON.stringify({ to: local, message: text }),
      signal: AbortSignal.timeout(15000),
    })
    return r.status === 202 || r.status === 200
  } catch { return false }
}
