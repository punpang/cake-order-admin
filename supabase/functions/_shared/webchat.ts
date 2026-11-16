// กระทู้เว็บของลูกค้า (ช่องทาง 'web') สำหรับงานฝั่งเซิร์ฟเวอร์ที่แจ้งลูกค้า (ตามเวลา · ยืนยันชำระอัตโนมัติ)
// มีกระทู้แล้ว → ใช้เลย · ยังไม่มีกระทู้แต่มีบัญชีเว็บ → สร้างให้ (เหมือน webChatFor ในแอปพนักงาน) · ไม่มีบัญชี → null (ข้ามช่องเว็บ)
// deno-lint-ignore no-explicit-any
export async function webChatFor(sb: any, customerId: string, name: string, nowIso: string): Promise<{ id: string } | null> {
  const cur = await sb.from('punpang_chats').select('id').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
  if (cur?.error) return null
  if (cur?.data) return { id: String(cur.data.id) }
  const acc = await sb.from('punpang_customer_auth').select('customer_id').eq('customer_id', customerId).maybeSingle()
  if (acc?.error || !acc?.data) return null
  const id = `ch${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const data = { id, profileName: name || 'ลูกค้า', messages: [], unreadStaff: 0, lastInboundAt: null, updatedAt: nowIso, pendingAsk: null }
  const ins = await sb.from('punpang_chats').insert({ id, channel: 'web', external_id: customerId, customer_id: customerId, data })
  if (!ins?.error) return { id }
  // มีคนสร้างกระทู้พร้อมกัน (ชนคีย์เดิม) → ใช้กระทู้นั้น
  const again = await sb.from('punpang_chats').select('id').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
  return again?.data ? { id: String(again.data.id) } : null
}

// ต่อข้อความของร้านลงกระทู้เว็บ (เทียบ updated_at กันชนกับแอปพนักงานและ webhook) · คืน true เมื่อบันทึกสำเร็จ
// deno-lint-ignore no-explicit-any
export async function appendWebMessage(sb: any, chatId: string, msg: Record<string, unknown>): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chatId).maybeSingle()
    if (cur?.error || !cur?.data) return false
    const d = cur.data.data || {}
    const msgs: unknown[] = Array.isArray(d.messages) ? d.messages : []
    const up = await sb.from('punpang_chats').update({ data: { ...d, messages: [...msgs, msg], updatedAt: msg.at } }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (!up?.error && (up.data || []).length) return true
  }
  return false
}
