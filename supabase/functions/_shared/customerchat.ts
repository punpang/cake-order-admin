// แชทกับร้านของลูกค้าที่ล็อกอินแล้ว (เว็บและแอป) · ข้อความตัวอักษรและรูปภาพ (ไม่เกิน 2 MB ต่อรูป ไม่เกิน 5 รูปต่อข้อความ)
// เก็บเป็นกระทู้ของช่องทาง 'web' แยกจาก LINE/Facebook (ต่อลูกค้าหนึ่งคนหนึ่งกระทู้)
// เขียนแบบเทียบ updated_at (CAS) เหมือนแชทอื่น · ทุกข้อความใหม่แจ้งกระดิ่งพนักงาน (สิทธิ์ chat)
import { CHAT_PHOTO_KV, CHAT_PHOTO_UPLOAD_MAX, decodePhotoDataUrl, photoKeyOf, photoKeyOwned, photoPrefixOf, photoRefsOf } from './chatphoto.ts'
import { type FilesEnv, svcDelete, svcUpload } from './filesvc.ts'

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

// ประวัติแชทของลูกค้า (ข้อความล่าสุดไม่เกิน 100 รายการ)
export async function customerChatList(sb: any, customerId: string, sign: Signer, have: string[] = []): Promise<{ status: number; body: Json }> {
  const r = await sb.from('punpang_chats').select('id,data').eq('channel', 'web').eq('customer_id', customerId).maybeSingle()
  if (r?.error) return { status: 500, body: { error: 'อ่านแชทไม่สำเร็จ' } }
  const msgs: Json[] = Array.isArray(r?.data?.data?.messages) ? r.data.data.messages : []
  const visible = msgs.filter((m) => m && (m.from === 'customer' || m.from === 'staff') && (m.kind ?? 'text') === 'text')
  const haveSet = new Set(have.filter((x) => typeof x === 'string').slice(0, 500))
  const messages = await Promise.all(visible.slice(-100).map(async (m) => ({ ...toCustomerView(m), photos: await photosView(m, sign, haveSet) })))
  return { status: 200, body: { messages } }
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
export async function customerChatSend(sb: any, customerId: string, rawText: unknown, rawPhotos?: unknown): Promise<{ status: number; body: Json }> {
  const hasText = String(rawText ?? '').trim() !== ''
  const text = hasText ? cleanChatText(rawText) : ''
  if (text === null) return { status: 400, body: { error: `ข้อความต้องมี 1–${CHAT_TEXT_MAX} ตัวอักษร` } }
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
    const msg = { id: newId('cm'), from: 'customer', kind: 'text', text, orderId: null, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, attachments: atts.list, at: nowIso, by: 'ลูกค้า', delivery: null }

    if (!cur?.data) {
      // ยังไม่มีกระทู้เว็บของลูกค้ารายนี้ → สร้างใหม่
      const chatId = newId('ch')
      const data = { id: chatId, profileName: name, messages: [msg], unreadStaff: 1, lastInboundAt: nowIso, updatedAt: nowIso, pendingAsk: null }
      const ins = await sb.from('punpang_chats').insert({ id: chatId, channel: 'web', external_id: customerId, customer_id: customerId, data })
      if (!ins?.error) { await notifyStaff(sb, chatId, name, preview); return { status: 200, body: { ok: true, message: { ...toCustomerView(msg), photos: atts.list.map((a) => ({ ref: a.path, url: null })) } } } }
      if (ins.error.code !== '23505') return { status: 500, body: { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' } }
      continue // มีกระทู้เกิดพร้อมกัน → ลองอ่านใหม่
    }

    const d = cur.data.data || {}
    const msgs: Json[] = Array.isArray(d.messages) ? d.messages : []
    const recent = msgs.filter((m) => m?.from === 'customer' && Date.now() - new Date(m.at).getTime() < CHAT_RATE.windowMs).length
    if (recent >= CHAT_RATE.max) return { status: 429, body: { error: 'ส่งข้อความถี่เกินไป กรุณารอสักครู่' } }
    const next = { ...d, profileName: name, messages: [...msgs, msg], unreadStaff: (Number(d.unreadStaff) || 0) + 1, lastInboundAt: nowIso, updatedAt: nowIso }
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', cur.data.id).eq('updated_at', cur.data.updated_at).select('id')
    if (!up?.error && (up?.data || []).length) { await notifyStaff(sb, cur.data.id, name, preview); return { status: 200, body: { ok: true, message: { ...toCustomerView(msg), photos: atts.list.map((a) => ({ ref: a.path, url: null })) } } } }
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
