// แชทกับร้านของลูกค้าที่ล็อกอินแล้ว (เว็บและแอป) · ข้อความตัวอักษรอย่างเดียว
// เก็บเป็นกระทู้ของช่องทาง 'web' แยกจาก LINE/Facebook (ต่อลูกค้าหนึ่งคนหนึ่งกระทู้)
// เขียนแบบเทียบ updated_at (CAS) เหมือนแชทอื่น · ทุกข้อความใหม่แจ้งกระดิ่งพนักงาน (สิทธิ์ chat)

export const CHAT_TEXT_MAX = 1000
export const CHAT_RATE = { windowMs: 10 * 60e3, max: 20 } // ไม่เกิน 20 ข้อความต่อ 10 นาที ต่อลูกค้า

type Json = Record<string, any>

const newId = (prefix: string) => `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ตัดช่องว่าง/ขึ้นบรรทัดให้เป็นมาตรฐาน · ว่างหรือยาวเกินกำหนด = null
export function cleanChatText(v: unknown): string | null {
  const t = String(v ?? '').replace(/\r\n?/g, '\n').trim()
  if (!t || t.length > CHAT_TEXT_MAX) return null
  return t
}

// ข้อความที่ส่งให้ลูกค้าเห็น (ไม่มีข้อมูลภายในของพนักงาน)
export const toCustomerView = (m: Json) => ({ id: String(m.id ?? ''), from: m.from === 'staff' ? 'staff' : 'customer', text: String(m.text ?? ''), at: String(m.at ?? '') })

// ประวัติแชทของลูกค้า (ข้อความล่าสุดไม่เกิน 100 รายการ)
export async function customerChatList(sb: any, customerId: string): Promise<{ status: number; body: Json }> {
  const r = await sb.from('punpang_chats').select('id,data').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
  if (r?.error) return { status: 500, body: { error: 'อ่านแชทไม่สำเร็จ' } }
  const msgs: Json[] = Array.isArray(r?.data?.data?.messages) ? r.data.data.messages : []
  const visible = msgs.filter((m) => m && (m.from === 'customer' || m.from === 'staff') && (m.kind ?? 'text') === 'text')
  return { status: 200, body: { messages: visible.slice(-100).map(toCustomerView) } }
}

// ส่งข้อความจากลูกค้า: ตรวจบัญชี ความยาว และความถี่ · บันทึกลงกระทู้ของลูกค้า แล้วแจ้งกระดิ่งพนักงาน
export async function customerChatSend(sb: any, customerId: string, rawText: unknown): Promise<{ status: number; body: Json }> {
  const text = cleanChatText(rawText)
  if (!text) return { status: 400, body: { error: `ข้อความต้องมี 1–${CHAT_TEXT_MAX} ตัวอักษร` } }
  const cu = await sb.from('punpang_customers').select('name,data').eq('id', customerId).maybeSingle()
  if (cu?.error || !cu?.data) return { status: 404, body: { error: 'ไม่พบบัญชีลูกค้า' } }
  if (cu.data.data?.deleted === true || cu.data.data?.active === false) return { status: 403, body: { error: 'บัญชีนี้ใช้งานแชทไม่ได้' } }
  const name = String(cu.data.name ?? '').trim() || 'ลูกค้า'

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(80 + Math.floor(Math.random() * 220))
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
    if (cur?.error) return { status: 500, body: { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' } }
    const nowIso = new Date().toISOString()
    const msg = { id: newId('cm'), from: 'customer', kind: 'text', text, orderId: null, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, at: nowIso, by: 'ลูกค้า', delivery: null }

    if (!cur?.data) {
      // ยังไม่มีกระทู้เว็บของลูกค้ารายนี้ → สร้างใหม่
      const chatId = newId('ch')
      const data = { id: chatId, profileName: name, messages: [msg], unreadStaff: 1, lastInboundAt: nowIso, updatedAt: nowIso, pendingAsk: null }
      const ins = await sb.from('punpang_chats').insert({ id: chatId, channel: 'web', external_id: customerId, customer_id: customerId, data })
      if (!ins?.error) { await notifyStaff(sb, chatId, name, text); return { status: 200, body: { ok: true, message: toCustomerView(msg) } } }
      if (ins.error.code !== '23505') return { status: 500, body: { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' } }
      continue // มีกระทู้เกิดพร้อมกัน → ลองอ่านใหม่
    }

    const d = cur.data.data || {}
    const msgs: Json[] = Array.isArray(d.messages) ? d.messages : []
    const recent = msgs.filter((m) => m?.from === 'customer' && Date.now() - new Date(m.at).getTime() < CHAT_RATE.windowMs).length
    if (recent >= CHAT_RATE.max) return { status: 429, body: { error: 'ส่งข้อความถี่เกินไป กรุณารอสักครู่' } }
    const next = { ...d, profileName: name, messages: [...msgs, msg], unreadStaff: (Number(d.unreadStaff) || 0) + 1, lastInboundAt: nowIso, updatedAt: nowIso }
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', cur.data.id).eq('updated_at', cur.data.updated_at).select('id')
    if (!up?.error && (up?.data || []).length) { await notifyStaff(sb, cur.data.id, name, text); return { status: 200, body: { ok: true, message: toCustomerView(msg) } } }
  }
  return { status: 409, body: { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' } }
}

// กระดิ่งพนักงาน (ไม่ทำให้การส่งข้อความล้มเหลว)
async function notifyStaff(sb: any, chatId: string, name: string, text: string): Promise<void> {
  try {
    await sb.from('punpang_records').insert({
      collection: 'bell', id: newId('bl'),
      data: { audience: 'staff', event: 'team_customer_message', title: 'ลูกค้าส่งข้อความ (เว็บ/แอป)', text: `${name}: ${text.slice(0, 80)}`, orderId: null, chatId, readBy: [], at: new Date().toISOString() },
    })
  } catch { /* ไม่กระทบการส่งข้อความ */ }
}
