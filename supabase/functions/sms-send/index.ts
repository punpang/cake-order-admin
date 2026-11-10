// Edge Function: ส่ง SMS ผ่าน SMS Gateway ที่รันบนโทรศัพท์ (HTTP API v1 ตามเอกสาร SMS Gateway API)
// - ตรวจสิทธิ์: ต้องเป็นพนักงานที่ active (punpang_staff) · gateway/lookup/messages ต้องมีสิทธิ์ manage · การส่งจำกัด 60 ครั้ง/ชม./คน (นับจาก punpang_sms_log)
// - ความลับ (secret) อยู่ฝั่งเซิร์ฟเวอร์: SMS_GATEWAY_URL (ลิงก์ http/https ของเกตเวย์ หรือรีเลย์), SMS_API_KEY (สิทธิ์ "ส่งและลบ" เท่านั้น)
//   ตั้งด้วย: supabase secrets set SMS_GATEWAY_URL=... SMS_API_KEY=...
// - เกตเวย์รับคำขอเฉพาะจาก IP ใน LAN และตรวจ certificate pin ระบบบนคลาวด์ต้องผ่านรีเลย์/Tunnel ที่อยู่ใน LAN
// - การส่ง ต้องมี idempotencyKey จากฝั่งเรียก (8–64 ตัว A-Z a-z 0-9 _ -) เพื่อให้ลองซ้ำไม่ส่ง SMS ซ้ำ
// - actions: status (ตั้งค่าครบหรือยัง) · gateway (สถานะเกตเวย์ GET /v1/status) · send (POST /v1/sms) · lookup (GET /v1/sms/{id}) · messages (GET /v1/messages)
// - ไม่ส่งคีย์หรือ URL เกตเวย์กลับไปที่หน้าเว็บ

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } })

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const GATEWAY_URL = env('SMS_GATEWAY_URL').trim()
const GATEWAY_KEY = env('SMS_API_KEY').trim()

const configured = () => !!(GATEWAY_URL && GATEWAY_KEY)

// ลิงก์ราก (ตัด /v1/... ที่ผู้ตั้งอาจใส่มาด้วย) เช่น https://relay.example.com:8443
const root = () => GATEWAY_URL.replace(/\/+$/, '').replace(/\/v1(\/sms|\/messages|\/status|\/health)?$/i, '')

// เบอร์: รับ 0xxxxxxxxx(x) · 66xxxxxxxxx · 0066xxxxxxxxx · +66 (ตัดช่องว่าง/ขีดออกก่อน) แล้วส่งเป็น 0… ให้เกตเวย์
const normalizeNumber = (s: unknown) => {
  let d = String(s ?? '').replace(/\D/g, '')
  if (/^0066\d{8,9}$/.test(d)) d = '0' + d.slice(4)
  else if (/^66\d{8,9}$/.test(d)) d = '0' + d.slice(2)
  return /^0\d{8,9}$/.test(d) ? d : null
}

// เกตเวย์รับได้สูงสุด 5 ฉบับ (ภาษาไทยประมาณ 70 ตัว/ฉบับ) · เพดานนี้ตรงกับ 5 ฉบับ เกตเวย์เป็นผู้ตัดสินจริง
const MAX_TEXT = 350
const IDEM = /^[A-Za-z0-9_-]{8,64}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/

// พนักงานที่ active จริง (active ต้องเป็น true เท่านั้น) พร้อมสิทธิ์ ใช้ตัดสินว่าทำ action ไหนได้
type Staff = { id: string; perms: string[] }
const SERVICE_HEADERS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
async function staffOf(req: Request): Promise<Staff | null> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')
  if (!m) return null
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${m[1]}` } })
  if (!u.ok) return null
  const user = await u.json().catch(() => null)
  if (!user?.id) return null
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,active,perms`, { headers: SERVICE_HEADERS })
  const rows = r.ok ? await r.json() : []
  if (!rows[0] || rows[0].active !== true) return null
  return { id: String(user.id), perms: Array.isArray(rows[0].perms) ? rows[0].perms.map(String) : [] }
}

// การส่งจากพนักงานแต่ละคนต่อชั่วโมง (กันบัญชีที่ถูกยึดหรือใช้ผิดวัตถุประสงค์ส่งถล่ม) · นับจาก punpang_sms_log
const SEND_PER_HOUR = 60
async function sentLastHour(userId: string): Promise<number> {
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_sms_log?user_id=eq.${encodeURIComponent(userId)}&at=gte.${encodeURIComponent(since)}&select=id&limit=1`, {
    headers: { ...SERVICE_HEADERS, Prefer: 'count=exact', Range: '0-0' },
  })
  const total = Number(/\/(\d+)$/.exec(r.headers.get('content-range') || '')?.[1])
  return Number.isFinite(total) ? total : 0
}
async function logSend(userId: string, kind: string, to: string, status: 'sent' | 'failed') {
  await fetch(`${SUPABASE_URL}/rest/v1/punpang_sms_log`, {
    method: 'POST',
    headers: { ...SERVICE_HEADERS, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, kind, to_tail: to.slice(-4), status, detail: '' }),
  }).catch(() => {})
}

// แปลงข้อผิดพลาดของเกตเวย์ (ตาราง error ของ API) เป็นข้อความไทย
function gatewayError(status: number, code: string): string {
  const C: Record<string, string> = {
    invalid_json: 'เกตเวย์อ่านคำขอไม่ได้',
    empty_body: 'คำขอว่างเปล่า',
    invalid_to: 'เบอร์ปลายทางไม่ถูกต้องตามที่เกตเวย์รับ',
    invalid_message: 'ข้อความไม่ถูกต้อง',
    message_too_long: `ข้อความยาวเกินที่เกตเวย์รับ (สูงสุด ${MAX_TEXT} ตัวอักษร / 5 ฉบับ)`,
    missing_idempotency_key: 'ไม่มีคีย์กันส่งซ้ำ',
    invalid_idempotency_key: 'คีย์กันส่งซ้ำไม่ถูกรูปแบบ',
    invalid_sim: 'เลขซิมไม่ถูกต้อง (ใช้ 1 หรือ 2)',
    invalid_id: 'รหัสงานไม่ถูกต้อง',
    chunked_not_supported: 'เกตเวย์ไม่รับการส่งแบบ chunked',
    body_too_large: 'คำขอใหญ่เกินที่เกตเวย์รับ',
    unauthorized: 'key ของเกตเวย์ไม่ถูกต้อง',
    ip_not_allowed: 'IP นี้ไม่อยู่ในรายการที่เกตเวย์อนุญาตสำหรับ key นี้',
    insufficient_scope: 'key ของเกตเวย์ไม่มีสิทธิ์ทำรายการนี้',
    forbidden: 'เกตเวย์ปฏิเสธการเชื่อมต่อ (ไม่ได้อยู่ใน LAN ของเกตเวย์)',
    not_found: 'ไม่พบรายการ หรือไม่มี endpoint นี้',
    idempotency_key_reused: 'คีย์ส่งซ้ำกับข้อความอื่นที่ไม่ตรงกัน',
    message_still_pending: 'ข้อความยังรอส่งอยู่',
    rate_limited: 'เรียกเกตเวย์ถี่เกินไป ลองใหม่อีกครั้ง',
    daily_limit_reached: 'ถึงโควตาการส่งต่อวันของเกตเวย์แล้ว',
    internal_error: 'เกตเวย์เกิดข้อผิดพลาดภายใน',
  }
  if (code && C[code]) return C[code]
  if (status === 401) return 'key ของเกตเวย์ไม่ถูกต้อง'
  if (status === 403) return 'เกตเวย์ปฏิเสธการเชื่อมต่อ'
  if (status === 404) return 'ไม่พบรายการ หรือไม่มี endpoint นี้ (ตรวจลิงก์)'
  if (status === 409) return 'เกตเวย์ตอบขัดแย้ง ลองใหม่ภายหลัง'
  if (status === 429) return 'เรียกเกตเวย์ถี่เกินไป ลองใหม่อีกครั้ง'
  return `เกตเวย์ตอบ ${status}`
}

// เรียกเกตเวย์ทุก endpoint ผ่านที่เดียว (หมดเวลา 10 วินาที · ไม่ส่ง key กลับ)
async function gw(path: string, init: { method: string; body?: unknown; idem?: string }): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  const headers: Record<string, string> = { authorization: `Bearer ${GATEWAY_KEY}` }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.idem) headers['idempotency-key'] = init.idem
  try {
    const r = await fetch(`${root()}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    })
    const data = await r.json().catch(() => null)
    if (r.ok) return { ok: true, status: r.status, data }
    return { ok: false, status: r.status, error: gatewayError(r.status, String(data?.error ?? '')) }
  } catch {
    return { ok: false, status: 0, error: 'เชื่อมต่อเกตเวย์ไม่ได้ (หมดเวลาหรือเครือข่ายขัดข้อง)' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const staff = await staffOf(req)
  if (!staff) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'คำขอไม่ถูกต้อง' }, 400)
  const action = String(body.action ?? 'send')

  if (action === 'status') return json({ configured: configured() })

  if (!configured()) return json({ ok: false, error: 'ยังไม่ได้ตั้งค่าเกตเวย์ SMS ของร้าน' }, 503)

  // อ่านกล่องข้อความ/สถานะเกตเวย์ (มีข้อความเข้าของร้าน เช่น รหัส OTP) เฉพาะผู้ดูแล · การส่งแจ้งเตือนลูกค้าเปิดให้พนักงานทุกคนที่ active
  // เพราะระบบส่งจากการกระทำของทุกบทบาท (เตรียมเสร็จ ส่งมอบ ฯลฯ) แต่จำกัดอัตราต่อคน
  if (['gateway', 'lookup', 'messages'].includes(action) && !staff.perms.includes('manage')) {
    return json({ ok: false, error: 'เฉพาะผู้ดูแลที่มีสิทธิ์จัดการระบบ' }, 403)
  }

  // สถานะเกตเวย์: GET /v1/status (running, sms_counts, ...)
  if (action === 'gateway') {
    const r = await gw('/v1/status', { method: 'GET' })
    return json(r.ok ? { ok: true, gateway: r.data } : { ok: false, error: r.error }, r.ok ? 200 : 502)
  }

  // สถานะงานส่ง SMS รายการเดียว: GET /v1/sms/{id}
  if (action === 'lookup') {
    const id = String(body.id ?? '').trim()
    if (!ID.test(id)) return json({ ok: false, error: 'รหัสงานไม่ถูกต้อง' }, 400)
    const r = await gw(`/v1/sms/${encodeURIComponent(id)}`, { method: 'GET' })
    if (!r.ok && r.status === 404) return json({ ok: false, error: 'ไม่พบงานนี้ที่เกตเวย์' }, 404)
    return json(r.ok ? { ok: true, sms: r.data } : { ok: false, error: r.error }, r.ok ? 200 : 502)
  }

  // รายการข้อความ: GET /v1/messages?direction=all|in|out&limit=1..200&before=<ms>
  if (action === 'messages') {
    const direction = ['all', 'in', 'out'].includes(String(body.direction)) ? String(body.direction) : 'all'
    const limit = Math.min(200, Math.max(1, Math.floor(Number(body.limit) || 50)))
    const q = new URLSearchParams({ direction, limit: String(limit) })
    if (body.before !== undefined && body.before !== null && body.before !== '') {
      const b = Math.floor(Number(body.before))
      if (!Number.isFinite(b) || b <= 0) return json({ ok: false, error: 'ค่า before ไม่ถูกต้อง' }, 400)
      q.set('before', String(b))
    }
    const r = await gw(`/v1/messages?${q}`, { method: 'GET' })
    return json(r.ok ? { ok: true, messages: r.data?.messages ?? [], next_before: r.data?.next_before ?? null } : { ok: false, error: r.error }, r.ok ? 200 : 502)
  }

  if (action !== 'send') return json({ ok: false, error: 'action ไม่รู้จัก' }, 400)

  // ส่ง: POST /v1/sms (ต้องมี Idempotency-Key จากฝั่งเรียก) · 202 = งานใหม่, 200 = งานเดิมของคีย์นี้
  const to = normalizeNumber(body.number)
  if (!to) return json({ ok: false, error: 'เบอร์โทรไม่ถูกต้อง' }, 400)
  const text = String(body.text ?? '').trim()
  if (!text) return json({ ok: false, error: 'ไม่มีข้อความ' }, 400)
  if (text.length > MAX_TEXT) return json({ ok: false, error: `ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร (สูงสุด 5 ฉบับ)` }, 400)
  const idem = String(body.idempotencyKey ?? '').trim()
  if (!idem) return json({ ok: false, error: 'ไม่มีคีย์กันส่งซ้ำ (idempotencyKey)' }, 400)
  if (!IDEM.test(idem)) return json({ ok: false, error: 'คีย์กันส่งซ้ำต้องยาว 8–64 ตัว (A-Z a-z 0-9 _ -)' }, 400)
  const sim = body.sim === 1 || body.sim === 2 || body.sim === '1' || body.sim === '2' ? Number(body.sim) : undefined

  if ((await sentLastHour(staff.id)) >= SEND_PER_HOUR) return json({ ok: false, error: 'ส่ง SMS บ่อยเกินไป กรุณารอสักครู่' }, 429)

  const payload: Record<string, unknown> = { to, message: text }
  if (sim) payload.sim = sim
  const r = await gw('/v1/sms', { method: 'POST', body: payload, idem })
  await logSend(staff.id, body.kind === 'test' ? 'test' : 'notify', to, r.ok ? 'sent' : 'failed')
  if (!r.ok) return json({ ok: false, error: r.error }, 502)
  // เก็บเฉพาะข้อมูลที่หน้าเว็บใช้ (id/status) ไม่ส่งเบอร์หรือข้อความซ้ำกลับไป
  return json({ ok: true, id: r.data?.id ?? null, status: r.data?.status ?? null, created: r.status === 202 })
})
