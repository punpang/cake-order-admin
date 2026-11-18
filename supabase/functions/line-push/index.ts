import { corsWrap } from '../_shared/cors.ts'
import { modeOf, restProfileHeaders } from '../_shared/mode.ts'
import { pickFollowedLineUser, pushPayload } from '../_shared/linepush.ts'

// Edge Function: ส่งข้อความ LINE ถึงลูกค้าที่ผูก LINE แล้ว (ช่องทางเสริม · SMS ยังเป็นช่องทางหลัก)
// - ต้องเป็นพนักงานที่ active (punpang_staff) · ส่งได้ทุกคนที่ active
// - เรียกด้วย { customer_id, text } · ใช้ LINE user ที่ติดตามอยู่ล่าสุดของลูกค้า
// - secret อยู่ฝั่งเซิร์ฟเวอร์: LINE_CHANNEL_ACCESS_TOKEN (ไม่ส่งกลับไปยังไคลเอนต์)

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const LINE_TOKEN = env('LINE_CHANNEL_ACCESS_TOKEN').trim()
const SERVICE_HEADERS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function activeStaff(req: Request, mode: string): Promise<boolean> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')
  if (!m) return false
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${m[1]}` } })
  if (!u.ok) return false
  const user = await u.json().catch(() => null)
  if (!user?.id) return false
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_staff?user_id=eq.${encodeURIComponent(user.id)}&select=active`, {
    headers: { ...SERVICE_HEADERS, ...restProfileHeaders(mode as any) },
  })
  const rows = r.ok ? await r.json() : []
  return rows[0]?.active === true
}

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'ไม่รองรับคำขอนี้' }, 405)
  if (!SUPABASE_URL || !ANON || !SERVICE) return json({ error: 'เซิร์ฟเวอร์ยังตั้งค่าไม่ครบ' }, 500)
  if (!LINE_TOKEN) return json({ error: 'ยังไม่ได้ตั้งค่า LINE' }, 500)

  const mode = modeOf(req)
  if (!(await activeStaff(req, mode))) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400) }
  const customerId = typeof body?.customer_id === 'string' ? body.customer_id : ''
  if (!ID_RE.test(customerId)) return json({ error: 'ไม่พบลูกค้า' }, 422)
  const payload = pushPayload(body?.text)
  if (!payload.ok) return json({ error: payload.error }, 422)

  const lr = await fetch(`${SUPABASE_URL}/rest/v1/punpang_line_users?customer_id=eq.${encodeURIComponent(customerId)}&select=line_user_id,followed,updated_at&order=updated_at.desc&limit=5`, {
    headers: { ...SERVICE_HEADERS, ...restProfileHeaders(mode as any) },
  })
  if (!lr.ok) return json({ error: 'อ่านข้อมูลการผูก LINE ไม่สำเร็จ' }, 502)
  const to = pickFollowedLineUser(await lr.json())
  if (!to) return json({ error: 'ลูกค้ายังไม่ได้ผูก LINE', code: 'no_line' }, 404)

  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages: payload.messages }),
  })
  if (!r.ok) return json({ error: 'ส่ง LINE ไม่สำเร็จ', code: 'line_failed', status: r.status }, 502)
  return json({ ok: true })
}))
