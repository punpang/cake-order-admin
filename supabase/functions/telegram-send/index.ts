import { corsWrap } from '../_shared/cors.ts'
import { serviceDb } from '../_shared/db.ts'

// ส่งข้อความเข้ากลุ่มทีมทาง Telegram (secret ฝั่งเซิร์ฟเวอร์: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
// เฉพาะพนักงานที่ล็อกอิน (JWT) และ active · จำกัดอัตรา · บันทึกประวัติ (ไม่เก็บ token/ข้อความ)
const CORS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const PER_MIN = 20, PER_HOUR = 300

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const sb = serviceDb()
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active').eq('user_id', uid).maybeSingle()
  if (!st.data?.active) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์' }, 403)
  let body: { action?: string; text?: string; kind?: string; parse_mode?: string } = {}
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const token = (Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim()
  const chat = (Deno.env.get('TELEGRAM_CHAT_ID') || '').trim()
  const configured = /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token) && /^(-?\d{5,20}|@[A-Za-z0-9_]{4,64})$/.test(chat)
  if (body.action === 'status') return json({ configured })
  if (!configured) return json({ error: 'ยังไม่ได้ตั้งค่า Telegram' }, 503)

  const text = String(body.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
  if (!text || text.length > 4096) return json({ error: 'ข้อความต้องยาว 1–4096 ตัวอักษร' }, 400)
  const kind = body.kind === 'test' ? 'test' : 'notify'
  const parseMode = body.parse_mode === 'HTML' ? 'HTML' : ''
  const log = (status: string, detail = '') => sb.from('punpang_tg_log').insert({ user_id: uid, kind, status, detail })

  const since = (ms: number) => new Date(Date.now() - ms).toISOString()
  const [m, h] = await Promise.all([
    sb.from('punpang_tg_log').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('at', since(60000)).neq('status', 'blocked'),
    sb.from('punpang_tg_log').select('id', { count: 'exact', head: true }).gte('at', since(3600000)).eq('status', 'sent'),
  ])
  if ((m.count ?? 0) >= PER_MIN || (h.count ?? 0) >= PER_HOUR) { await log('blocked', 'rate'); return json({ error: 'ส่งบ่อยเกินไป กรุณารอสักครู่' }, 429) }

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true, ...(parseMode ? { parse_mode: parseMode } : {}) }), signal: AbortSignal.timeout(15000) })
    if (!r.ok) { await log('failed', `http ${r.status}`); return json({ error: 'Telegram ตอบกลับผิดพลาด', status: r.status }, 502) }
    await log('sent')
    return json({ ok: true })
  } catch (e) {
    await log('failed', String((e as Error)?.name || 'error'))
    return json({ error: 'เชื่อมต่อ Telegram ไม่ได้' }, 502)
  }
}))
