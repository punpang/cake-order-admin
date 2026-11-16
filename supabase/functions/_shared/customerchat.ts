// แชทกับร้านของลูกค้าที่ล็อกอินแล้ว (เว็บและแอป) · ข้อความตัวอักษรและรูปภาพ (ไม่เกิน 2 MB ต่อรูป ไม่เกิน 5 รูปต่อข้อความ)
// เก็บเป็นกระทู้ของช่องทาง 'web' แยกจาก Facebook (ต่อลูกค้าหนึ่งคนหนึ่งกระทู้)
// เขียนแบบเทียบ updated_at (CAS) เหมือนแชทอื่น · ทุกข้อความใหม่แจ้งกระดิ่งพนักงาน (สิทธิ์ chat)
import { CHAT_PHOTO_KV, CHAT_PHOTO_UPLOAD_MAX, decodePhotoDataUrl, photoKeyOf, photoKeyOwned, photoPrefixOf, photoRefsOf } from './chatphoto.ts'
import { type FilesEnv, svcDelete, svcUpload } from './filesvc.ts'
import { shopPresenceOf } from './chatpresence.ts'
import { newChatTopic } from './chattopic.ts'
import { orderCardMsg } from './schedlib/chatCards.js'
import { orderTotals } from './schedlib/pricing.js'

export const CHAT_TEXT_MAX = 1000
export const CHAT_RATE = { windowMs: 10 * 60e3, max: 20 } // ไม่เกิน 20 ข้อความต่อ 10 นาที ต่อลูกค้า

type Json = Record<string, any>
type Signer = (key: string) => Promise<string | null>

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

// ข้อความที่ลูกค้าเห็นได้ในแชท: ข้อความตัวอักษร ใบเสนอ และสรุปออร์เดอร์ (ชนิดอื่นเป็นของภายในหรือของช่องทางอื่น)
export const isCustomerVisible = (m: Json) => !!m && (m.from === 'customer' || m.from === 'staff') && ['text', 'quote', 'order', 'card'].includes(String(m.kind ?? 'text'))

// การตอบกลับ: รหัสข้อความที่อ้างถึงต้องเป็นรหัสรูปแบบปลอดภัย และต้องมีอยู่จริงในแชทนี้ (กันการอ้างถึงข้อความของผู้อื่น)
const REPLY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const cleanReplyTo = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return REPLY_ID_RE.test(s) ? s : null
}
// ข้อความอ้างอิงที่ลูกค้าเห็น: เฉพาะข้อความที่ลูกค้าเห็นได้อยู่แล้ว ตัดไม่เกิน 80 ตัวอักษร · ข้อความภายในไม่คืนเนื้อหา
export function replySnippetOf(all: Json[], replyId: unknown): { id: string; from: 'customer' | 'staff'; text: string } | null {
  const id = cleanReplyTo(replyId)
  const m = id ? all.find((x) => x && x.id === id) : null
  if (!m || !isCustomerVisible(m)) return null
  const kind = String(m.kind ?? 'text')
  const label = kind === 'quote' ? 'ใบเสนอราคา' : kind === 'order' ? 'สรุปออร์เดอร์' : ''
  const text = String(m.text ?? '').trim() || (Array.isArray(m.attachments) && m.attachments.length ? '[รูปภาพ]' : '') || label
  return { id: String(m.id), from: m.from === 'staff' ? 'staff' : 'customer', text: text.slice(0, 80) }
}

// สรุปออร์เดอร์ที่ร้านส่งในแชท: เหมือนการ์ดของ Facebook · ใช้เฉพาะการ์ดที่ร้านเก็บไว้ตอนส่ง (หัวข้อ รายการ ยอด และลิงก์ดูออร์เดอร์ https)
export function customerOrderView(m: Json) {
  const c = m.card && typeof m.card === 'object' ? (m.card as Json) : null
  return {
    id: String(m.id ?? ''),
    from: 'staff' as const,
    kind: 'order' as const,
    text: c ? String(m.cardText ?? '').slice(0, 2000) : 'ร้านส่งสรุปออร์เดอร์ให้แล้ว',
    card: c ? { title: String(c.title ?? '').slice(0, 80), subtitle: String(c.subtitle ?? '').slice(0, 80), image: httpsUrl(c.image), url: httpsUrl(c.url) } : null,
    photos: [] as { ref: string; url: string | null }[],
    at: String(m.at ?? ''),
  }
}

// การ์ดแจ้งเตือน/ลิงก์จากร้าน (เช่น แจ้งยอดชำระ ลิงก์ดูออร์เดอร์): ชนิดการ์ดต้องอยู่ในรายการที่กำหนด · ลิงก์และรูปเฉพาะ https
const CARD_KINDS = ['order', 'payreq', 'link', 'quote']
export function customerCardView(m: Json) {
  const c = m.card && typeof m.card === 'object' ? (m.card as Json) : null
  const kind = c && CARD_KINDS.includes(String(c.kind)) ? String(c.kind) : 'info'
  return {
    id: String(m.id ?? ''),
    from: 'staff' as const,
    kind: 'card' as const,
    text: String(c ? (m.cardText ?? m.text ?? '') : (m.text ?? '')).slice(0, 2000),
    card: c ? { kind, title: String(c.title ?? '').slice(0, 80), subtitle: String(c.subtitle ?? '').slice(0, 80), image: httpsUrl(c.image), url: httpsUrl(c.url), pay: c.pay === true } : null,
    photos: [] as { ref: string; url: string | null }[],
    at: String(m.at ?? ''),
  }
}

// ใบเสนอที่ร้านส่งในแชท: ลูกค้าเห็นเป็นการ์ดอ่านอย่างเดียว · ใช้เฉพาะการ์ดที่ร้านเก็บไว้ตอนส่ง (หัวข้อ บรรทัดรอง รายการ/วันนัด/ยอดรวม และรูป https)
// ใบเก่าที่ไม่มีการ์ด = แจ้งแค่ว่าร้านส่งใบเสนอแล้ว (ไม่มีข้อมูลภายใน)
const httpsUrl = (u: unknown) => (typeof u === 'string' && /^https:\/\/\S+$/i.test(u) && u.length <= 500 ? u : null)
export function customerQuoteView(m: Json) {
  const c = m.card && typeof m.card === 'object' ? (m.card as Json) : null
  return {
    id: String(m.id ?? ''),
    from: 'staff' as const,
    kind: 'quote' as const,
    text: c ? String(m.cardText ?? '').slice(0, 2000) : 'ร้านส่งใบเสนอราคาให้แล้ว',
    card: c ? { title: String(c.title ?? '').slice(0, 80), subtitle: String(c.subtitle ?? '').slice(0, 80), image: httpsUrl(c.image) } : null,
    photos: [] as { ref: string; url: string | null }[],
    at: String(m.at ?? ''),
  }
}

// รูปในข้อความ: ลิงก์ชั่วคราวเฉพาะรูปที่ลูกค้ายังไม่มีในเครื่อง (have = ref ที่มีลิงก์ยังไม่หมดอายุแล้ว)
async function photosView(m: Json, sign: Signer, have: Set<string>): Promise<{ ref: string; url: string | null }[]> {
  const out: { ref: string; url: string | null }[] = []
  for (const a of Array.isArray(m.attachments) ? m.attachments : []) {
    const ref = typeof a?.path === 'string' ? a.path : ''
    const key = photoKeyOf(ref)
    if (!key || a?.type !== 'image') continue
    out.push({ ref, url: have.has(ref) ? null : await sign(key) })
  }
  return out
}

// ออร์เดอร์เดิม (ส่งก่อนมีการ์ดในแชทเว็บ): สร้างการ์ดสรุปจากข้อมูลออร์เดอร์ตอนอ่าน (เหมือนการ์ดที่ส่งตอนนี้ แต่ไม่มีปุ่มลิงก์)
// ไม่สร้างลิงก์ใหม่ตอนอ่าน (กันการสร้างลิงก์ซ้ำทุกครั้งที่ลูกค้าเปิดแชท)
export function legacyOrderCardOf(order: Json): { text: string; card: Json } {
  const r = orderCardMsg(order, orderTotals(order), '', {})
  return { text: String(r.text ?? ''), card: r.card as Json }
}
async function legacyOrderCards(sb: any, msgs: Json[]): Promise<Map<string, { text: string; card: Json }>> {
  const out = new Map<string, { text: string; card: Json }>()
  const ids = [...new Set(msgs.filter((m) => m && m.kind === 'order' && !m.card && typeof m.orderId === 'string' && m.orderId).map((m) => String(m.orderId)))].slice(0, 50)
  if (!ids.length) return out
  const r = await sb.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data').in('id', ids)
  if (r?.error) return out
  for (const row of Array.isArray(r?.data) ? r.data : []) {
    try {
      const d = (row.data || {}) as Json
      const order = { ...d, id: String(row.id), code: row.code, customerId: row.customer_id || '', status: row.status, fulfillment: row.fulfillment, ...(row.channel ? { channel: row.channel } : {}) }
      out.set(String(row.id), legacyOrderCardOf(order))
    } catch { /* ข้อมูลออร์เดอร์ไม่ครบ → คงข้อความสำรองของการ์ด */ }
  }
  return out
}

// ประวัติแชทของลูกค้า (ข้อความล่าสุดไม่เกิน 100 รายการ) + สถานะพิมพ์/อ่านแล้วของร้าน (เฉพาะที่ร้านเปิดให้เห็น) + ชื่อช่องสัญญาณเรียลไทม์
export async function customerChatList(sb: any, customerId: string, sign: Signer, have: string[] = []): Promise<{ status: number; body: Json }> {
  const r = await sb.from('punpang_chats').select('id,data').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
  if (r?.error) return { status: 500, body: { error: 'อ่านแชทไม่สำเร็จ' } }
  const msgs: Json[] = Array.isArray(r?.data?.data?.messages) ? r.data.data.messages : []
  const visible = msgs.filter(isCustomerVisible)
  const haveSet = new Set(have.filter((x) => typeof x === 'string').slice(0, 500))
  const recent = visible.slice(-100)
  const legacy = await legacyOrderCards(sb, recent)
  const messages = await Promise.all(recent.map(async (m) => {
    const lc = m.kind === 'order' && !m.card && m.orderId ? legacy.get(String(m.orderId)) : undefined
    const base = m.kind === 'quote' ? customerQuoteView(m) : m.kind === 'order' ? customerOrderView(lc ? { ...m, card: lc.card, cardText: lc.text } : m) : m.kind === 'card' ? customerCardView(m) : { ...toCustomerView(m), photos: await photosView(m, sign, haveSet) }
    return { ...base, replyTo: replySnippetOf(msgs, m.replyTo) }
  }))
  const presence = await shopPresenceFor(sb, r?.data?.id)
  const chatTopic = await chatTopicOf(sb, customerId)
  return { status: 200, body: { messages, presence, chatTopic } }
}

// ชื่อช่องสัญญาณของลูกค้า: สร้างครั้งแรกแล้วเก็บ · ตารางยังไม่พร้อม/อ่านไม่ได้ = null (ลูกค้าใช้การโพลล์แทน)
async function chatTopicOf(sb: any, customerId: string): Promise<string | null> {
  try {
    const read = () => sb.from('punpang_chat_topics').select('topic').eq('customer_id', customerId).maybeSingle()
    let r = await read()
    if (!r?.data?.topic) {
      await sb.from('punpang_chat_topics').upsert({ customer_id: customerId, topic: newChatTopic() }, { onConflict: 'customer_id', ignoreDuplicates: true })
      r = await read()
    }
    return r?.data?.topic ? String(r.data.topic) : null
  } catch { return null }
}

// สถานะของร้านที่ลูกค้าเห็น · ตารางยังไม่มี/อ่านไม่ได้ = ไม่แสดง (ไม่ทำให้รายการแชทล้มเหลว)
async function shopPresenceFor(sb: any, chatId: string | undefined): Promise<{ shopTyping: boolean; shopReadAt: string | null }> {
  const cfg = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'bot').maybeSingle()
  const row = chatId ? await sb.from('punpang_chat_presence').select('staff_typing_at,staff_read_at').eq('chat_id', chatId).maybeSingle() : null
  return shopPresenceOf(row && !row.error ? (row.data ?? null) : null, cfg?.data?.data?.v?.presence, Date.now())
}

// ลูกค้ากำลังพิมพ์ / อ่านแล้ว → เขียนแถวสถานะเล็ก ๆ (ไม่แตะแถวแชท) · ไม่มีกระทู้แชท หรือตารางยังไม่พร้อม = ไม่ทำอะไร (ยังตอบ ok)
async function touchPresence(sb: any, customerId: string, patch: Json): Promise<{ status: number; body: Json }> {
  const r = await sb.from('punpang_chats').select('id').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
  if (r?.error || !r?.data?.id) return { status: 200, body: { ok: true } }
  await sb.from('punpang_chat_presence').upsert({ chat_id: r.data.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
  return { status: 200, body: { ok: true } }
}
export const customerChatTyping = (sb: any, customerId: string) => touchPresence(sb, customerId, { customer_typing_at: new Date().toISOString() })
export const customerChatRead = (sb: any, customerId: string) => touchPresence(sb, customerId, { customer_read_at: new Date().toISOString() })
// ส่งข้อความแล้ว = หยุดพิมพ์ (ล้างสถานะทันที ไม่รอให้หมดช่วง) · ไม่กระทบการส่ง
async function stoppedTyping(sb: any, chatId: string): Promise<void> {
  try { await sb.from('punpang_chat_presence').update({ customer_typing_at: null, updated_at: new Date().toISOString() }).eq('chat_id', chatId) } catch { /* สถานะเป็นของเสริม */ }
}

// ตรวจรูปที่แนบ: ต้องอยู่ในทะเบียนของลูกค้าคนนี้ · คืนรายการที่จะเก็บในข้อความ
async function attachmentsOf(sb: any, customerId: string, refs: string[]): Promise<{ list: Json[] } | { error: string }> {
  const list: Json[] = []
  for (const ref of refs) {
    const key = photoKeyOf(ref) as string
    const r = await sb.from('punpang_kv').select('data').eq('collection', CHAT_PHOTO_KV).eq('id', key).maybeSingle()
    if (r?.error) return { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' }
    if (!r?.data || r.data.data?.customerId !== customerId) return { error: 'รูปที่แนบไม่ถูกต้อง กรุณาแนบใหม่' }
    list.push({ type: 'image', mime: String(r.data.data.mime || 'image/jpeg'), size: Number(r.data.data.size) || 0, name: 'รูปภาพ', path: ref })
  }
  return { list }
}

// ส่งข้อความจากลูกค้า: ตรวจบัญชี ข้อความ/รูป และความถี่ · บันทึกลงกระทู้ของลูกค้า แล้วแจ้งกระดิ่งพนักงาน
export async function customerChatSend(sb: any, customerId: string, rawText: unknown, rawPhotos?: unknown, rawReplyTo?: unknown): Promise<{ status: number; body: Json }> {
  const hasText = String(rawText ?? '').trim() !== ''
  const text = hasText ? cleanChatText(rawText) : ''
  if (text === null) return { status: 400, body: { error: `ข้อความต้องมี 1–${CHAT_TEXT_MAX} ตัวอักษร` } }
  const hasReply = rawReplyTo !== undefined && rawReplyTo !== null && String(rawReplyTo).trim() !== ''
  const replyTo = hasReply ? cleanReplyTo(rawReplyTo) : null
  if (hasReply && !replyTo) return { status: 400, body: { error: 'ข้อความที่ตอบกลับไม่ถูกต้อง' } }
  const refs = photoRefsOf(rawPhotos, customerId)
  if ('error' in refs) return { status: 400, body: { error: refs.error } }
  if (!text && !refs.refs.length) return { status: 400, body: { error: 'ส่งข้อความหรือรูปอย่างน้อยหนึ่งอย่าง' } }
  const atts = await attachmentsOf(sb, customerId, refs.refs)
  if ('error' in atts) return { status: 400, body: { error: atts.error } }

  const cu = await sb.from('punpang_customers').select('name,data').eq('id', customerId).maybeSingle()
  if (cu?.error || !cu?.data) return { status: 404, body: { error: 'ไม่พบบัญชีลูกค้า' } }
  if (cu.data.data?.deleted === true || cu.data.data?.active === false) return { status: 403, body: { error: 'บัญชีนี้ใช้งานแชทไม่ได้' } }
  const name = String(cu.data.name ?? '').trim() || 'ลูกค้า'
  const preview = text || '[รูปภาพ]'

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(80 + Math.floor(Math.random() * 220))
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
    if (cur?.error) return { status: 500, body: { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' } }
    const nowIso = new Date().toISOString()
    const msg = { id: newId('cm'), from: 'customer', kind: 'text', text, orderId: null, quoteId: null, replyTo, ask: null, answerFor: null, filled: null, attachments: atts.list, at: nowIso, by: 'ลูกค้า', delivery: null }

    if (!cur?.data) {
      // ยังไม่มีกระทู้เว็บของลูกค้ารายนี้ → สร้างใหม่ (ยังไม่มีข้อความให้ตอบกลับ)
      if (replyTo) return { status: 400, body: { error: 'ไม่พบข้อความที่ตอบกลับ' } }
      const chatId = newId('ch')
      const data = { id: chatId, profileName: name, messages: [msg], unreadStaff: 1, lastInboundAt: nowIso, updatedAt: nowIso, pendingAsk: null }
      const ins = await sb.from('punpang_chats').insert({ id: chatId, channel: 'web', external_id: customerId, customer_id: customerId, data })
      if (!ins?.error) { await notifyStaff(sb, chatId, name, preview); await stoppedTyping(sb, chatId); return { status: 200, body: { ok: true, message: { ...toCustomerView(msg), photos: atts.list.map((a) => ({ ref: a.path, url: null })) } } } }
      if (ins.error.code !== '23505') return { status: 500, body: { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' } }
      continue // มีกระทู้เกิดพร้อมกัน → ลองอ่านใหม่
    }

    const d = cur.data.data || {}
    const msgs: Json[] = Array.isArray(d.messages) ? d.messages : []
    if (replyTo && !msgs.some((m) => m?.id === replyTo && isCustomerVisible(m))) return { status: 400, body: { error: 'ไม่พบข้อความที่ตอบกลับ' } }
    const recent = msgs.filter((m) => m?.from === 'customer' && Date.now() - new Date(m.at).getTime() < CHAT_RATE.windowMs).length
    if (recent >= CHAT_RATE.max) return { status: 429, body: { error: 'ส่งข้อความถี่เกินไป กรุณารอสักครู่' } }
    const next = { ...d, profileName: name, messages: [...msgs, msg], unreadStaff: (Number(d.unreadStaff) || 0) + 1, lastInboundAt: nowIso, updatedAt: nowIso }
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', cur.data.id).eq('updated_at', cur.data.updated_at).select('id')
    if (!up?.error && (up?.data || []).length) { await notifyStaff(sb, cur.data.id, name, preview); await stoppedTyping(sb, cur.data.id); return { status: 200, body: { ok: true, message: { ...toCustomerView(msg), photos: atts.list.map((a) => ({ ref: a.path, url: null })), replyTo: replySnippetOf(msgs, replyTo) } } } }
  }
  return { status: 409, body: { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' } }
}

// อัปโหลดรูปหนึ่งรูปจากแชท → เก็บใต้โฟลเดอร์ของลูกค้า และลงทะเบียนไว้ให้ลบเมื่อครบกำหนด · ไม่แนบเข้าข้อความจนกว่าจะส่ง
export async function customerChatPhoto(sb: any, customerId: string, rawPhoto: unknown, f: FilesEnv): Promise<{ status: number; body: Json }> {
  const d = decodePhotoDataUrl(rawPhoto)
  if ('error' in d) return { status: 400, body: { error: d.error } }
  const cu = await sb.from('punpang_customers').select('data').eq('id', customerId).maybeSingle()
  if (cu?.error || !cu?.data) return { status: 404, body: { error: 'ไม่พบบัญชีลูกค้า' } }
  if (cu.data.data?.deleted === true || cu.data.data?.active === false) return { status: 403, body: { error: 'บัญชีนี้ใช้งานแชทไม่ได้' } }
  const since = new Date(Date.now() - CHAT_RATE.windowMs).toISOString()
  const cnt = await sb.from('punpang_kv').select('id', { count: 'exact', head: true }).eq('collection', CHAT_PHOTO_KV).eq('data->>customerId', customerId).gte('data->>at', since)
  if (!cnt?.error && (cnt.count ?? 0) >= CHAT_PHOTO_UPLOAD_MAX) return { status: 429, body: { error: 'ส่งรูปถี่เกินไป กรุณารอสักครู่' } }

  let up: { key: string; ref: string }
  try { up = await svcUpload(f, d.bytes, photoPrefixOf(customerId)) } catch { return { status: 502, body: { error: 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่' } } }
  if (!photoKeyOwned(up.key, customerId)) return { status: 502, body: { error: 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่' } }
  const at = new Date().toISOString()
  const reg = await sb.from('punpang_kv').upsert({ collection: CHAT_PHOTO_KV, id: up.key, data: { customerId, mime: d.type, size: d.bytes.length, at }, updated_at: at }, { onConflict: 'collection,id' })
  if (reg?.error) {
    // ไม่มีทะเบียน = ลบไม่ได้ จึงลบไฟล์ที่เพิ่งอัปโหลดทิ้ง
    await svcDelete(f, [up.key])
    return { status: 500, body: { error: 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่' } }
  }
  return { status: 200, body: { ok: true, ref: up.ref, mime: d.type, size: d.bytes.length } }
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
