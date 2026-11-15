import { createClient } from 'npm:@supabase/supabase-js@2'
import { isLineUserId, linePush, LINE_TEXT_MAX } from '../_shared/line.ts'

// ส่งข้อความ LINE ไปหาลูกค้าที่มีแชท LINE (เฉพาะพนักงานที่มีสิทธิ์ chat) · ส่งได้เฉพาะผู้ใช้ที่มีแชทในระบบแล้ว
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active,perms').eq('user_id', uid).maybeSingle()
  if (!st.data?.active || !(Array.isArray(st.data.perms) && st.data.perms.includes('chat'))) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์ตอบแชท' }, 403)
  let body: { to?: string; text?: string } = {}
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const to = String(body.to ?? '')
  if (!isLineUserId(to)) return json({ error: 'ผู้รับไม่ถูกต้อง' }, 400)
  const text = String(body.text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
  if (!text || text.length > LINE_TEXT_MAX) return json({ error: `ข้อความต้องยาว 1–${LINE_TEXT_MAX} ตัวอักษร` }, 400)
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || ''
  if (!token) return json({ error: 'ยังไม่ได้เชื่อม LINE OA' }, 503)
  const chat = await sb.from('punpang_chats').select('id').eq('channel', 'line').eq('external_id', to).maybeSingle()
  if (!chat.data) return json({ error: 'ไม่พบแชท LINE ของลูกค้ารายนี้' }, 404)
  const r = await linePush(token, to, text)
  if (!r.ok) return json({ error: r.error || 'LINE ปฏิเสธการส่ง', status: r.status ?? null }, 502)
  return json({ ok: true })
})
