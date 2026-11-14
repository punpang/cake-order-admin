// แจ้งเตือนระบบไปยังอุปกรณ์ Android ของพนักงาน (FCM HTTP v1)
// เรียกจากทริกเกอร์ของ punpang_records (กระดิ่งฝั่งพนักงานใหม่) · ไม่ตรวจ JWT เพราะเรียกจากฐานข้อมูล
// ความปลอดภัย: อ่านแถวกระดิ่งจริงจากฐานข้อมูลเอง → ต้องเป็นกระดิ่งฝั่งพนักงาน ประเภทที่อนุญาต และอายุไม่เกิน 10 นาที
import { createClient } from 'npm:@supabase/supabase-js@2'

// ประเภทที่แจ้งเตือน → สิทธิ์ที่ต้องมี (พนักงานที่มีสิทธิ์อย่างน้อยหนึ่งข้อจะได้รับ) + ปลายทางเมื่อกดแจ้งเตือน
const ALLOWED: Record<string, { perms: string[]; path: (d: Record<string, string>) => string }> = {
  team_new_order: { perms: ['viewAllOrders'], path: (d) => (d.orderId ? `/admin/orders/${d.orderId}` : '/admin/orders') },
  team_customer_paid: { perms: ['confirmPayment', 'reportPayment'], path: () => '/admin/payments' },
  chat_inbound: { perms: ['chat'], path: (d) => (d.chatId ? `/admin/chat/${d.chatId}` : '/admin/chat') },
  team_due_soon: { perms: ['viewAllOrders', 'viewPrepOrders'], path: (d) => (d.orderId ? `/admin/orders/${d.orderId}` : '/admin/orders') },
}
const MAX_AGE_MS = 10 * 60 * 1000
const CHANNEL = 'staff-alerts'
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  let body: { recordId?: string }
  try { body = await req.json() } catch { return json(400, { error: 'json' }) }
  const recordId = String(body.recordId || '')
  if (!recordId) return json(400, { error: 'recordId' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: rec, error } = await db.from('punpang_records').select('id,collection,data,created_at').eq('collection', 'bell').eq('id', recordId).maybeSingle()
  if (error || !rec) return json(404, { error: 'record' })
  const d = (rec.data || {}) as Record<string, string>
  const rule = ALLOWED[d.event]
  if (d.audience !== 'staff' || !rule) return json(200, { skipped: 'event' })
  if (Date.now() - new Date(rec.created_at).getTime() > MAX_AGE_MS) return json(200, { skipped: 'old' })

  const { data: staff } = await db.from('punpang_staff').select('user_id,perms').eq('active', true)
  const targets = (staff || []).filter((s) => (s.perms || []).some((p: string) => rule.perms.includes(p))).map((s) => s.user_id)
  if (!targets.length) return json(200, { sent: 0 })
  const { data: devices } = await db.from('punpang_push_devices').select('token').in('staff_id', targets)
  const tokens = [...new Set((devices || []).map((x) => x.token as string))]
  if (!tokens.length) return json(200, { sent: 0 })

  const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || 'null')
  if (!sa?.client_email || !sa?.private_key || !sa?.project_id) return json(500, { error: 'FCM_SERVICE_ACCOUNT ยังไม่ได้ตั้งค่า' })
  const access = await fcmAccessToken(sa)
  const path = rule.path(d)
  let sent = 0
  let removed = 0
  for (const token of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: String(d.title || 'แจ้งเตือน'), body: String(d.text || '') },
          data: { path, event: String(d.event), recordId },
          android: { priority: 'HIGH', notification: { channel_id: CHANNEL } },
        },
      }),
    })
    if (r.ok) { sent++; continue }
    const errText = await r.text()
    // โทเค็นที่แอปถอนการลงทะเบียนแล้ว (เช่น ถอนแอป) → ลบทิ้ง · ข้อผิดพลาดอื่นไม่ลบ
    if (r.status === 404 || errText.includes('UNREGISTERED')) {
      await db.from('punpang_push_devices').delete().eq('token', token)
      removed++
    }
  }
  return json(200, { sent, removed })
})
