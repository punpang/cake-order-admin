import { startSync, selectAll, withVer, fillArray } from './tableSync.js'

// ซิงก์แชท (db.chats) กับ punpang_chats และใบเสนอ (db.quotes) กับ punpang_quotes
// ข้อความในแชท/ร่างบอท/ฯลฯ อยู่ใน data (jsonb) · ใช้สิทธิ์ 'chat' (ลบได้เฉพาะ 'manage' = ตอนอนุมัติลบข้อมูลลูกค้า)
// ข้อความจาก Facebook จริงต้องเข้าผ่าน webhook (Edge Function) ในอนาคต — ตอนนี้เป็นการจำลองในแอป
export function chatToRow(c) {
  const { id, channel, externalId, customerId, ...rest } = c
  return { id, channel, external_id: externalId || null, customer_id: customerId || null, data: rest }
}
// _v = updated_at ของแถว (ไม่เข้า JSON) ใช้เป็นจุดเริ่มดึงเฉพาะที่เปลี่ยน และเวอร์ชันสำหรับบันทึกแบบเทียบเวอร์ชัน
export function rowToChat(r) {
  return withVer({ ...(r.data || {}), id: r.id, channel: r.channel, externalId: r.external_id || '', customerId: r.customer_id || null }, r.updated_at)
}
export { quoteToRow, rowToQuote } from './quoteRow.js'
import { quoteToRow, rowToQuote } from './quoteRow.js'

const byDesc = (f) => (a, b) => String(b[f] || '').localeCompare(String(a[f] || ''))

const CHAT_COLS = 'id,channel,external_id,customer_id,data,updated_at'
// โหลดเฉพาะแชทล่าสุด (ตามเวลาที่แก้ล่าสุด) + แชทที่ผู้ใช้เปิด/ค้นเจอแล้วจำไว้ (pinned) · แชทเก่าอื่น ๆ ดึงเมื่อถูกเรียกใช้เท่านั้น
export const RECENT_CHATS = 150
const IN_CHUNK = 100
export async function loadChats(client, pinned = []) {
  const recent = await client.from('punpang_chats').select(CHAT_COLS).order('updated_at', { ascending: false }).limit(RECENT_CHATS)
  if (recent.error) return { error: recent.error.message }
  const rows = new Map((recent.data || []).map((r) => [r.id, r]))
  const extra = pinned.filter((id) => !rows.has(id))
  for (let i = 0; i < extra.length; i += IN_CHUNK) {
    const p = await loadChatRows(client, extra.slice(i, i + IN_CHUNK))
    if (p.error) return { error: p.error }
    for (const r of p.data) rows.set(r.id, r)
  }
  const all = [...rows.values()]
  // vers = updated_at ของแต่ละแถวตอนโหลด (ไว้ตรวจว่ามีคนแก้แถวนี้ระหว่างนั้นไหมตอนเขียนกลับ)
  return { items: all.map(rowToChat).sort(byDesc('updatedAt')), vers: new Map(all.map((r) => [r.id, r.updated_at])) } // แชทล่าสุดอยู่บนสุด
}
async function loadChatRows(client, ids) {
  const r = await client.from('punpang_chats').select(CHAT_COLS).in('id', ids)
  if (r.error) return { error: r.error.message }
  return { data: r.data || [] }
}
// ดึงเฉพาะแชทที่แก้หลังเวลา since (ข้อความใหม่จาก webhook / อีกเครื่องตอบ)
export async function loadChatsSince(client, since) {
  const a = await selectAll((x, y) => client.from('punpang_chats').select(CHAT_COLS).gte('updated_at', since).order('updated_at').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToChat) }
}
// ดึงแชทตามรหัส (ใช้กับแชทเก่าที่ถูกเปิด/ค้นเจอ และการแจ้งเตือนจาก Realtime)
export async function loadChatsByIds(client, ids) {
  const out = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const p = await loadChatRows(client, ids.slice(i, i + IN_CHUNK))
    if (p.error) return { error: p.error }
    out.push(...p.data)
  }
  return { items: out.map(rowToChat) }
}
// ค้นแชทที่อยู่นอกชุดล่าสุด: ชื่อ Facebook ตรงคำค้น · ลูกค้าที่ตรงเบอร์/ชื่อ/ออร์เดอร์ · แชทที่ใบเสนอตรง (ข้อมูลพวกนี้ดึงไว้ในเครื่องแล้ว)
const clean = (s) => String(s ?? '').replace(/[,()*"\\%]/g, ' ').trim()
export async function searchChatIds(client, { text = '', customerIds = [], chatIds = [] } = {}) {
  const parts = []
  const t = clean(text)
  if (t) parts.push(`data->>profileName.ilike.*${t}*`)
  if (customerIds.length) parts.push(`customer_id.in.(${customerIds.map(clean).filter(Boolean).join(',')})`)
  if (chatIds.length) parts.push(`id.in.(${chatIds.map(clean).filter(Boolean).join(',')})`)
  if (!parts.length) return { ids: [] }
  const r = await client.from('punpang_chats').select('id').or(parts.join(',')).limit(100)
  if (r.error) return { error: r.error.message }
  return { ids: (r.data || []).map((x) => x.id) }
}
// ตัวช่วยให้หน้าแชทเรียกใช้ (ตั้งค่าเมื่อเริ่มซิงก์แชท)
// ก่อนซิงก์แชทเสร็จ คำขอ ensure ถูกเก็บคิวไว้แล้วทำทีหลัง
export const chatRemote = { queue: [], ensure: async (ids) => { chatRemote.queue.push(...ids) }, search: async () => {} }
// ใบเสนอที่ยังต้องดำเนินการ (ไม่ว่าแชทจะโหลดอยู่หรือไม่) · สถานะอื่น (รับแล้ว/ถูกแทน ฯลฯ) โหลดเฉพาะของแชทที่อยู่ในเครื่อง
export const OPEN_QUOTE_STATUSES = ['pending', 'customer_ok', 'converting', 'need_phone', 'revise']
const QUOTE_COLS = 'id,code,chat_id,customer_id,status,order_id,data,updated_at'
const quoteRow = (r) => withVer(rowToQuote(r), r.updated_at)
export async function loadQuotesFor(client, chatIds = [], { open = true } = {}) {
  const rows = new Map()
  if (open) {
    const a = await selectAll((x, y) => client.from('punpang_quotes').select(QUOTE_COLS).in('status', OPEN_QUOTE_STATUSES).order('id').range(x, y))
    if (a.error) return { error: a.error.message }
    for (const r of a.data || []) rows.set(r.id, r)
  }
  const ids = [...new Set(chatIds)].filter(Boolean)
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK)
    const b = await selectAll((x, y) => client.from('punpang_quotes').select(QUOTE_COLS).in('chat_id', part).order('id').range(x, y))
    if (b.error) return { error: b.error.message }
    for (const r of b.data || []) rows.set(r.id, r)
  }
  return { items: [...rows.values()].map(quoteRow).sort(byDesc('createdAt')) }
}
export async function loadQuotesSince(client, since) {
  const a = await selectAll((x, y) => client.from('punpang_quotes').select(QUOTE_COLS).gte('updated_at', since).order('updated_at').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(quoteRow) }
}
// เลขใบเสนอที่ค้น → แชทของใบเสนอนั้น (ใบเสนอเก่าที่ไม่ได้อยู่ในเครื่อง)
export async function searchQuoteChatIds(client, text) {
  const t = clean(text)
  if (t.length < 3) return { ids: [] }
  const r = await client.from('punpang_quotes').select('chat_id').ilike('code', `%${t}%`).limit(20)
  if (r.error) return { error: r.error.message }
  return { ids: [...new Set((r.data || []).map((x) => x.chat_id).filter(Boolean))] }
}

const ts = (v) => { const n = Date.parse(v); return Number.isFinite(n) ? n : 0 }

// รวมแชทในเครื่องกับแถวล่าสุดบนเซิร์ฟเวอร์ (เมื่อมีคนแก้ระหว่างนั้น เช่น webhook เพิ่มข้อความลูกค้า)
// - ข้อความที่มีเฉพาะบนเซิร์ฟเวอร์ถูกเก็บไว้ (แทรกตามเวลา) · ข้อความที่มีเฉพาะในเครื่องก็ไม่หาย
// - unreadStaff = ค่าในเครื่อง + ข้อความลูกค้าใหม่ที่เพิ่งได้จากเซิร์ฟเวอร์ · ฟิลด์อื่นใช้ค่าในเครื่อง ยกเว้น botSeenMid (เซิร์ฟเวอร์เป็นเจ้าของ)
export function mergeChat(local, server) {
  const msgs = [...(local.messages || [])]
  const have = new Set(msgs.map((m) => m?.id))
  const added = (server.messages || []).filter((m) => m?.id && !have.has(m.id))
  for (const m of added) {
    let i = msgs.length
    while (i > 0 && ts(msgs[i - 1].at) > ts(m.at)) i--
    msgs.splice(i, 0, m)
  }
  const newest = (x, y) => (ts(x) >= ts(y) ? x : y)
  const out = {
    ...local,
    messages: msgs,
    unreadStaff: (Number(local.unreadStaff) || 0) + added.filter((m) => m.from === 'customer').length,
    lastInboundAt: newest(local.lastInboundAt, server.lastInboundAt) ?? null,
    updatedAt: newest(local.updatedAt, server.updatedAt),
    customerId: local.customerId || server.customerId || null,
  }
  const seen = server.botSeenMid ?? local.botSeenMid
  if (seen) out.botSeenMid = seen
  return out
}

// เขียนแชทหนึ่งแถวแบบ compare-and-swap (ตรวจ updated_at) · ชน → ดึงล่าสุด รวม แล้วลองใหม่ (c ถูกอัปเดตตามผลรวม)
export async function pushOneChat(client, c, vers, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const ver = vers.get(c.id)
    const row = chatToRow(c)
    if (!ver) { // แชทใหม่ในเครื่อง
      const ins = await client.from('punpang_chats').insert(row).select('updated_at')
      if (!ins.error) { vers.set(c.id, ins.data?.[0]?.updated_at ?? null); return { ok: true } }
      if (ins.error.code !== '23505') return { error: ins.error.message } // 23505 = มีแถวนี้แล้ว (เช่น webhook สร้างพร้อมกัน) → รวมแล้วลองใหม่
    } else {
      const { id, ...cols } = row
      const up = await client.from('punpang_chats').update(cols).eq('id', c.id).eq('updated_at', ver).select('updated_at')
      if (up.error) return { error: up.error.message }
      if (up.data?.length) { vers.set(c.id, up.data[0].updated_at); return { ok: true } }
    }
    const cur = await client.from('punpang_chats').select(CHAT_COLS).eq('id', c.id).maybeSingle()
    if (cur.error) return { error: cur.error.message }
    if (!cur.data) { vers.delete(c.id); continue } // ถูกลบที่อื่น → สร้างใหม่ (เหมือนพฤติกรรม upsert เดิม)
    Object.assign(c, mergeChat(c, rowToChat(cur.data)))
    vers.set(c.id, cur.data.updated_at)
  }
  return { error: 'แชทถูกแก้พร้อมกันหลายครั้ง ลองใหม่อีกครั้ง' }
}

async function pushChats(client, { upserts, deletes }, vers) {
  for (const c of upserts) {
    const r = await pushOneChat(client, c, vers)
    if (r.error) return r
  }
  if (deletes.length) {
    const r = await client.from('punpang_chats').delete().in('id', deletes)
    if (r.error) return { error: r.error.message }
    for (const id of deletes) vers.delete(id)
  }
  return { ok: true }
}

// ข้อความ Facebook จากลูกค้าที่ยังไม่ผ่านบอท: ข้อความท้ายสุดของแชทเป็นของลูกค้า มี fbMid เกิดภายใน maxAgeMs และ botSeenMid ยังไม่ใช่ข้อความนี้
export function pendingBotMessages(chats, nowMs = Date.now(), maxAgeMs = 5 * 60 * 1000) {
  const out = []
  for (const c of chats) {
    if (c.channel !== 'facebook' && c.channel !== 'instagram') continue
    const m = (c.messages || [])[c.messages.length - 1]
    if (!m || m.from !== 'customer' || !m.fbMid || c.botSeenMid === m.fbMid) continue
    if (nowMs - ts(m.at) > maxAgeMs) continue
    out.push({ chatId: c.id, mid: m.fbMid })
  }
  return out
}

// ลบข้อความแชทที่เก่าเกินระยะเก็บ (เดือน · ตั้งที่ จัดการ → กฎหมาย "เก็บประวัติแชท")
// เก็บการ์ดออร์เดอร์/ใบเสนอไว้เป็นหลักฐานธุรกรรม · คำตอบที่บอทเรียนรู้เก็บแยกใน db.bot.learned อยู่แล้ว จึงไม่กระทบบอท
export function purgeOldMessages(chats, months, now = Date.now()) {
  const n = Math.floor(Number(months))
  if (!(n > 0)) return 0
  const d = new Date(now)
  d.setMonth(d.getMonth() - n)
  const cutoff = d.getTime()
  let removed = 0
  for (const c of chats) {
    const msgs = c.messages || []
    const keep = msgs.filter((m) => m.kind === 'order' || m.kind === 'quote' || ts(m.at) >= cutoff)
    if (keep.length !== msgs.length) { removed += msgs.length - keep.length; c.messages = keep }
  }
  return removed
}

// ใบเสนอที่ลูกค้ากดยืนยันทาง Messenger แล้วรอสร้างออร์เดอร์ (webhook ตั้ง customer_ok)
export const pendingQuoteConfirms = (quotes) => (quotes || []).filter((q) => q.status === 'customer_ok').map((q) => q.id)

// ใบเสนอ: แถวใหม่สร้างที่เซิร์ฟเวอร์ (quote-create) เท่านั้น → ที่นี่แก้ได้เฉพาะแถวที่มีอยู่แล้ว (สถานะ/ผูกออร์เดอร์/คำตอบ)
export async function pushQuotes(client, { upserts, deletes }) {
  for (const q of upserts) {
    const r = await client.from('punpang_quotes').update(quoteToRow(q)).eq('id', q.id).select('id')
    if (r.error) return { error: `${q.code || q.id}: ${r.error.message}` }
    if (!r.data?.length) return { error: `${q.code || q.id}: ไม่พบใบเสนอที่เซิร์ฟเวอร์` }
  }
  if (deletes.length) {
    const r = await client.from('punpang_quotes').delete().in('id', deletes)
    if (r.error) return { error: r.error.message }
  }
  return { ok: true }
}

export async function startChatSync({ client, db, canWrite, numbering, onError, onRecode, debounceMs, onInbound = null, onQuoteConfirm = null }) {
  let lastVers = new Map() // จากการโหลดล่าสุด
  let vers = new Map() // version ของแถวที่ข้อมูลในเครื่องอิงอยู่ (เปลี่ยนเมื่อแทนที่ข้อมูลจริงเท่านั้น — ถ้าโหลดแล้วข้ามเพราะมีการแก้ค้าง ต้องไม่เลื่อน version)
  const pinned = new Set() // แชทนอกชุดล่าสุดที่ผู้ใช้เปิด/ค้นเจอ/Realtime แจ้ง → ซิงก์ต่อในรอบถัดไปด้วย
  const pin = (ids) => { for (const id of ids) pinned.add(id); return ids }
  // ข้อความ Facebook ใหม่ → ให้ผู้เรียกจองสิทธิ์แล้วเรียกบอท (หน่วงเล็กน้อยให้ snapshot ของ sync ตั้งเสร็จก่อน กันการแก้ของบอทถูกนับเป็นข้อมูลเดิม)
  const botPending = (rows) => { if (onInbound) { const pend = pendingBotMessages(rows); if (pend.length) setTimeout(() => pend.forEach((x) => onInbound(x.chatId, x.mid)), 0) } }
  const pa = startSync({
    list: () => db.chats,
    replace: (items) => {
      vers = new Map(lastVers)
      fillArray(db.chats, items)
      botPending(items)
    },
    load: async () => { const r = await loadChats(client, [...pinned]); if (!r.error) lastVers = r.vers; return r },
    // ดึงเฉพาะแชทที่เปลี่ยน (แทนโหลด 150 แชทซ้ำทุกรอบ) · โหลดเต็มทุก 30 นาทีคืนเป็นชุดล่าสุด + ที่ปักหมุด
    loadSince: (since) => loadChatsSince(client, since),
    // แถวที่ได้มาภายหลัง (delta / Realtime): เวอร์ชันใหม่สำหรับบันทึก · เรียงแชทล่าสุดขึ้นบน · ข้อความลูกค้าใหม่ → บอท
    applyRows: (rows) => {
      for (const r of rows) if (r._v) vers.set(r.id, r._v)
      db.chats.sort(byDesc('updatedAt'))
      botPending(rows)
    },
    push: (c) => pushChats(client, c, vers),
    canWrite, onError, debounceMs, label: 'แชท', poll: true, // ข้อความจาก Facebook เข้าผ่าน webhook ระหว่างที่เปิดแอปอยู่
    loadByIds: (ids) => loadChatsByIds(client, pin(ids)),
  })
  // ใบเสนอโหลดหลังแชท: เฉพาะของแชทที่อยู่ในเครื่อง + ที่ยังต้องดำเนินการ (แทนทั้งตาราง)
  const a = await pa
  const confirmPending = (rows) => { if (onQuoteConfirm) { const pend = pendingQuoteConfirms(rows); if (pend.length) setTimeout(() => pend.forEach((id) => onQuoteConfirm(id)), 0) } }
  const b = await startSync({
    list: () => db.quotes,
    replace: (items) => {
      fillArray(db.quotes, items)
      if (numbering) numbering.seen(items.map((i) => i.code))
      confirmPending(items)
    },
    load: () => loadQuotesFor(client, db.chats.map((c) => c.id)),
    loadSince: (since) => loadQuotesSince(client, since),
    keep: (q) => OPEN_QUOTE_STATUSES.includes(q.status) || db.chats.some((c) => c.id === q.chatId),
    applyRows: (rows) => { if (numbering) numbering.seen(rows.map((i) => i.code)); confirmPending(rows) }, // ลูกค้ากดยืนยันบน Messenger (ได้มาจากรอบดึงเฉพาะที่เปลี่ยน)
    push: (c) => pushQuotes(client, c),
    canWrite, onError, debounceMs, label: 'ใบเสนอ', poll: true, // ลูกค้ากดปุ่มบน Messenger เปลี่ยนสถานะที่เซิร์ฟเวอร์
  })
  a.kind = 'chats' // ให้ชั้นล็อกอินเลือกรีเฟรชเฉพาะแชทถี่ ๆ ตอนเปิดหน้าแชท
  b.kind = 'chats'
  // ล้างข้อความเก่าเกินระยะเก็บ (การเปลี่ยนแปลงจะถูกซิงก์กลับเซิร์ฟเวอร์โดยอัตโนมัติ)
  // ตอนเปิดแอป และทุก 6 ชั่วโมงระหว่างใช้งาน (การเปลี่ยนแปลงจากการล้าง จะถูกซิงก์กลับเซิร์ฟเวอร์ผ่าน watch ของตัวซิงก์)
  if (canWrite) {
    const runPurge = () => purgeOldMessages(db.chats, db.legal?.contact?.retentionChat)
    runPurge()
    setInterval(runPurge, 6 * 60 * 60 * 1000)
  }
  // ดึงแชทเก่าที่ยังไม่อยู่ในเครื่อง (เปิดแชท/ค้นหา) แล้วจำไว้ให้ซิงก์รอบถัดไป
  chatRemote.ensure = async (ids) => {
    const missing = pin(ids).filter((id) => !db.chats.some((c) => c.id === id))
    if (!missing.length) return true
    const ok = a.refreshIds ? await a.refreshIds(missing) : false
    // ใบเสนอของแชทเก่าที่เพิ่งดึงมา (ปิดแล้วก็ต้องเห็นในเธรด)
    const qs = await loadQuotesFor(client, missing, { open: false })
    if (!qs.error && b.merge) b.merge(qs.items)
    return ok
  }
  const queued = chatRemote.queue.splice(0)
  if (queued.length) await chatRemote.ensure(queued)
  chatRemote.search = async (keys) => {
    const qc = keys.text ? await searchQuoteChatIds(client, keys.text) : { ids: [] } // ค้นด้วยเลขใบเสนอเก่า
    if (qc.ids?.length) keys = { ...keys, chatIds: [...new Set([...(keys.chatIds || []), ...qc.ids])] }
    const r = await searchChatIds(client, keys)
    if (r.error) return r
    await chatRemote.ensure(r.ids)
    return r
  }
  return [a, b]
}
