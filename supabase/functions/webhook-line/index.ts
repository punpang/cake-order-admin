import { createClient } from 'npm:@supabase/supabase-js@2'
import { isLineUserId, lineDisplayName, lineMessageText, parseLineEvents, verifyLineSignature } from '../_shared/line.ts'

// Webhook ของ LINE OA: ตรวจลายเซ็นก่อนทุกอย่าง · ข้อความเข้าศูนย์รวมแชท (channel 'line', external_id = userId) · ไม่ตอบอัตโนมัติ
// LINE อาจส่งเหตุการณ์ซ้ำ: ข้อความมีรหัสของ LINE (lineMid) และตรวจซ้ำก่อนเพิ่มเสมอ · ฐานข้อมูลขัดข้อง = ตอบ 500 ให้ LINE ส่งซ้ำ
const randHex = (n: number) => crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
const iso = (ms: number) => new Date(ms || Date.now()).toISOString()

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 })
  const secret = Deno.env.get('LINE_CHANNEL_SECRET') || ''
  if (!secret) return new Response('not configured', { status: 503 })
  const raw = await req.text()
  if (!(await verifyLineSignature(raw, req.headers.get('x-line-signature'), secret))) return new Response('bad signature', { status: 401 })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || ''
  for (const ev of parseLineEvents(raw)) {
    // กลุ่ม/ห้องแชทยังไม่รับ (รอบนี้รับเฉพาะแชทส่วนตัวกับร้าน)
    if (ev.sourceType !== 'user' || !isLineUserId(ev.userId)) continue
    if (ev.type === 'message' && ev.message) {
      if (!(await saveInbound(sb, token, ev))) return new Response('db error', { status: 500 })
    }
  }
  return Response.json({ ok: true })
})

async function saveInbound(sb: any, token: string, ev: { userId: string; timestamp: number; message: { id: string; type: string; text: string } | null }): Promise<boolean> {
  const m = ev.message
  if (!m || !m.id) return true
  const text = lineMessageText(m)
  const at = iso(ev.timestamp)
  const msg = { id: `lm${m.id}`, from: 'customer', kind: 'text', text, orderId: null, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, at, by: 'ลูกค้า', delivery: null, lineMid: m.id }
  for (let i = 0; i < 4; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('channel', 'line').eq('external_id', ev.userId).maybeSingle()
    if (cur.error) return false
    if (!cur.data) {
      // แชทใหม่: ชื่อโปรไฟล์จาก LINE (ไม่ได้ = ไม่ทราบชื่อ) · ผูกกับลูกค้าภายหลังในหน้าแชท
      const name = (await lineDisplayName(token, ev.userId)) || 'ไม่ทราบชื่อ'
      const id = `ch${randHex(6)}`
      const data = { id, profileName: name, messages: [msg], unreadStaff: 1, lastInboundAt: at, updatedAt: at, pendingAsk: null }
      const ins = await sb.from('punpang_chats').insert({ id, channel: 'line', external_id: ev.userId, customer_id: null, data })
      if (!ins.error) { await bell(sb, name, text, id); return true }
      if (ins.error.code !== '23505') return false
      continue // มีแชทเกิดพร้อมกัน → อ่านใหม่
    }
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    if (msgs.some((x) => x?.lineMid === m.id)) return true // ส่งซ้ำ: มีข้อความนี้แล้ว
    const next = { ...d, messages: [...msgs, msg], unreadStaff: (Number(d.unreadStaff) || 0) + 1, lastInboundAt: at, updatedAt: at }
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', cur.data.id).eq('updated_at', cur.data.updated_at).select('id')
    if (!up.error && (up.data || []).length) {
      await bell(sb, String(d.profileName || 'ลูกค้า LINE'), text, cur.data.id)
      return true
    }
  }
  return false
}

// กระดิ่งพนักงาน (ไม่ทำให้การรับข้อความล้มเหลว)
async function bell(sb: any, name: string, text: string, chatId: string): Promise<void> {
  try {
    await sb.from('punpang_records').insert({ collection: 'bell', id: `bl${randHex(6)}`, data: { audience: 'staff', event: 'team_customer_message', title: 'ลูกค้าส่งข้อความ (LINE)', text: `${name}: ${text.slice(0, 80)}`, orderId: null, chatId, readBy: [], at: iso(0) } })
  } catch { /* ไม่กระทบการรับข้อความ */ }
}
