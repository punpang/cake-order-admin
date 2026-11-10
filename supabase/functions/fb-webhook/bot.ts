// บอทตอบแชท Facebook ฝั่งเซิร์ฟเวอร์ (Phase 1) · เรียกหลังบันทึกข้อความตัวอักษรของลูกค้าแล้ว ไม่ต้องมีพนักงานเปิดแอป
// ตอบเอง (เฉพาะประเภทที่ตั้งเป็น "ตอบเอง" ใน config.bot.sourceModes): เวลาเปิด · นอกเวลาทำการ · คำถามที่พบบ่อยที่ตรงชัด · กฎคีย์เวิร์ดที่ตั้งไว้
// ส่งต่อพนักงาน (แจ้งกระดิ่ง ไม่ส่งข้อความถึงลูกค้า): เรื่องเงิน/ร้องเรียน · เลขออร์เดอร์ · ราคา/แนะนำสินค้า · ที่ต้องขอข้อมูลก่อน · ไม่แน่ใจ
// เขียนใหม่สำหรับ Deno (ไม่คัดลอกจาก src/lib/chatBot.js ตรง ๆ) · กติกาให้ตรงกับ botReply ในส่วนที่ Phase 1 ทำ
// ค่าตั้งอ่านจาก punpang_kv (collection 'config': bot, shop) · ไม่มีค่า → ไม่ทำงาน

const GRAPH = 'https://graph.facebook.com'
const STALE_MS = 5 * 60_000 // ข้อความเก่ากว่านี้ (เช่น Meta ส่งซ้ำนาน ๆ) ไม่ตอบ
const LOCKED = ['handoff', 'order_unverified']
const SENSITIVE = ['คืนเงิน', 'เงินคืน', 'ขอเงินคืน', 'ร้องเรียน', 'โกง', 'หลอก', 'ไม่พอใจ', 'แย่มาก', 'เสียหาย', 'เสียใจ', 'ฟ้อง', 'โอนผิด', 'โอนซ้ำ', 'เรียกเงิน', 'ชดเชย', 'ผู้บริโภค', 'refund', 'complain', 'ค่าเสียหาย', 'ทวงเงิน']
const ORDER_RE = /\bOR-\d{6}-\d{6}\b|\bOR-\d{3,}\b/i
const HOURS_RE = /เปิดกี่โมง|ปิดกี่โมง|เวลาทำการ|เปิดไหม|ปิดไหม|เปิดวัน|กี่โมง.*(เปิด|ปิด)|opening/
// ข้อความอัตโนมัติมีหลายแบบให้สุ่มใช้ (ข้อเท็จจริงเหมือนกัน) · ถ้าร้านตั้งข้อความนอกเวลาเอง (offHours.text) จะใช้ข้อความนั้นเสมอ
const HOURS_VARIANTS = [
  'ร้านเปิด {เวลา} น. ค่ะ',
  'เปิด {เวลา} น. นะคะ',
  'ร้านเปิดให้บริการ {เวลา} น. ค่ะ',
  'เวลาเปิดร้านคือ {เวลา} น. ค่ะ',
  'เปิดทำการ {เวลา} น. นะคะ',
]
const OFF_VARIANTS = [
  'ขณะนี้ร้านปิดทำการ เปิด {เวลาเปิด}–{เวลาปิด} น. พนักงานจะตอบกลับเมื่อร้านเปิดนะคะ',
  'ตอนนี้ร้านปิดแล้วค่ะ เปิดใหม่ {เวลาเปิด} น. พนักงานจะตอบให้เมื่อร้านเปิดนะคะ',
  'ขออภัยค่ะ ร้านปิดแล้ว เวลาทำการ {เวลาเปิด}–{เวลาปิด} น. รบกวนทักมาใหม่ตอนร้านเปิดนะคะ',
  'ตอนนี้นอกเวลาทำการค่ะ ร้านเปิด {เวลาเปิด}–{เวลาปิด} น. พนักงานจะรีบตอบเมื่อเปิดนะคะ',
]
const pickOne = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]
// สุ่มข้อความจากแม่แบบ · เลือกไม่ให้ซ้ำกับข้อความบอทล่าสุดในแชท (ถ้ามีทางเลือกอื่น)
const pickFilled = (tpls: string[], vars: Record<string, string>, avoid?: string): string => {
  const all = tpls.map((t) => fill(t, vars))
  const pool = avoid ? all.filter((s) => s !== avoid) : all
  return pickOne(pool.length ? pool : all)
}
const MIN_DELAY_MS = 2000 // หน่วงก่อนตอบให้เหมือนพนักงานพิมพ์ (ไม่ตอบทันทีเกินไป)
const MAX_DELAY_MS = 5000

type Dec = { reply: string; source: string; handoff: boolean; reason: string; ruleId?: string }
export type BotInput = {
  sb: any
  token: string
  ver: string
  psid: string
  chatId: string
  mid: string
  text: string
  at: string // เวลาที่ลูกค้าส่ง (ISO)
}

const lc = (s: unknown) => String(s ?? '').toLowerCase().trim()
const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('')
const hm = (s: unknown) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0) }
// เวลาไทย (UTC+7) เป็นนาทีของวัน · เซิร์ฟเวอร์รันเป็น UTC จึงต้องชดเชยเอง
const bkkMinutes = (d: Date) => { const x = new Date(d.getTime() + 7 * 3600_000); return x.getUTCHours() * 60 + x.getUTCMinutes() }
const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((x, [k, v]) => x.split(`{${k}}`).join(v), s)
// เริ่มต้นวันทำการ (เที่ยงคืนเวลาไทย) ของเวลา d เป็น ms
const bkkDayStartMs = (d: Date) => { const x = new Date(d.getTime() + 7 * 3600_000); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) - 7 * 3600_000 }
// เวลาที่ช่วงปิดปัจจุบันเริ่ม (เวลาปิดร้านล่าสุดที่ผ่านมาแล้ว) · ใช้จำกัดให้ตอบนอกเวลาครั้งเดียวต่อช่วงปิด
export function offWindowStartMs(now: Date, shop: any): number {
  const closeMs = hm(shop.close) * 60_000
  const day = bkkDayStartMs(now)
  return bkkMinutes(now) >= hm(shop.close) ? day + closeMs : day - 86_400_000 + closeMs
}

// ความคล้ายแบบ Dice จาก bigram ตัวอักษร (ใช้ได้กับภาษาไทยที่ไม่มีเว้นวรรค) · ตรงกับฝั่งเบราว์เซอร์
function grams(s: string) {
  const t = lc(s).replace(/[\s\p{P}]+/gu, '')
  const g = new Map<string, number>()
  for (let i = 0; i < t.length - 1; i++) g.set(t.slice(i, i + 2), (g.get(t.slice(i, i + 2)) || 0) + 1)
  return { g, n: Math.max(0, t.length - 1) }
}
export function similarity(a: string, b: string): number {
  const x = grams(a), y = grams(b)
  if (!x.n || !y.n) return 0
  let hit = 0
  for (const [k, v] of x.g) hit += Math.min(v, y.g.get(k) || 0)
  return (2 * hit) / (x.n + y.n)
}

export function decide(text: string, bot: any, shop: any, storefront: any, at: Date, lastBot?: string): Dec {
  const t = lc(text)
  const handoff = (reason: string): Dec => ({ reply: '', source: 'handoff', handoff: true, reason })
  if (!t) return handoff('ข้อความว่าง')
  if (SENSITIVE.some((w) => t.includes(w))) return handoff('เรื่องเงิน/ร้องเรียน — ให้พนักงานตอบเสมอ')
  if (ORDER_RE.test(String(text))) return handoff('มีเลขออร์เดอร์ — ต้องให้พนักงานยืนยันตัวตนก่อน')

  // คำถามที่พบบ่อยที่ตรงชัด (ถ้าร้านตั้งไว้ในหน้าร้าน)
  let bestFaq: { sim: number; a: string; q: string } | null = null
  for (const f of Array.isArray(storefront?.faq) ? storefront.faq : []) {
    const sim = similarity(text, String(f?.q || ''))
    if (f?.a && (!bestFaq || sim > bestFaq.sim)) bestFaq = { sim, a: String(f.a), q: String(f.q || '') }
  }
  if (bestFaq && bestFaq.sim >= 0.6) return { reply: bestFaq.a, source: 'faq', handoff: false, reason: `คล้ายคำถามที่พบบ่อย "${bestFaq.q}"` }

  // กฎคีย์เวิร์ดที่ตั้งเอง
  for (const r of Array.isArray(bot.rules) ? bot.rules : []) {
    if (r?.active === false || !r?.reply) continue
    const kw = (Array.isArray(r.keywords) ? r.keywords : []).map(lc).filter(Boolean).find((k: string) => t.includes(k))
    if (kw) return { reply: String(r.reply), source: 'rule', handoff: false, reason: `ตรงกฎ "${r.name ?? ''}" (คำว่า ${kw})`, ruleId: String(r.id ?? '') }
  }

  // เวลาเปิด-ปิด: ถ้าร้านมีวันปิดพิเศษ/ปิดเป็นรายสัปดาห์ ไม่ตอบเอง (ให้พนักงานตรวจ)
  const c = shop?.closures || {}
  const hasClosures = (c.hours?.length || 0) + (c.ranges?.length || 0) + (c.weekly?.length || 0) > 0
  if (HOURS_RE.test(t)) {
    if (hasClosures) return handoff('ถามเวลาเปิด แต่ร้านมีวันปิดพิเศษ — ให้พนักงานตอบ')
    return { reply: pickFilled(HOURS_VARIANTS, { เวลา: `${shop.open}–${shop.close}` }, lastBot), source: 'hours', handoff: false, reason: 'ถามเวลาเปิด-ปิด' }
  }

  // นอกเวลาทำการ
  const offOn = bot.offHours?.enabled !== false
  const cur = bkkMinutes(at)
  if (offOn && (cur < hm(shop.open) || cur >= hm(shop.close))) {
    if (hasClosures) return handoff('นอกเวลาและร้านมีวันปิดพิเศษ — ให้พนักงานตอบ')
    const vars = { เวลาเปิด: String(shop.open), เวลาปิด: String(shop.close) }
    const reply = bot.offHours?.text ? fill(String(bot.offHours.text), vars) : pickFilled(OFF_VARIANTS, vars, lastBot)
    return { reply, source: 'offhours', handoff: false, reason: 'นอกเวลาทำการ' }
  }
  return handoff('ต้องให้พนักงานตอบ (ราคา/สั่งทำ/ข้อมูลที่ไม่รู้)')
}

// ผู้ช่วย: อ่านค่า config จาก punpang_kv (อ่านอย่างเดียว)
async function loadConfig(sb: any) {
  const [cfg, sf] = await Promise.all([
    sb.from('punpang_kv').select('id,data').eq('collection', 'config').in('id', ['bot', 'shop']),
    sb.from('punpang_kv').select('data').eq('collection', 'storefront').eq('id', 'storefront').maybeSingle(),
  ])
  const map: Record<string, any> = {}
  for (const r of cfg.data || []) map[r.id] = r.data?.v
  return { bot: map.bot, shop: map.shop, storefront: sf.data?.data?.v ?? null }
}

// เขียนลงแชทแบบเปรียบเทียบ updated_at (CAS) · คืน true เมื่อบันทึกได้
async function appendToChat(sb: any, chatId: string, fn: (d: any, msgs: any[]) => any | null): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chatId).maybeSingle()
    if (cur.error || !cur.data) return false
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    const next = fn(d, msgs)
    if (!next) return true // ไม่ต้องเขียนแล้ว (เช่น ข้อความนี้ถูกจัดการไปแล้ว)
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (up.error) return false
    if (up.data?.length) return true
  }
  return false
}

// จุดเข้า: ตัดสินและทำงานของบอทสำหรับข้อความลูกค้าหนึ่งข้อความ · ล้มเหลวได้โดยไม่กระทบการรับข้อความ
export async function runFbBot(o: BotInput): Promise<void> {
  const { bot, shop, storefront } = await loadConfig(o.sb)
  if (!bot || bot.enabled !== true || bot.mode === 'off' || bot.channels?.facebook !== true) return
  if (!shop?.open || !shop?.close) return
  const at = new Date(o.at)
  if (!(Date.now() - at.getTime() <= STALE_MS)) return

  const cr = await o.sb.from('punpang_chats').select('data').eq('id', o.chatId).maybeSingle()
  if (cr.error || !cr.data) return
  const d0 = cr.data.data || {}
  if (d0.botOff) return // ปิดบอทในแชทนี้
  const msgs0: any[] = Array.isArray(d0.messages) ? d0.messages : []
  if (msgs0.some((x) => x?.botFor === o.mid)) return // ตอบข้อความนี้ไปแล้ว
  const idx = msgs0.findIndex((x) => x?.fbMid === o.mid)
  if (idx < 0) return
  if (msgs0.slice(idx + 1).some((x) => x?.from === 'staff')) return // พนักงานตอบไปแล้ว ไม่แทรก

  // ข้อความบอทล่าสุดในแชท (ใช้กันการตอบซ้ำแบบเดิมติดกัน)
  const lastBot = [...msgs0].reverse().find((x) => x?.by === 'บอท' && typeof x?.text === 'string')?.text as string | undefined
  const dec = decide(o.text, bot, shop, storefront, at, lastBot)
  const mode = bot.sourceModes?.[dec.source] || bot.mode || 'suggest'
  const autoOk = !dec.handoff && !LOCKED.includes(dec.source) && mode === 'auto'

  if (!autoOk) {
    // ส่งต่อ: ทำเครื่องหมายแชทพร้อมเหตุผล (ไม่ส่งข้อความถึงลูกค้า · กระดิ่งของข้อความใหม่แจ้งไปแล้วที่ fb-webhook)
    await appendToChat(o.sb, o.chatId, (d, msgs) => {
      if (msgs.some((x) => x?.botFor === o.mid)) return null
      return { ...d, botHandoff: true, botHandoffReason: dec.reason, updatedAt: new Date().toISOString() }
    })
    return
  }

  // นอกเวลาทำการ: ตอบครั้งเดียวต่อช่วงปิด (ลูกค้าที่ทักหลายข้อความตอนร้านปิดจะไม่ได้คำตอบซ้ำ)
  if (dec.source === 'offhours') {
    const start = offWindowStartMs(at, shop)
    if (msgs0.some((x) => x?.by === 'บอท' && x?.botSource === 'offhours' && new Date(x.at).getTime() >= start)) return
  }

  // จองสิทธิ์ตอบก่อนหน่วงเวลา: ถ้า Meta ส่งข้อความเดิมซ้ำระหว่างรอ ครั้งหลังจะไม่ตอบซ้ำ
  let claimed = false
  let dup = false
  for (let i = 0; i < 4 && !claimed && !dup; i++) {
    const cur = await o.sb.from('punpang_chats').select('id,data,updated_at').eq('id', o.chatId).maybeSingle()
    if (cur.error || !cur.data) return
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    if (d.botOff || msgs.some((x) => x?.botFor === o.mid) || d.botClaim === o.mid) { dup = true; break }
    if (!msgs.some((x) => x?.fbMid === o.mid)) return
    const up = await o.sb.from('punpang_chats').update({ data: { ...d, botClaim: o.mid } }).eq('id', o.chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (up.error) return
    if (up.data?.length) claimed = true
  }
  if (!claimed) return

  // ตอบเอง: หน่วงเวลาสั้น ๆ ก่อนส่ง แล้วส่งทาง Graph API (ลูกค้าเพิ่งทักจึงอยู่ในหน้าต่าง 24 ชม.)
  await new Promise((r) => setTimeout(r, MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)))

  // ตรวจอีกครั้งหลังหน่วง: ถ้าพนักงานตอบไปแล้ว หรือปิดบอทในระหว่างนั้น → ไม่ส่ง และคืนสิทธิ์จอง
  const after = await o.sb.from('punpang_chats').select('data').eq('id', o.chatId).maybeSingle()
  const ad = after.data?.data || {}
  const am: any[] = Array.isArray(ad.messages) ? ad.messages : []
  const ai = am.findIndex((x) => x?.fbMid === o.mid)
  const staffReplied = ai >= 0 && am.slice(ai + 1).some((x) => x?.from === 'staff')
  if (after.error || !after.data || staffReplied || ad.botOff) {
    if (!after.error) {
      await appendToChat(o.sb, o.chatId, (d) => (d.botClaim === o.mid ? { ...d, botClaim: null } : null))
    }
    return
  }

  let sent = false
  try {
    const r = await fetch(`${GRAPH}/${o.ver}/me/messages?${new URLSearchParams({ access_token: o.token })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: o.psid }, messaging_type: 'RESPONSE', message: { text: dec.reply } }),
      signal: AbortSignal.timeout(10000),
    })
    sent = r.ok
  } catch { sent = false }

  const nowIso = new Date().toISOString()
  const bm = {
    id: `cm${rand(6)}`, from: 'staff', kind: 'text', text: dec.reply,
    orderId: null, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null,
    at: nowIso, by: 'บอท', delivery: sent ? 'sent' : 'failed', ...(sent ? {} : { deliveryError: 'ส่งตอบลูกค้าไม่สำเร็จ' }),
    botFor: o.mid, botSource: dec.source,
  }
  await appendToChat(o.sb, o.chatId, (d, msgs) => {
    if (msgs.some((x) => x?.botFor === o.mid)) return null
    return { ...d, messages: [...msgs, bm], botHandoff: false, botHandoffReason: null, botClaim: null, updatedAt: nowIso } // บอทตอบแล้ว → ล้างธงส่งต่อและสิทธิ์จอง
  })
}
