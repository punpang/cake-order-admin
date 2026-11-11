import { createClient } from 'npm:@supabase/supabase-js@2'
import { runFbBot } from './bot.ts'

// รับข้อความ Messenger ของเพจที่เชื่อมไว้ (Webhook ของ Meta) → เขียนเข้าแชท (punpang_chats) + กระดิ่งทีม
// GET: ยืนยัน webhook (hub.verify_token = secret FB_VERIFY_TOKEN) · POST: ตรวจลายเซ็น X-Hub-Signature-256 ด้วย FB_APP_SECRET
const GRAPH = 'https://graph.facebook.com'
const text = (b: string, status = 200) => new Response(b, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const rand = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer)
export function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
async function hmacHex(secret: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))
}
const ATTACH_TEXT = '[ลูกค้าส่งข้อความชนิดที่ระบบยังแสดงไม่ได้ — ดูในกล่องข้อความของเพจ]'
// ไฟล์แนบ: เก็บสำเนาใน bucket private punpang-chat (URL ของ Facebook หมดอายุ) · จำกัดขนาด/ชนิด ตาม bucket
const MAX_BYTES = 8 * 1024 * 1024
const MAX_ATT = 6
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'application/pdf': 'pdf', 'text/plain': 'txt' }
const KINDS = ['image', 'video', 'audio', 'file']
async function readLimited(res: Response): Promise<Uint8Array | null> {
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_BYTES || !res.body) return null
  const chunks: Uint8Array[] = []
  let n = 0
  const rd = res.body.getReader()
  for (;;) {
    const { done, value } = await rd.read()
    if (done) break
    n += value.length
    if (n > MAX_BYTES) { await rd.cancel(); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(n)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
// → { list: ไฟล์ที่เก็บได้/ล้มเหลว, unsupported: มีชนิดที่ไม่รองรับ }
async function saveAttachments(sb: any, psid: string, mid: string, atts: any[]) {
  const list: any[] = []
  let unsupported = false
  const safeMid = mid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || rand(6)
  let i = 0
  for (const a of (Array.isArray(atts) ? atts : []).slice(0, MAX_ATT)) {
    const type = String(a?.type || '')
    if (!KINDS.includes(type)) { unsupported = true; continue }
    const sticker = type === 'image' && a?.payload?.sticker_id ? true : undefined
    const fail = { type, failed: true, ...(sticker ? { sticker } : {}) }
    const url = String(a?.payload?.url || '')
    if (!/^https:\/\//i.test(url)) { list.push(fail); continue }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const ext = MIME_EXT[mime]
      if (!res.ok || !ext) { list.push(fail); continue }
      const bytes = await readLimited(res)
      if (!bytes || !bytes.length) { list.push(fail); continue }
      const path = `fb/${psid}/${safeMid}-${i++}.${ext}`
      const up = await sb.storage.from('punpang-chat').upload(path, bytes, { contentType: mime, upsert: true })
      if (up.error) { list.push(fail); continue }
      list.push({ type, path, mime, name: `${type}-${i}.${ext}`, size: bytes.length, ...(sticker ? { sticker } : {}) })
    } catch { list.push(fail) }
  }
  return { list, unsupported }
}
const KIND_TH: Record<string, string> = { image: 'รูปภาพ', video: 'วิดีโอ', audio: 'เสียง', file: 'ไฟล์' }

Deno.serve(async (req) => {
  const secret = (Deno.env.get('FB_APP_SECRET') || '').trim()
  const verify = (Deno.env.get('FB_VERIFY_TOKEN') || '').trim()
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    if (verify.length >= 8 && q.get('hub.mode') === 'subscribe' && safeEq(q.get('hub.verify_token') || '', verify)) return text(q.get('hub.challenge') || '')
    return text('forbidden', 403)
  }
  if (req.method !== 'POST') return text('method', 405)
  if (!secret) return text('not configured', 503)
  const raw = await req.text()
  if (raw.length > 1_000_000) return text('too large', 413)
  const sig = (req.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '')
  if (!safeEq(sig, await hmacHex(secret, raw))) return text('bad signature', 403)
  let body: any
  try { body = JSON.parse(raw) } catch { return text('bad json', 400) }
  // page = Messenger ของเพจ · instagram = DM ของบัญชี IG ที่ผูกกับเพจ (entry.id คือ IG account id · ยืนยันลายเซ็นแล้วจึงเชื่อถือได้)
  const isIg = body?.object === 'instagram'
  if (body?.object !== 'page' && !isIg) return text('ignored')
  const channel = isIg ? 'instagram' : 'facebook'

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const pg = await sb.from('punpang_fb_pages').select('page_id,token').limit(1).maybeSingle()
  if (!pg.data) return text('no page') // ยังไม่ได้เชื่อมเพจ → ไม่ให้ Meta ส่งซ้ำ
  const ver = (Deno.env.get('FB_GRAPH_VERSION') || 'v24.0').trim()
  const botJobs: Promise<unknown>[] = []

  for (const entry of body.entry || []) {
    if (!isIg && String(entry?.id) !== pg.data.page_id) continue // เพจที่ไม่ได้เชื่อม
    const own = isIg ? String(entry?.id || '') : pg.data.page_id // id ของฝั่งเรา (ผู้รับข้อความ)
    if (!own) continue
    for (const ev of entry.messaging || []) {
      const psid = String(ev?.sender?.id || '')
      const msg = ev?.message
      if (!isIg && ev?.postback && /^\d{5,30}$/.test(psid) && String(ev?.recipient?.id) === pg.data.page_id) { // ลูกค้ากดปุ่มในใบเสนอ (เฉพาะ Messenger)
        if ((await handlePostback(sb, pg.data, ver, psid, ev)) === 'retry') return text('db error', 500)
        continue
      }
      if (!/^\d{5,30}$/.test(psid) || !msg || msg.is_echo || String(ev?.recipient?.id) !== own) continue
      const mid = String(msg.mid || '')
      const caption = String(msg.text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 2000)
      const att = Array.isArray(msg.attachments) && msg.attachments.length ? await saveAttachments(sb, psid, mid, msg.attachments) : { list: [], unsupported: false }
      // ไม่มีข้อความและไม่มีไฟล์ที่แสดงได้ (เช่น ตำแหน่ง) → ข้อความแจ้ง · noBot = ไม่ให้บอทตอบ
      const txt = caption || (att.list.length ? '' : ATTACH_TEXT)
      const noBot = !caption && (att.list.length > 0 || att.unsupported)
      const label = caption || (att.list[0] ? `[${att.list[0].sticker ? 'สติกเกอร์' : KIND_TH[att.list[0].type] || 'ไฟล์'}]` : ATTACH_TEXT)
      const at = new Date(typeof ev.timestamp === 'number' ? ev.timestamp : Date.now()).toISOString()
      const m = { id: `cm${rand(6)}`, from: 'customer', kind: 'text', text: txt, orderId: null, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, at, by: 'ลูกค้า', delivery: null, fbMid: mid || null, ...(att.list.length ? { attachments: att.list } : {}), ...(noBot ? { noBot: true } : {}) }

      let done = false
      let fresh = false // ข้อความใหม่จริง (ไม่ใช่ข้อความซ้ำจาก Meta) → ให้บอทพิจารณาตอบ
      for (let i = 0; i < 4 && !done; i++) {
        const cur = await sb.from('punpang_chats').select('id,data,updated_at,customer_id').eq('channel', channel).eq('external_id', psid).maybeSingle()
        if (cur.error) return text('db error', 500) // ให้ Meta ส่งซ้ำ (กันซ้ำด้วย mid)
        if (!cur.data) {
          let name = ''
          try { const r = await fetch(`${GRAPH}/${ver}/${psid}?${new URLSearchParams({ fields: 'name', access_token: pg.data.token })}`, { signal: AbortSignal.timeout(8000) }); if (r.ok) name = String((await r.json())?.name || '') } catch { /* ใช้ชื่อสำรอง */ }
          const chat = { profileName: name || (isIg ? 'ลูกค้า Instagram' : 'ลูกค้า Facebook'), messages: [m], unreadStaff: 1, lastInboundAt: at, updatedAt: at, pendingAsk: null }
          const newId = `ch${rand(6)}`
          const ins = await sb.from('punpang_chats').insert({ id: newId, channel, external_id: psid, customer_id: null, data: chat })
          if (!ins.error) { done = true; fresh = true; await bell(sb, `${chat.profileName}: ${label.slice(0, 60)}`, newId) } else if (ins.error.code !== '23505') return text('db error', 500)
          continue // 23505 = มีแชทเกิดขึ้นพร้อมกัน → อ่านใหม่แล้วต่อท้าย
        }
        const d = cur.data.data || {}
        const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
        if (mid && msgs.some((x) => x?.fbMid === mid)) { done = true; break } // ข้อความซ้ำจาก Meta
        const next = { ...d, messages: [...msgs, m], unreadStaff: (Number(d.unreadStaff) || 0) + 1, lastInboundAt: at, updatedAt: at }
        const up = await sb.from('punpang_chats').update({ data: next }).eq('id', cur.data.id).eq('updated_at', cur.data.updated_at).select('id')
        if (up.error) return text('db error', 500)
        if (up.data?.length) { done = true; fresh = true; await bell(sb, `${d.profileName || (isIg ? 'ลูกค้า Instagram' : 'ลูกค้า Facebook')}: ${label.slice(0, 60)}`, cur.data.id) }
      }
      if (!done) return text('busy', 500) // ชนกันหลายครั้ง → ให้ Meta ส่งซ้ำ
      // บอทตอบแชท (ฝั่งเซิร์ฟเวอร์) · เฉพาะข้อความตัวอักษรใหม่ · ข้อผิดพลาดของบอทต้องไม่ทำให้ Meta ส่งซ้ำทั้งชุด
      // ทำงานหลังตอบ 200 แล้ว (EdgeRuntime.waitUntil) เพื่อไม่ให้หน่วงเวลาของบอททำให้ Meta ส่งซ้ำ
      if (fresh && !noBot && caption) {
        botJobs.push((async () => {
          const chatRow = await sb.from('punpang_chats').select('id').eq('channel', channel).eq('external_id', psid).maybeSingle()
          if (chatRow.data?.id) await runFbBot({ sb, token: pg.data.token, ver, psid, chatId: chatRow.data.id, mid, text: caption, at, aiKey: Deno.env.get('ANTHROPIC_API_KEY') || '', channel })
        })().catch((e) => console.error('fb-bot', (e as Error)?.message ?? 'error')))
      }
    }
  }
  const pending = Promise.allSettled(botJobs)
  const er = (globalThis as any).EdgeRuntime
  if (er?.waitUntil) er.waitUntil(pending)
  else await pending
  return text('ok')
})

async function bell(sb: any, t: string, chatId: string | null) {
  // กระดิ่งพนักงาน: รวมรายการที่ยังไม่มีใครอ่านของแชทเดียวกันทำที่ฝั่งแอป ที่นี่เพิ่มรายการใหม่
  await sb.from('punpang_records').insert({ collection: 'bell', id: `bl${rand(6)}`, data: { audience: 'staff', event: 'chat_inbound', title: 'ข้อความใหม่จากลูกค้า', text: t, chatId, readBy: [], at: new Date().toISOString() } })
}

// ลูกค้ากดปุ่มใบเสนอ (postback `q:ok:<id>` ยืนยันสั่ง · `q:rev:<id>` ขอแก้ไข)
// ตรวจ: ผู้กดต้องเป็นเจ้าของแชทของใบเสนอนั้น · เปลี่ยนสถานะได้ครั้งเดียวจาก pending (เทียบสถานะตอนเขียน) · กดซ้ำ/เมตาส่งซ้ำไม่ซ้ำ (mid)
// ยืนยัน → customer_ok (หน้าแอดมินที่เปิดอยู่สร้างออร์เดอร์ต่อ) · ขอแก้ → revise · ตอบลูกค้าทันทีและลงข้อความในแชท
const pickupMs = (s: unknown) => { const v = String(s || ''); if (!v) return NaN; return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}${v.length === 16 ? ':00' : ''}+07:00`).getTime() }
async function handlePostback(sb: any, pg: { page_id: string; token: string }, ver: string, psid: string, ev: any): Promise<'ok' | 'retry'> {
  const pb = ev.postback
  const mm = /^q:(ok|rev):([A-Za-z0-9_-]{1,40})$/.exec(String(pb?.payload || ''))
  if (!mm) return 'ok' // ปุ่มอื่น ไม่เกี่ยวกับใบเสนอ
  const act = mm[1], qid = mm[2]
  const mid = String(pb?.mid || '')
  const at = new Date(typeof ev.timestamp === 'number' ? ev.timestamp : Date.now()).toISOString()
  const cr = await sb.from('punpang_chats').select('id,data').eq('channel', 'facebook').eq('external_id', psid).maybeSingle()
  if (cr.error) return 'retry'
  if (!cr.data) return 'ok'
  const chatId: string = cr.data.id
  if (mid && (Array.isArray(cr.data.data?.messages) ? cr.data.data.messages : []).some((x: any) => x?.fbMid === mid)) return 'ok' // Meta ส่งซ้ำ
  const qr = await sb.from('punpang_quotes').select('id,code,chat_id,status,data').eq('id', qid).maybeSingle()
  if (qr.error) return 'retry'
  const q = qr.data
  const target = act === 'ok' ? 'customer_ok' : 'revise'
  const code = String(q?.code || '')
  let reply = ''
  if (!q || q.chat_id !== chatId) reply = 'ไม่พบใบเสนอนี้ค่ะ กรุณาติดต่อร้านได้เลยนะคะ'
  else if (q.status === 'pending') {
    if (act === 'ok' && !(pickupMs(q.data?.payload?.pickupAt) > Date.now())) reply = 'ใบเสนอนี้เลยเวลานัดแล้วค่ะ รบกวนแจ้งวันเวลาใหม่ ร้านจะส่งใบเสนอให้ใหม่นะคะ'
    else {
      const up = await sb.from('punpang_quotes').update({ status: target, data: { ...(q.data || {}), respondedAt: at } }).eq('id', q.id).eq('status', 'pending').select('id')
      if (up.error) return 'retry'
      reply = up.data?.length ? (act === 'ok' ? `รับยืนยันใบเสนอ ${code} แล้วค่ะ ร้านกำลังสร้างออร์เดอร์ให้นะคะ` : 'รับทราบค่ะ รบกวนพิมพ์สิ่งที่ต้องการแก้ไขในแชทนี้ได้เลยนะคะ') : 'ร้านรับเรื่องนี้ไว้แล้วค่ะ'
    }
  } else if (q.status === target) reply = act === 'ok' ? `รับยืนยันใบเสนอ ${code} แล้วค่ะ ร้านกำลังสร้างออร์เดอร์ให้นะคะ` : 'รับทราบค่ะ รบกวนพิมพ์สิ่งที่ต้องการแก้ไขในแชทนี้ได้เลยนะคะ' // ครั้งก่อนเปลี่ยนสถานะแล้วแต่ลงแชทไม่สำเร็จ
  else if (q.status === 'superseded') reply = 'มีใบเสนอฉบับใหม่แล้วค่ะ รบกวนดูฉบับล่าสุดในแชทนะคะ'
  else if (act === 'ok' && ['customer_ok', 'converting', 'need_phone', 'accepted'].includes(q.status)) reply = 'ร้านรับยืนยันไว้แล้วค่ะ'
  else reply = 'ใบเสนอนี้ปิดไปแล้วค่ะ ติดต่อร้านได้เลยนะคะ'

  const custText = act === 'ok' ? `ยืนยันใบเสนอ ${code}` : `ขอแก้ไขใบเสนอ ${code}`
  const base = { orderId: null, quoteId: q?.id || null, replyTo: null, ask: null, answerFor: null, filled: null }
  const cm = { id: `cm${rand(6)}`, from: 'customer', kind: 'text', text: custText, ...base, at, by: 'ลูกค้า', delivery: null, fbMid: mid || null, noBot: true, quoteAction: act }
  const sm = { id: `cm${rand(6)}`, from: 'staff', kind: 'text', text: reply, ...base, at: new Date().toISOString(), by: 'ระบบ', delivery: 'sending' }
  let done = false
  for (let i = 0; i < 4 && !done; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chatId).maybeSingle()
    if (cur.error || !cur.data) return 'retry'
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    if (mid && msgs.some((x) => x?.fbMid === mid)) return 'ok'
    const next = { ...d, messages: [...msgs, cm, sm], unreadStaff: (Number(d.unreadStaff) || 0) + 1, lastInboundAt: at, updatedAt: at }
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (up.error) return 'retry'
    if (up.data?.length) done = true
  }
  if (!done) return 'retry'
  await bell(sb, `${cr.data.data?.profileName || 'ลูกค้า Facebook'}: ${custText}`, chatId)
  // ตอบลูกค้าทันที แล้วบันทึกผลส่งลงข้อความของระบบ (ไม่ต้องรอพนักงาน)
  let sent = false
  try {
    const r = await fetch(`${GRAPH}/${ver}/me/messages?${new URLSearchParams({ access_token: pg.token })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: reply } }), signal: AbortSignal.timeout(10000) })
    sent = r.ok
  } catch { sent = false }
  for (let i = 0; i < 3; i++) {
    const cur = await sb.from('punpang_chats').select('data,updated_at').eq('id', chatId).maybeSingle()
    if (cur.error || !cur.data) break
    const d = cur.data.data || {}
    const msgs: any[] = (Array.isArray(d.messages) ? d.messages : []).map((x: any) => (x?.id === sm.id ? { ...x, delivery: sent ? 'sent' : 'failed', ...(sent ? {} : { deliveryError: 'ส่งตอบลูกค้าไม่สำเร็จ' }) } : x))
    const up = await sb.from('punpang_chats').update({ data: { ...d, messages: msgs } }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (!up.error && up.data?.length) break
  }
  return 'ok'
}
