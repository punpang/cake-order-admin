import { modeOf, refuseInTest } from '../_shared/mode.ts'
// แจ้งเตือนระบบไปยังอุปกรณ์ Android (FCM HTTP v1) · เรียกจากทริกเกอร์ของฐานข้อมูล จึงไม่ตรวจ JWT (ดูไฟล์ deploy)
// 1) recordId = กระดิ่งฝั่งพนักงาน → แจ้งพนักงานที่มีสิทธิ์ (ประเภทที่อนุญาต อายุไม่เกิน 10 นาที)
// 2) chatId = พนักงานตอบกลับในแชทเว็บ/แอป → แจ้งเฉพาะอุปกรณ์ของลูกค้านั้น ที่เซสชันยังไม่หมดอายุ (ข้อความทั่วไป ไม่แสดงเนื้อหา)
// ความปลอดภัย: ทุกกรณีอ่านข้อมูลจริงจากฐานข้อมูลเองและตรวจเงื่อนไขซ้ำ ไม่เชื่อค่าที่ส่งมา
import { createClient } from 'npm:@supabase/supabase-js@2'
import { staffReplyOf } from '../_shared/chatpush.ts'
import { checkPushKey } from '../_shared/pushauth.ts'

// ประเภทที่แจ้งเตือน → สิทธิ์ที่ต้องมี (พนักงานที่มีสิทธิ์อย่างน้อยหนึ่งข้อจะได้รับ) + ปลายทางเมื่อกดแจ้งเตือน
const ALLOWED: Record<string, { perms: string[]; path: (d: Record<string, string>) => string }> = {
  team_new_order: { perms: ['viewAllOrders'], path: (d) => (d.orderId ? `/admin/orders/${d.orderId}` : '/admin/orders') },
  team_customer_paid: { perms: ['confirmPayment', 'reportPayment'], path: () => '/admin/payments' },
  chat_inbound: { perms: ['chat'], path: (d) => (d.chatId ? `/admin/chat/${d.chatId}` : '/admin/chat') },
  team_due_soon: { perms: ['viewAllOrders', 'viewPrepOrders'], path: (d) => (d.orderId ? `/admin/orders/${d.orderId}` : '/admin/orders') },
}
const MAX_AGE_MS = 10 * 60 * 1000
const STAFF_CHANNEL = 'staff-alerts'
const CUSTOMER_CHANNEL = 'customer-alerts'
const enc = new TextEncoder()

const b64url = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// โทเค็นเข้าถึง FCM จากบัญชีบริการ (JWT แบบ RS256 แล้วแลกเป็น access token)
async function fcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })))
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`))
  const assertion = `${header}.${claims}.${b64url(sig)}`
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  const j = await r.json()
  if (!r.ok || !j.access_token) throw new Error('FCM token: ' + (j.error_description || r.status))
  return j.access_token as string
}

type FcmSa = { client_email: string; private_key: string; project_id: string }
// ค่า FCM_SERVICE_ACCOUNT (JSON) · ไม่ครบหรืออ่านไม่ได้ = null
function fcmConfig(): FcmSa | null {
  try {
    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || 'null')
    return sa?.client_email && sa?.private_key && sa?.project_id ? sa : null
  } catch { return null }
}

type FcmMsg = { title: string; body: string; data: Record<string, string>; channel: string; tag?: string }
// ส่งทีละโทเค็น · คืนจำนวนที่ส่งสำเร็จ และโทเค็นที่ใช้ไม่ได้แล้ว (ผู้เรียกลบออกจากฐานข้อมูล)
async function fcmSend(sa: FcmSa, tokens: string[], m: FcmMsg): Promise<{ sent: number; invalid: string[] }> {
  const access = await fcmAccessToken(sa)
  let sent = 0
  const invalid: string[] = []
  for (const token of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: { priority: 'HIGH', notification: { channel_id: m.channel, ...(m.tag ? { tag: m.tag } : {}) } },
        },
      }),
    })
    if (r.ok) { sent++; continue }
    const errText = await r.text()
    // โทเค็นที่แอปถอนการลงทะเบียนแล้ว (เช่น ถอนแอป) → ลบทิ้ง · ข้อผิดพลาดอื่นไม่ลบ
    if (r.status === 404 || errText.includes('UNREGISTERED')) invalid.push(token)
  }
  return { sent, invalid }
}

// ไคลเอนต์ฐานข้อมูล (service role) · ใช้ any เหมือนฟังก์ชันใน _shared เพราะชนิดที่สร้างจาก createClient ทั่วไปเป็น generic ที่ตรวจไม่ตรงกับตารางนี้
type Db = any

// กระดิ่งฝั่งพนักงาน (งานเดิม)
async function staffBell(db: Db, recordId: string): Promise<Response> {
  const { data: rec, error } = await db.from('punpang_records').select('id,collection,data,created_at').eq('collection', 'bell').eq('id', recordId).maybeSingle()
  if (error || !rec) return json(404, { error: 'record' })
  const d = (rec.data || {}) as Record<string, string>
  const rule = ALLOWED[d.event]
  if (d.audience !== 'staff' || !rule) return json(200, { skipped: 'event' })
  if (Date.now() - new Date(rec.created_at).getTime() > MAX_AGE_MS) return json(200, { skipped: 'old' })

  const { data: staff } = await db.from('punpang_staff').select('user_id,perms').eq('active', true)
  const targets = (staff || []).filter((s: any) => (s.perms || []).some((p: string) => rule.perms.includes(p))).map((s: any) => s.user_id)
  if (!targets.length) return json(200, { sent: 0 })
  const { data: devices } = await db.from('punpang_push_devices').select('token').in('staff_id', targets)
  const tokens: string[] = [...new Set<string>((devices || []).map((x: any) => x.token as string))]
  if (!tokens.length) return json(200, { sent: 0 })

  const sa = fcmConfig()
  if (!sa) return json(500, { error: 'FCM_SERVICE_ACCOUNT ยังไม่ได้ตั้งค่า' })
  const r = await fcmSend(sa, tokens, { title: String(d.title || 'แจ้งเตือน'), body: String(d.text || ''), data: { path: rule.path(d), event: String(d.event), recordId }, channel: STAFF_CHANNEL })
  for (const t of r.invalid) await db.from('punpang_push_devices').delete().eq('token', t)
  return json(200, { sent: r.sent, removed: r.invalid.length })
}

// ร้านตอบกลับในแชทเว็บ/แอป → แจ้งเฉพาะอุปกรณ์ของลูกค้านั้น (เซสชันที่ยังไม่หมดอายุ) · ข้อความไม่มีเนื้อหาแชท
async function customerReply(db: Db, chatId: string): Promise<Response> {
  const { data: row } = await db.from('punpang_chats').select('id,channel,customer_id,data').eq('id', chatId).maybeSingle()
  if (!row || row.channel !== 'web' || !row.customer_id) return json(200, { skipped: 'chat' })
  if (!staffReplyOf((row.data as Record<string, unknown> | null)?.messages, Date.now())) return json(200, { skipped: 'not-staff' })

  const { data: cu } = await db.from('punpang_customers').select('data').eq('id', row.customer_id).maybeSingle()
  if (!cu || cu.data?.deleted === true || cu.data?.active === false) return json(200, { skipped: 'customer' })

  const { data: sess } = await db.from('punpang_customer_sessions').select('token_hash').eq('customer_id', row.customer_id).gt('expires_at', new Date().toISOString())
  const live = (sess || []).map((s: any) => s.token_hash as string)
  if (!live.length) return json(200, { sent: 0 })
  const { data: devices } = await db.from('punpang_customer_push_devices').select('token').eq('customer_id', row.customer_id).in('session_hash', live)
  const tokens: string[] = [...new Set<string>((devices || []).map((x: any) => x.token as string))]
  if (!tokens.length) return json(200, { sent: 0 })

  const sa = fcmConfig()
  if (!sa) return json(500, { error: 'FCM_SERVICE_ACCOUNT ยังไม่ได้ตั้งค่า' })
  const r = await fcmSend(sa, tokens, { title: 'ปั้นแป้ง', body: 'ร้านตอบกลับข้อความของคุณ', data: { path: '/account', event: 'chat_staff_reply', chatId }, channel: CUSTOMER_CHANNEL, tag: `chat-${chatId}` })
  for (const t of r.invalid) await db.from('punpang_customer_push_devices').delete().eq('token', t)
  return json(200, { sent: r.sent, removed: r.invalid.length })
}

Deno.serve(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused // โหมดทดสอบไม่ทำงานฟังก์ชันนี้ (ข้อมูลลูกค้า/งานตามเวลา/เว็บฮุกเป็นของจริงเท่านั้น)
  if (req.method !== 'POST') return json(405, { error: 'method' })
  // เฉพาะทริกเกอร์ของฐานข้อมูลที่แนบคีย์ (x-push-key) เท่านั้นที่ส่งแจ้งเตือนได้ · ไม่ตั้ง PUSH_SEND_KEY = ปิดทั้งหมด
  const auth = checkPushKey(Deno.env.get('PUSH_SEND_KEY') || '', req.headers.get('x-push-key'))
  if (auth === 'not-configured') return json(503, { error: 'PUSH_SEND_KEY ยังไม่ได้ตั้งค่า' })
  if (auth !== 'ok') return json(401, { error: 'unauthorized' })
  let body: { recordId?: string; chatId?: string }
  try { body = await req.json() } catch { return json(400, { error: 'json' }) }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  if (body.chatId) return customerReply(db, String(body.chatId))
  const recordId = String(body.recordId || '')
  if (!recordId) return json(400, { error: 'recordId' })
  return staffBell(db, recordId)
})
