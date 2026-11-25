// รับเหตุการณ์จาก LINE Official Account · บอทอย่างเดียว ไม่มีโหมดพนักงานตอบ · ประวัติอยู่ใน punpang_line_users / punpang_line_messages
// ตั้งค่า secret ใน Supabase: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN (ส่วน AI ใช้ ANTHROPIC_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID เหมือน Facebook)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseLineEvents, replyBody, verifyLineSignature, type LineEvent } from '../_shared/line.ts'
import { answerLine, FALLBACK_TEXT, GREETING_TEXT } from './bot.ts'

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
const CALL_MS = 5000 // เวลาสูงสุดของการเรียก LINE API

type Ctx = { sb: any; token: string; aiKey: string; waiToken: string; waiAccountId: string }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const secret = Deno.env.get('LINE_CHANNEL_SECRET') || ''
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || ''
  if (!secret || !token) return json({ error: 'not-configured' }, 503)
  const raw = await req.text()
  if (!(await verifyLineSignature(secret, raw, req.headers.get('x-line-signature')))) return json({ error: 'signature' }, 401)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const ctx: Ctx = {
    sb, token,
    aiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    waiToken: Deno.env.get('CLOUDFLARE_API_TOKEN') || '',
    waiAccountId: Deno.env.get('CLOUDFLARE_ACCOUNT_ID') || '',
  }
  for (const ev of parseLineEvents(raw)) {
    try { await handleEvent(ctx, ev) } catch (e) { console.error('line-webhook', (e as Error)?.message ?? 'error') }
  }
  return json({ ok: true })
})

async function handleEvent(c: Ctx, ev: LineEvent) {
  const userId = ev.source?.userId || ''
  if (!userId || ev.mode === 'standby') return
  const nowIso = new Date().toISOString()
  if (ev.type === 'unfollow') {
    await c.sb.from('punpang_line_users').upsert({ line_user_id: userId, followed: false, updated_at: nowIso }, { onConflict: 'line_user_id' })
    return
  }
  if (ev.type === 'follow') {
    await touchUser(c, userId, nowIso)
    await sendReply(c, ev, userId, GREETING_TEXT, 'greeting')
    return
  }
  if (ev.type !== 'message' && ev.type !== 'postback') return

  const ts = ev.timestamp ? new Date(ev.timestamp).toISOString() : nowIso
  const isText = ev.type === 'message' && ev.message?.type === 'text'
  const kind = ev.type === 'postback' ? 'postback' : (isText ? 'text' : String(ev.message?.type || 'other'))
  const text = ev.type === 'postback' ? String(ev.postback?.data || '') : (isText ? String(ev.message?.text || '') : '')
  const name = await touchUser(c, userId, ts)

  // บันทึกเหตุการณ์เข้า แต่ไม่เก็บเนื้อหาที่ลูกค้าพิมพ์ · LINE ส่งเหตุการณ์เดิมซ้ำ (webhookEventId เดิม) → ประมวลผลแล้ว จึงไม่ตอบซ้ำ
  const ins = await c.sb.from('punpang_line_messages')
    .upsert(
      { line_user_id: userId, direction: 'in', kind, text: '', source: '', webhook_event_id: ev.webhookEventId || null, created_at: ts },
      { onConflict: 'webhook_event_id', ignoreDuplicates: true },
    )
    .select('id')
  if (ins.error) throw new Error('save-in')
  if (!(ins.data || []).length) return

  // รูป สติกเกอร์ หรือ postback: ยังไม่รองรับ → ส่งข้อความแนะนำให้ติดต่อร้าน
  if (!isText) { await sendReply(c, ev, userId, FALLBACK_TEXT, 'fallback'); return }

  const lastBot = await lastBotText(c.sb, userId)
  const res = await answerLine({
    sb: c.sb, lineUserId: userId, eventId: ev.webhookEventId || '', text, at: ts, lastBot,
    profileName: name, aiKey: c.aiKey, waiToken: c.waiToken, waiAccountId: c.waiAccountId,
  })
  if (!res) return // บอท LINE ปิดอยู่: เก็บประวัติไว้ ไม่ตอบ
  await sendReply(c, ev, userId, res.text, res.source)
}

// บันทึกผู้ใช้และเวลาข้อความล่าสุด · คืนชื่อที่แสดงใน LINE (ดึงครั้งเดียวแล้วเก็บไว้)
async function touchUser(c: Ctx, userId: string, at: string): Promise<string> {
  const cur = await c.sb.from('punpang_line_users').select('display_name').eq('line_user_id', userId).maybeSingle()
  let name = String(cur.data?.display_name || '')
  const row: Record<string, unknown> = { line_user_id: userId, followed: true, last_message_at: at, updated_at: new Date().toISOString() }
  if (!name) {
    name = await fetchLineName(c.token, userId)
    if (name) row.display_name = name
  }
  const up = await c.sb.from('punpang_line_users').upsert(row, { onConflict: 'line_user_id' })
  if (up.error) throw new Error('save-user')
  return name
}

async function fetchLineName(token: string, userId: string): Promise<string> {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CALL_MS),
    })
    if (!r.ok) return ''
    const j = await r.json()
    return String(j?.displayName || '').slice(0, 100)
  } catch {
    return ''
  }
}

async function lastBotText(sb: any, userId: string): Promise<string | undefined> {
  const r = await sb.from('punpang_line_messages')
    .select('text').eq('line_user_id', userId).eq('direction', 'out')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return r.data?.text || undefined
}

// ตอบกลับด้วยโทเค็นตอบกลับของเหตุการณ์นั้น (ใช้ได้ครั้งเดียว) · ไม่มีโทเค็นก็ไม่ส่ง (ไม่ใช้ push เพื่อกันค่าใช้จ่ายโดยไม่ตั้งใจ)
async function sendReply(c: Ctx, ev: LineEvent, userId: string, text: string, source: string) {
  const replyToken = ev.replyToken || ''
  if (!replyToken) return
  const r = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
    body: replyBody(replyToken, [text]),
    signal: AbortSignal.timeout(CALL_MS),
  })
  if (!r.ok) { console.error('line-reply', r.status); return }
  await c.sb.from('punpang_line_messages').insert({ line_user_id: userId, direction: 'out', kind: 'text', text: text.slice(0, 5000), source })
}
