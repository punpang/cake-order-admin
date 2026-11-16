// ทดสอบบอทตอบแชท (AI) ในโหมดทดสอบ: ทำงานกับแชททดสอบ (ข้อมูลใน punpang_test) เท่านั้น
// ไม่ส่งข้อความถึง Facebook หรือลูกค้าจริง (dryRun) · ใช้กติกาเดียวกับบอทจริง (fb-webhook/bot.ts)
// เฉพาะแอดมินที่เข้าสู่ระบบ · เพดาน AI ต่อวันนับจากบันทึก aiLog ของสำเนาทดสอบ (ไม่เขียนข้อมูลร่วม)
import { corsWrap } from '../_shared/cors.ts'
import { modeOf } from '../_shared/mode.ts'
import { serviceDb } from '../_shared/db.ts'
import { runFbBot } from '../fb-webhook/bot.ts'

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('')
const MAX_CHARS = 1000
const TEST_AI_PER_DAY = 30 // เพดานการเรียก AI ต่อวันของโหมดทดสอบ (ทุกผู้ให้บริการรวมกัน)

// เริ่มต้นวันทำการ (เที่ยงคืนเวลาไทย) เป็น ISO · ใช้นับ aiLog ของวันนี้
const bkkDayStartIso = () => {
  const x = new Date(Date.now() + 7 * 3600_000)
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) - 7 * 3600_000).toISOString()
}

// เพดานรายวันของโหมดทดสอบ: นับครั้งที่เรียก AI วันนี้จาก aiLog ของสำเนา (สถานะที่เรียกโมเดลจริง ไม่รวมที่ถูกจำกัด)
function testQuota(sb: any) {
  return async (): Promise<boolean> => {
    const r = await sb.from('punpang_records').select('id', { count: 'exact', head: true })
      .eq('collection', 'aiLog').in('data->>status', ['ok', 'handoff', 'error', 'quota']).gte('data->>at', bkkDayStartIso())
    if (r.error) return false
    return (r.count ?? 0) < TEST_AI_PER_DAY
  }
}

Deno.serve(corsWrap(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (modeOf(req) !== 'test') return json({ error: 'ใช้ได้เฉพาะในโหมดทดสอบ' }, 409)
  const sb = serviceDb(req)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active,perms').eq('user_id', uid).maybeSingle()
  if (!st.data?.active || !(st.data.perms || []).includes('manage')) return json({ error: 'เฉพาะแอดมินทดสอบบอทได้' }, 403)

  let body: { text?: unknown; chatId?: unknown } = {}
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const text = String(body.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
  if (!text || text.length > MAX_CHARS) return json({ error: `ข้อความต้องยาว 1–${MAX_CHARS} ตัวอักษร` }, 400)

  const now = new Date().toISOString()
  const mid = `tm${rand(6)}`
  const msg = {
    id: `cm${rand(6)}`, from: 'customer', kind: 'text', text, orderId: null, quoteId: null, replyTo: null, ask: null, answerFor: null,
    filled: null, at: now, by: 'ลูกค้าทดสอบ', delivery: null, fbMid: mid, testOnly: true,
  }

  // แชททดสอบ: ต่อจากแชทเดิม (ต้องเป็นแชททดสอบ) หรือสร้างใหม่ · ช่องทาง web ไม่มีการส่งออกจริง
  let id = typeof body.chatId === 'string' ? body.chatId : ''
  if (id) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', id).maybeSingle()
    if (cur.error || !cur.data || cur.data.data?.botTest !== true) return json({ error: 'ไม่พบแชททดสอบนี้' }, 404)
    const d = cur.data.data || {}
    const msgs = [...(Array.isArray(d.messages) ? d.messages : []), msg]
    const up = await sb.from('punpang_chats').update({ data: { ...d, messages: msgs, lastInboundAt: now, updatedAt: now } })
      .eq('id', id).eq('updated_at', cur.data.updated_at).select('id')
    if (up.error || !up.data?.length) return json({ error: 'แชททดสอบเปลี่ยนระหว่างส่ง กรุณาลองใหม่' }, 409)
  } else {
    id = `ch${rand(6)}`
    const chat = { id, profileName: 'ลูกค้าทดสอบ (บอท)', botTest: true, messages: [msg], unreadStaff: 0, lastInboundAt: now, updatedAt: now, pendingAsk: null }
    const ins = await sb.from('punpang_chats').insert({ id, channel: 'web', external_id: `test-${id}`, customer_id: null, data: chat })
    if (ins.error) return json({ error: 'สร้างแชททดสอบไม่สำเร็จ' }, 500)
  }

  // รันบอทจริงในโหมดทดสอบ: ไม่ส่งถึง Facebook · AI ใช้คีย์เดิมของโปรเจกต์ · เพดานนับจากสำเนา
  try {
    await runFbBot({
      sb, token: '', ver: 'test', psid: 'test', chatId: id, mid, text, at: now,
      aiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
      waiToken: Deno.env.get('CLOUDFLARE_API_TOKEN') || '',
      waiAccountId: Deno.env.get('CLOUDFLARE_ACCOUNT_ID') || '',
      channel: 'facebook', dryRun: true, takeQuota: testQuota(sb),
    })
  } catch (e) {
    console.error('bot-test', e)
    return json({ error: 'บอททดสอบทำงานไม่สำเร็จ', chatId: id }, 500)
  }

  const after = await sb.from('punpang_chats').select('data').eq('id', id).maybeSingle()
  const d = after.data?.data || {}
  const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
  const reply = msgs.find((x) => x?.by === 'บอท' && x?.botFor === mid) || null
  const draft = d.botDraft && typeof d.botDraft.at === 'string' && d.botDraft.at >= now ? d.botDraft : null
  return json({
    chatId: id,
    reply: reply ? String(reply.text ?? '') : null, // บอทตอบเอง (โหมดตอบอัตโนมัติ) · ในแชททดสอบเท่านั้น
    replySource: reply?.botSource ?? null,
    draft: draft ? String(draft.text ?? '') : null, // ร่างให้พนักงานกดส่ง (โหมดแนะนำ) · ไม่ได้ส่ง
    draftReason: draft?.reason ?? null,
    handoff: d.botHandoff === true, // ส่งต่อพนักงาน
    handoffReason: d.botHandoffReason ?? null,
    note: reply || draft || d.botHandoff === true ? null : 'บอทยังไม่ได้ตอบ · ตรวจว่าบอทเปิดอยู่สำหรับ Facebook และร้านเปิดทำการในการตั้งค่า',
  })
}))
