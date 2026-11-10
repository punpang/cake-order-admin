// Edge Function: ส่ง SMS จริงผ่านเกตเวย์ของร้าน (ผู้ให้บริการ SMS ไทย)
// - ตรวจสิทธิ์: ต้องเป็นพนักงานที่ active (punpang_staff) เท่านั้น
// - ความลับ (secret) อยู่ฝั่งเซิร์ฟเวอร์: SMS_GATEWAY_URL, SMS_API_KEY, SMS_SENDER
//   ตั้งด้วย: supabase secrets set SMS_GATEWAY_URL=... SMS_API_KEY=... SMS_SENDER=...
// - รูปแบบคำขอไปยังผู้ให้บริการ (sendOut) ต้องปรับให้ตรงกับผู้ให้บริการที่เลือก
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
const GATEWAY_URL = env('SMS_GATEWAY_URL')
const GATEWAY_KEY = env('SMS_API_KEY')
const SENDER = env('SMS_SENDER')

const configured = () => !!(GATEWAY_URL && GATEWAY_KEY && SENDER)
// เบอร์ไทย: ขึ้นต้น 0 ยาว 9–10 หลัก (ตรงกับ phoneValid ฝั่งหน้าเว็บ)
const normalizeNumber = (s: unknown) => {
  const d = String(s ?? '').replace(/\D/g, '')
  return /^0\d{8,9}$/.test(d) ? d : null
}
const MAX_TEXT = 640 // ราว 9 ข้อความ SMS ภาษาไทย กันข้อความยาวผิดปกติ

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

// คำขอออกไปยังเกตเวย์ (ปรับรูปแบบให้ตรงกับผู้ให้บริการที่ใช้จริง)
async function sendOut(to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const intl = '66' + to.slice(1) // 0812345678 → 66812345678
  try {
    const r = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${GATEWAY_KEY}` },
      body: JSON.stringify({ sender: SENDER, to: intl, message }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { ok: false, error: `ผู้ให้บริการตอบ ${r.status}` }
    return { ok: true }
  } catch {
    return { ok: false, error: 'เชื่อมต่อผู้ให้บริการไม่ได้ (หมดเวลาหรือเครือข่ายขัดข้อง)' }
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
  if (text.length > MAX_TEXT) return json({ ok: false, error: `ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร` }, 400)

  const r = await sendOut(to, text)
  return json(r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 502)
})
