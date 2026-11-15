// แจ้งลูกค้าทาง LINE OA จากงานฝั่งเซิร์ฟเวอร์ (สลิป/ยืนยันชำระ ฯลฯ) · ส่งได้เมื่อลูกค้าผูก userId ไว้เท่านั้น
// ผลส่งถูกบันทึกลงแชท LINE ของลูกค้า (ถ้ามีแชท) เป็นข้อความของระบบพร้อมสถานะส่ง · ไม่ throw
import { isLineUserId, linePush } from './line.ts'

const randHex = (n: number) => crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')

export async function sendLineToCustomer(sb: any, customerId: string, text: string, orderId: string | null = null): Promise<boolean> {
  try {
    const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || ''
    const cu = await sb.from('punpang_customers').select('data').eq('id', customerId).maybeSingle()
    const uid = String(cu.data?.data?.lineUserId ?? '')
    if (!token || !isLineUserId(uid)) return false
    const r = await linePush(token, uid, text)
    await appendToLineChat(sb, uid, text, orderId, r.ok, r.error)
    return r.ok
  } catch {
    return false
  }
}

// ต่อข้อความลงแชท LINE ของผู้ใช้รายนี้ (เทียบ updated_at กันชนกับ webhook และแอป)
async function appendToLineChat(sb: any, uid: string, text: string, orderId: string | null, ok: boolean, error?: string): Promise<void> {
  const chat = await sb.from('punpang_chats').select('id').eq('channel', 'line').eq('external_id', uid).maybeSingle()
  if (!chat.data?.id) return
  const at = new Date().toISOString()
  const msg = {
    id: `cm${randHex(6)}`, from: 'staff', kind: 'text', text, orderId, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null,
    at, by: 'ระบบ', delivery: ok ? 'sent' : 'failed', ...(ok ? {} : { deliveryError: String(error || 'ส่ง LINE ไม่สำเร็จ').slice(0, 200) }),
  }
  for (let i = 0; i < 4; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chat.data.id).maybeSingle()
    if (cur.error || !cur.data) return
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    const up = await sb.from('punpang_chats').update({ data: { ...d, messages: [...msgs, msg], updatedAt: at } }).eq('id', chat.data.id).eq('updated_at', cur.data.updated_at).select('id')
    if (!up.error && (up.data || []).length) return
  }
}
