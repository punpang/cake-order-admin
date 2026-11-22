import { corsWrap } from '../_shared/cors.ts'
import { gwFetch, SMS_GATEWAY_URL } from '../_shared/gwfetch.ts'
// Edge Function: ส่ง SMS ผ่าน SMS Gateway ที่รันบนโทรศัพท์ (HTTP API v1 · เอกสาร docs/sms-gateway-api.md · อัปเดต 2026-11-15)
// - ตรวจสิทธิ์: ต้องเป็นพนักงานที่ active (punpang_staff) · gateway/lookup/messages ต้องมีสิทธิ์ manage · การส่งจำกัด 60 ครั้ง/ชม./คน (นับจาก punpang_sms_log)
// - ที่อยู่เกตเวย์ฝังในโค้ด (SMS_GATEWAY_URL ใน _shared/gwfetch.ts) · ความลับ (secret) มีแค่ SMS_API_KEY (สิทธิ์ "ส่งและลบ" เท่านั้น)
//   ตั้งด้วย: supabase secrets set SMS_API_KEY=...
// - เกตเวย์รับคำขอเฉพาะจาก IP ใน LAN และใช้ใบรับรอง self-signed ที่ตรวจด้วย certificate pin · Edge ตรวจ pin ไม่ได้
//   ต่อตรงได้เมื่อตั้ง SMS_GATEWAY_CERT = PEM ของใบรับรองโทรศัพท์ (gwFetch เชื่อเฉพาะใบนี้ · ดู _shared/gwfetch.ts) · ไม่ตั้ง = fetch ปกติ (ต้องเป็นรีเลย์ที่ CA เชื่อถือได้)
// - การส่ง ต้องมี idempotencyKey จากฝั่งเรียก (8–64 ตัว A-Z a-z 0-9 _ -) เพื่อให้ลองซ้ำไม่ส่ง SMS ซ้ำ
//   429 rate_limited (เกิน 30 คำขอ/นาที/IP ของรีเลย์) ลองส่งซ้ำหนึ่งครั้งหลังรอ 3 วินาที · 429 daily_limit_reached ไม่ลองซ้ำ
// - actions: status (ตั้งค่าครบหรือยัง) · gateway (GET /v1/status) · send (POST /v1/sms) · lookup (GET /v1/sms/{id}) · messages (GET /v1/messages)
// - ข้อผิดพลาดของเกตเวย์ 400/404/409/429 ส่งต่อรหัสเดิม อื่น ๆ เป็น 502 · ไม่ส่งคีย์หรือ URL เกตเวย์กลับไปที่หน้าเว็บ

import { ID, IDEM, MAX_TEXT, customerRecipientOk, gatewayErrorText, mapGatewayStatus, normalizeNumber } from '../_shared/smsgateway.ts'
import { modeOf, recipientAllowed, restProfileHeaders } from '../_shared/mode.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } })

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const GATEWAY_KEY = env('SMS_API_KEY').trim()

const configured = () => !!GATEWAY_KEY

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
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,active,perms`, { headers: { ...SERVICE_HEADERS, ...restProfileHeaders(modeOf(req)) } })
  const rows = r.ok ? await r.json() : []
  if (!rows[0] || rows[0].active !== true) return null
  return { id: String(user.id), perms: Array.isArray(rows[0].perms) ? rows[0].perms.map(String) : [] }
}

// การส่งจากพนักงานแต่ละคนต่อชั่วโมง (กันบัญชีที่ถูกยึดหรือใช้ผิดวัตถุประสงค์ส่งถล่ม) · นับจาก punpang_sms_log
const SEND_PER_HOUR = 60
async function sentLastHour(userId: string, rh: Record<string, string> = {}): Promise<number> {
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_sms_log?user_id=eq.${encodeURIComponent(userId)}&at=gte.${encodeURIComponent(since)}&select=id&limit=1`, {
    headers: { ...SERVICE_HEADERS, ...rh, Prefer: 'count=exact', Range: '0-0' },
  })
  const total = Number(/\/(\d+)$/.exec(r.headers.get('content-range') || '')?.[1])
  return Number.isFinite(total) ? total : 0
}
async function logSend(userId: string, kind: string, to: string, status: 'sent' | 'failed', rh: Record<string, string> = {}) {
  await fetch(`${SUPABASE_URL}/rest/v1/punpang_sms_log`, {
    method: 'POST',
    headers: { ...SERVICE_HEADERS, ...rh, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, kind, to_tail: to.slice(-4), status, detail: '' }),
  }).catch(() => {})
}

// เรียกเกตเวย์ทุก endpoint ผ่านที่เดียว (หมดเวลา 10 วินาที · ไม่ส่ง key กลับ) · code = รหัสข้อผิดพลาดดิบของเกตเวย์ (ใช้ตัดสินการลองซ้ำ)
async function gw(path: string, init: { method: string; body?: unknown; idem?: string }): Promise<{ ok: boolean; status: number; data?: any; code?: string; error?: string }> {
  const headers: Record<string, string> = { authorization: `Bearer ${GATEWAY_KEY}` }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.idem) headers['idempotency-key'] = init.idem
  try {
    const r = await gwFetch(`${SMS_GATEWAY_URL}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    })
    const data = await r.json().catch(() => null)
    if (r.ok) return { ok: true, status: r.status, data }
    const code = String(data?.error ?? '')
    return { ok: false, status: r.status, code, error: gatewayErrorText(r.status, code) }
  } catch (e) {
    // บันทึกชื่อและข้อความของข้อผิดพลาดการเชื่อมต่อ (ไม่มีเบอร์ คีย์ หรือเนื้อ SMS) เพื่อให้เห็นสาเหตุใน log
    const err = e as Error
    console.warn(`[sms-send] gateway_error ${err?.name ?? 'unknown'}: ${String(err?.message ?? '').slice(0, 200)}`)
    return { ok: false, status: 0, error: 'เชื่อมต่อเกตเวย์ไม่ได้ (หมดเวลาหรือเครือข่ายขัดข้อง)' }
  }
}

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const staff = await staffOf(req)
  if (!staff) return json({ error: 'unauthorized' }, 401)
  const mode = modeOf(req)
  const rh = restProfileHeaders(mode) // โหมดทดสอบ: อ่านเขียนสำเนาข้อมูลทดสอบเท่านั้น

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'คำขอไม่ถูกต้อง' }, 400)
  const action = String(body.action ?? 'send')

  if (action === 'status') return json({ configured: configured() })

  if (!configured()) {
    console.warn('[sms-send] 503 gateway_not_configured')
    return json({ ok: false, error: 'ยังไม่ได้ตั้งค่าเกตเวย์ SMS ของร้าน' }, 503)
  }

  // อ่านกล่องข้อความ/สถานะเกตเวย์ (มีข้อความเข้าของร้าน เช่น รหัส OTP) เฉพาะผู้ดูแล · การส่งแจ้งเตือนลูกค้าเปิดให้พนักงานทุกคนที่ active
  // เพราะระบบส่งจากการกระทำของทุกบทบาท (เตรียมเสร็จ ส่งมอบ ฯลฯ) แต่จำกัดอัตราต่อคน
  if (['gateway', 'lookup', 'messages'].includes(action) && !staff.perms.includes('manage')) {
    return json({ ok: false, error: 'เฉพาะผู้ดูแลที่มีสิทธิ์จัดการระบบ' }, 403)
  }

  // สถานะเกตเวย์: GET /v1/status (running, sms_counts, ...)
  if (action === 'gateway') {
    const r = await gw('/v1/status', { method: 'GET' })
    return json(r.ok ? { ok: true, gateway: r.data } : { ok: false, error: r.error }, r.ok ? 200 : mapGatewayStatus(r.status))
  }

  // สถานะงานส่ง SMS รายการเดียว: GET /v1/sms/{id} (มี delivered_at เมื่อผู้ให้บริการรายงานว่าถึงผู้รับ)
  if (action === 'lookup') {
    const id = String(body.id ?? '').trim()
    if (!ID.test(id)) return json({ ok: false, error: 'รหัสงานไม่ถูกต้อง' }, 400)
    const r = await gw(`/v1/sms/${encodeURIComponent(id)}`, { method: 'GET' })
    if (!r.ok && r.status === 404) return json({ ok: false, error: 'ไม่พบงานนี้ที่เกตเวย์' }, 404)
    return json(r.ok ? { ok: true, sms: r.data } : { ok: false, error: r.error }, r.ok ? 200 : mapGatewayStatus(r.status))
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
    return json(r.ok ? { ok: true, messages: r.data?.messages ?? [], next_before: r.data?.next_before ?? null } : { ok: false, error: r.error }, r.ok ? 200 : mapGatewayStatus(r.status))
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

  // ผู้รับโหมดจริง: ส่งได้เฉพาะเบอร์ลูกค้าที่มีในระบบและยังไม่ถูกลบ · ผู้จัดการทดสอบส่งเบอร์ของตัวเองได้ (kind=test) · กันการใช้ส่ง SMS ออกนอกร้าน
  if (mode !== 'test' && !(body.kind === 'test' && staff.perms.includes('manage'))) {
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/punpang_customers?phone=eq.${to}&select=id,data&limit=1`, { headers: { ...SERVICE_HEADERS, ...rh } })
    const rows = cr.ok ? await cr.json().catch(() => null) : null
    if (!Array.isArray(rows)) {
      console.warn('[sms-send] 503 customer_lookup_failed http=' + cr.status) // บันทึกเฉพาะรหัสสถานะ ไม่บันทึกเบอร์
      return json({ ok: false, error: 'ตรวจทะเบียนลูกค้าไม่สำเร็จ กรุณาลองใหม่' }, 503)
    }
    if (!customerRecipientOk(rows)) return json({ ok: false, error: 'ส่งได้เฉพาะเบอร์ลูกค้าที่มีในระบบ' }, 403)
  }
  if (mode === 'test') {
    // โหมดทดสอบ: ส่งได้เฉพาะเบอร์ในรายชื่อทดสอบเท่านั้น (กันส่ง SMS ถึงลูกค้าจริง)
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/punpang_records?collection=eq.testRecipients&id=eq.list&select=data`, { headers: { ...SERVICE_HEADERS, ...rh } })
    const rows = rr.ok ? await rr.json() : []
    if (!recipientAllowed(rows?.[0]?.data?.items, 'sms', to)) return json({ ok: false, error: 'เบอร์นี้ไม่อยู่ในรายชื่อทดสอบ (โหมดทดสอบส่งได้เฉพาะรายชื่อที่กำหนด)' }, 403)
  }
  if ((await sentLastHour(staff.id, rh)) >= SEND_PER_HOUR) return json({ ok: false, error: 'ส่ง SMS บ่อยเกินไป กรุณารอสักครู่' }, 429)

  const payload: Record<string, unknown> = { to, message: text }
  if (sim) payload.sim = sim
  let r = await gw('/v1/sms', { method: 'POST', body: payload, idem })
  // เกินอัตราต่อนาทีของเกตเวย์: รอสั้น ๆ แล้วลองหนึ่งครั้ง (คีย์กันส่งซ้ำ จึงไม่สร้างงานซ้ำ)
  if (!r.ok && r.status === 429 && r.code === 'rate_limited') {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    r = await gw('/v1/sms', { method: 'POST', body: payload, idem })
  }
  await logSend(staff.id, body.kind === 'test' ? 'test' : 'notify', to, r.ok ? 'sent' : 'failed', rh)
  if (!r.ok) return json({ ok: false, error: r.error }, mapGatewayStatus(r.status))
  // เก็บเฉพาะข้อมูลที่หน้าเว็บใช้ (id/status) ไม่ส่งเบอร์หรือข้อความซ้ำกลับไป
  return json({ ok: true, id: r.data?.id ?? null, status: r.data?.status ?? null, created: r.status === 202 })
}))
