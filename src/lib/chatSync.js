import { startSync, selectAll } from './tableSync'
import { parseNo } from './docNo'

// ซิงก์แชท (db.chats) กับ punpang_chats และใบเสนอ (db.quotes) กับ punpang_quotes
// ข้อความในแชท/ร่างบอท/ฯลฯ อยู่ใน data (jsonb) · ใช้สิทธิ์ 'chat' (ลบได้เฉพาะ 'manage' = ตอนอนุมัติลบข้อมูลลูกค้า)
// ข้อความจาก LINE/Facebook จริงต้องเข้าผ่าน webhook (Edge Function) ในอนาคต — ตอนนี้เป็นการจำลองในแอป
export function chatToRow(c) {
  const { id, channel, externalId, customerId, ...rest } = c
  return { id, channel, external_id: externalId || null, customer_id: customerId || null, data: rest }
}
export function rowToChat(r) {
  return { ...(r.data || {}), id: r.id, channel: r.channel, externalId: r.external_id || '', customerId: r.customer_id || null }
}
export function quoteToRow(q) {
  const { id, code, chatId, customerId, status, orderId, ...rest } = q
  return { id, code, chat_id: chatId, customer_id: customerId || null, status, order_id: orderId || null, data: rest }
}
export function rowToQuote(r) {
  return { ...(r.data || {}), id: r.id, code: r.code, chatId: r.chat_id, customerId: r.customer_id || null, status: r.status, orderId: r.order_id || null }
}

const byDesc = (f) => (a, b) => String(b[f] || '').localeCompare(String(a[f] || ''))

export async function loadChats(client) {
  const a = await selectAll((x, y) => client.from('punpang_chats').select('id,channel,external_id,customer_id,data').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToChat).sort(byDesc('updatedAt')) } // แชทล่าสุดอยู่บนสุด
}
export async function loadQuotes(client) {
  const a = await selectAll((x, y) => client.from('punpang_quotes').select('id,code,chat_id,customer_id,status,order_id,data').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToQuote).sort(byDesc('createdAt')) }
}

async function pushChats(client, { upserts, deletes }) {
  if (upserts.length) {
    const r = await client.from('punpang_chats').upsert(upserts.map(chatToRow))
    if (r.error) return { error: r.error.message }
  }
  if (deletes.length) {
    const r = await client.from('punpang_chats').delete().in('id', deletes)
    if (r.error) return { error: r.error.message }
  }
  return { ok: true }
}

// ใบเสนอ: เลข QT ซ้ำ (23505) → ออกเลขใหม่ (เหมือนออร์เดอร์)
export async function pushQuotes(client, { upserts, deletes }, { numbering = null, onRecode = () => {} } = {}) {
  for (const q of upserts) {
    let tries = 0
    for (;;) {
      const r = await client.from('punpang_quotes').upsert(quoteToRow(q))
      if (!r.error) break
      if (r.error.code === '23505' && numbering && tries < 3) {
        tries++
        q.code = numbering.next(parseNo(q.code)?.prefix || 'QT') // reactive: ปรับเลขในแอปด้วย
        onRecode(q, q.code)
        continue
      }
      return { error: `${q.code || q.id}: ${r.error.message}` }
    }
  }
  if (deletes.length) {
    const r = await client.from('punpang_quotes').delete().in('id', deletes)
    if (r.error) return { error: r.error.message }
  }
  return { ok: true }
}

export async function startChatSync({ client, db, canWrite, numbering, onError, onRecode, debounceMs }) {
  const a = await startSync({
    list: () => db.chats,
    replace: (items) => db.chats.splice(0, db.chats.length, ...items),
    load: () => loadChats(client),
    push: (c) => pushChats(client, c),
    canWrite, onError, debounceMs, label: 'แชท',
  })
  const b = await startSync({
    list: () => db.quotes,
    replace: (items) => {
      db.quotes.splice(0, db.quotes.length, ...items)
      if (numbering) numbering.seen(items.map((i) => i.code))
    },
    load: () => loadQuotes(client),
    push: (c) => pushQuotes(client, c, { numbering, onRecode }),
    canWrite, onError, debounceMs, label: 'ใบเสนอ',
  })
  return [a, b]
}
