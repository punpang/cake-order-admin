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
