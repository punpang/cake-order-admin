// Edge Function: ส่ง SMS ผ่าน SMS Gateway ที่รันบนโทรศัพท์ (HTTP API `POST /v1/sms`)
// - ตรวจสิทธิ์: ต้องเป็นพนักงานที่ active (punpang_staff) เท่านั้น
// - ความลับ (secret) อยู่ฝั่งเซิร์ฟเวอร์: SMS_GATEWAY_URL (ลิงก์ http/https ของเกตเวย์ หรือรีเลย์), SMS_API_KEY (สิทธิ์ "ส่งและลบ" เท่านั้น)
//   ตั้งด้วย: supabase secrets set SMS_GATEWAY_URL=... SMS_API_KEY=...
// - เกตเวย์รับคำขอเฉพาะจาก IP ใน LAN และตรวจ certificate pin (ดู docs/integrations.md) ระบบบนคลาวด์ต้องผ่านรีเลย์/Tunnel ที่อยู่ใน LAN
// - ตอบกลับ {ok, error} เท่านั้น ไม่ส่งคีย์หรือ URL เกตเวย์กลับไปที่หน้าเว็บ

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } })

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const GATEWAY_URL = env('SMS_GATEWAY_URL').trim()
const GATEWAY_KEY = env('SMS_API_KEY').trim()

const configured = () => !!(GATEWAY_URL && GATEWAY_KEY)
// เบอร์ไทย: ขึ้นต้น 0 ยาว 9–10 หลัก (ตรงกับ phoneValid ฝั่งหน้าเว็บ) · เกตเวย์รับรูปแบบ 0… ได้
const normalizeNumber = (s: unknown) => {
  const d = String(s ?? '').replace(/\D/g, '')
  return /^0\d{8,9}$/.test(d) ? d : null
}
const MAX_TEXT = 160 // SMS 1 ฉบับ (เกตเวย์ไม่รับข้อความที่ต้องแบ่งหลายฉบับ)

async function staffOf(req: Request): Promise<boolean> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')
  if (!m) return false
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${m[1]}` } })
  if (!u.ok) return false
  const user = await u.json().catch(() => null)
  if (!user?.id) return false
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,active`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })
  const rows = r.ok ? await r.json() : []
  return !!rows[0] && rows[0].active !== false
}

// ปลายทาง: ยอมรับทั้งลิงก์ฐาน (http://host:port) และลิงก์เต็มที่ลงท้าย /v1/sms
const endpoint = () => {
  const base = GATEWAY_URL.replace(/\/+$/, '')
  return /\/v1\/sms$/i.test(base) ? base : `${base}/v1/sms`
}

// แปลงรหัสตอบกลับของเกตเวย์เป็นข้อความไทย (ดูตาราง error ใน docs ของเกตเวย์)
function gatewayError(status: number, code: string): string {
  if (status === 401) return 'key ของเกตเวย์ไม่ถูกต้อง'
  if (status === 403 && code === 'ip_not_allowed') return 'IP นี้ไม่อยู่ในรายการที่เกตเวย์อนุญาต'
  if (status === 403 && code === 'insufficient_scope') return 'key ของเกตเวย์ไม่มีสิทธิ์ส่ง SMS'
  if (status === 403) return 'เกตเวย์ปฏิเสธการเชื่อมต่อ (ไม่ได้อยู่ใน LAN ของเกตเวย์)'
  if (status === 409) return 'คีย์ส่งซ้ำกับข้อมูลเดิมที่ไม่ตรงกัน'
  if (status === 429 && code === 'daily_limit_reached') return 'ถึงโควตาการส่งต่อวันของเกตเวย์แล้ว'
  if (status === 429) return 'เรียกเกตเวย์ถี่เกินไป ลองใหม่อีกครั้ง'
  if (status === 400) return `เกตเวย์ไม่รับข้อมูล (${code || 'invalid'})`
  return `เกตเวย์ตอบ ${status}`
}

// คำขอออกไปยังเกตเวย์: POST /v1/sms ด้วย Idempotency-Key (กันส่งซ้ำเมื่อ retry) · 200/202 = รับงานแล้ว
async function sendOut(to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const key = `punpang-${crypto.randomUUID().replace(/-/g, '')}`
  try {
    const r = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${GATEWAY_KEY}`, 'idempotency-key': key },
      body: JSON.stringify({ to, message }),
      signal: AbortSignal.timeout(10_000),
    })
    if (r.ok) return { ok: true }
    const data = await r.json().catch(() => null)
    return { ok: false, error: gatewayError(r.status, String(data?.error ?? '')) }
  } catch {
    return { ok: false, error: 'เชื่อมต่อเกตเวย์ไม่ได้ (หมดเวลาหรือเครือข่ายขัดข้อง)' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (!(await staffOf(req))) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'คำขอไม่ถูกต้อง' }, 400)

  if (body.action === 'status') return json({ configured: configured() })

  if (!configured()) return json({ ok: false, error: 'ยังไม่ได้ตั้งค่าเกตเวย์ SMS ของร้าน' }, 503)
  const to = normalizeNumber(body.number)
  if (!to) return json({ ok: false, error: 'เบอร์โทรไม่ถูกต้อง' }, 400)
  const text = String(body.text ?? '').trim()
  if (!text) return json({ ok: false, error: 'ไม่มีข้อความ' }, 400)
  if (text.length > MAX_TEXT) return json({ ok: false, error: `ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร (SMS 1 ฉบับ)` }, 400)

  const r = await sendOut(to, text)
  return json(r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 502)
})
