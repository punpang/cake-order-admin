// บอทตอบแชท (กฎคีย์เวิร์ดไทย + คำตอบที่เรียนรู้จากพนักงาน) · ฟังก์ชันล้วน ประมวลผลในเบราว์เซอร์ ไม่ส่งข้อความลูกค้าออกนอก
// ลำดับ: ห้ามตอบ(เงิน/ร้องเรียน) → เลขออร์เดอร์ → ขอข้อมูลที่ขาด → กฎ → เวลาเปิด/ราคา/FAQ → ที่เรียนรู้ → นอกเวลา → ส่งต่อ
import { STATUS } from './constants'
import { orderTotals } from './pricing'
import { money, dateOnly, timeOnly, phoneValid } from './format'
import { extractIntent, scoreProducts } from './chatIntent'

export const BOT_DEFAULTS = {
  enabled: false, // ค่าเริ่มต้นปิดทุกช่องทาง
  channels: { line: false, facebook: false },
  mode: 'suggest', // ค่าสำรองสำหรับประเภทที่ไม่ได้ตั้งเองใน sourceModes · suggest = แนะนำให้พนักงานกดส่ง · auto = ส่งเอง
  // ตั้งรายประเภทได้: auto = ส่งเอง · suggest = แนะนำให้พนักงานกดส่ง (ประเภทในรายการ LOCKED ส่งเองไม่ได้เสมอ)
  sourceModes: { hours: 'auto', faq: 'auto', offhours: 'auto', order: 'auto', rule: 'suggest', price: 'suggest', learned: 'suggest', ask: 'suggest' },
  confidence: 0.6,
  delaySec: 3,
  offHours: { enabled: true, text: 'ขณะนี้ร้านปิดทำการ เปิด {เวลาเปิด}–{เวลาปิด} น. พนักงานจะตอบกลับเมื่อร้านเปิดนะคะ' },
  // แจ้งร้านปิดเมื่อลูกค้าทักครั้งแรกของวัน (ตามวัน-เวลาปิดร้าน) แล้วตอบต่อตามปกติ · ตัวแปร {เหตุผล} {เปิดอีกครั้ง}
  closedNotice: { enabled: true, text: 'ขณะนี้ร้านปิด ({เหตุผล}) เปิดอีกครั้ง {เปิดอีกครั้ง} · ยังคุยและสั่งของวัน-เวลาที่ร้านเปิดได้ตามปกตินะคะ' },
  handoff: { notifyTelegram: true, text: 'ขอส่งต่อให้พนักงานช่วยดูแลต่อนะคะ รอสักครู่ค่ะ' },
  // บอท AI (ทำงานบนเซิร์ฟเวอร์ ช่อง Facebook เท่านั้น) · ปิดเป็นค่าเริ่มต้น · เรียกเฉพาะเมื่อกฎเดิมตอบไม่ได้ · ไม่ส่งข้อมูลออร์เดอร์/ลูกค้า
  // mode: suggest = ร่างให้พนักงานกดส่ง (ค่าเริ่มต้น) · auto = ส่งเอง · dailyLimit = จำนวนครั้งที่เรียกโมเดลต่อวัน (0 = ไม่เรียกเลย)
  ai: { enabled: false, provider: 'anthropic', model: 'claude-sonnet-5-5', mode: 'suggest', dailyLimit: 50, maxTokens: 400 },
  rules: [],
  learned: [],
  stats: { suggested: 0, answered: 0, handoff: 0, staffEdited: 0 },
}
// โมเดลของบอท AI ที่เลือกได้ในหน้าตั้งค่า (ชื่อต้องตรงกับที่ Anthropic ใช้)
export const AI_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']
export const LEARN_MAX = 200
// ประเภทคำตอบที่ตั้ง ตอบเอง/แนะนำ ได้รายประเภท
export const AUTO_SOURCES = ['hours', 'faq', 'offhours', 'order', 'rule', 'price', 'learned', 'ask']
// ประเภทที่ต้องให้พนักงานตอบเสมอ (ส่งเองไม่ได้ ไม่ว่าตั้งค่าอะไร)
export const LOCKED_SOURCES = ['handoff', 'order_unverified']

const lc = (s) => String(s ?? '').toLowerCase().trim()
const SENSITIVE = ['คืนเงิน', 'เงินคืน', 'ขอเงินคืน', 'ร้องเรียน', 'โกง', 'หลอก', 'ไม่พอใจ', 'แย่มาก', 'เสียหาย', 'เสียใจ', 'ฟ้อง', 'โอนผิด', 'โอนซ้ำ', 'เรียกเงิน', 'ชดเชย', 'ผู้บริโภค', 'refund', 'complain', 'ค่าเสียหาย', 'ทวงเงิน']
export const isSensitive = (t) => SENSITIVE.some((w) => lc(t).includes(w))

// ความคล้าย (Dice จาก bigram ตัวอักษร) — ใช้ได้กับภาษาไทยที่ไม่มีเว้นวรรค
const grams = (s) => {
  const t = lc(s).replace(/[\s\p{P}]+/gu, '')
  const g = new Map()
  for (let i = 0; i < t.length - 1; i++) g.set(t.slice(i, i + 2), (g.get(t.slice(i, i + 2)) || 0) + 1)
  return { g, n: Math.max(0, t.length - 1) }
}
export function similarity(a, b) {
  const x = grams(a)
  const y = grams(b)
  if (!x.n || !y.n) return 0
  let hit = 0
  for (const [k, v] of x.g) hit += Math.min(v, y.g.get(k) || 0)
  return (2 * hit) / (x.n + y.n)
}

// ตัดข้อมูลส่วนบุคคลก่อนจดจำ: เบอร์ อีเมล เลขออร์เดอร์ เลขยาว ชื่อ
export function scrubPII(text, names = []) {
  let t = String(text ?? '')
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '{อีเมล}')
  t = t.replace(/\bOR-(?:\d{6}-)?\d+\b/gi, '{เลขออร์เดอร์}')
  t = t.replace(/(?:\+?66|0)[\d\s-]{8,12}\d/g, '{เบอร์}')
  t = t.replace(/\d[\d\s-]{7,}\d/g, '{เลข}')
  for (const n of names.map((x) => String(x || '').trim()).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)) t = t.split(n).join('{ชื่อ}')
  return t.trim()
}
const hasPlaceholder = (s) => /\{[^}]+\}/.test(s)

const hm = (s) => {
  const [h, m] = String(s || '0:0').split(':').map(Number)
  return h * 60 + (m || 0)
}
export function isOffHours(shop, at = new Date()) {
  const cur = at.getHours() * 60 + at.getMinutes()
  return cur < hm(shop.open) || cur >= hm(shop.close)
}
const fill = (s, vars) => Object.entries(vars).reduce((x, [k, v]) => x.split(`{${k}}`).join(v), s)

// สถานะออร์เดอร์ (เฉพาะเมื่อแชทผูกลูกค้า และออร์เดอร์เป็นของลูกค้านั้น)
function orderStatusText(o) {
  const t = orderTotals(o)
  const st = STATUS[o.status]?.label || o.status
  const bits = [`ออร์เดอร์ ${o.code} สถานะ: ${st}`]
  if (o.status !== 'cancelled') {
    bits.push(`นัด${o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับ'} ${dateOnly(o.pickupAt)} ${timeOnly(o.pickupAt)} น.`)
    bits.push(t.balance > 0 ? `ยอดคงค้าง ${money(t.balance)}` : 'ชำระครบแล้ว')
  }
  return bits.join(' · ')
}

function faqBest(db, text) {
  let best = null
  for (const f of db.storefront.faq || []) {
    const sim = similarity(text, f.q)
    if (!best || sim > best.sim) best = { sim, f }
  }
  return best
}
const faqReply = (b) => ({ reply: b.f.a, source: 'faq', confidence: Math.min(0.95, 0.5 + b.sim / 2), handoff: false, reason: `คล้ายคำถามที่พบบ่อย "${b.f.q}" (${Math.round(b.sim * 100)}%)` })

// ctx: { db, chat, now?: Date, draft?: object }
// คืน { reply, source, confidence, handoff, reason, askField? }
export function botReply(text, ctx) {
  const { db, chat } = ctx
  const at = ctx.now || new Date()
  const t = lc(text)
  const vars = { เวลาเปิด: db.shop.open, เวลาปิด: db.shop.close }
  const handoff = (reason) => ({ reply: db.bot.handoff.text, source: 'handoff', confidence: 0, handoff: true, reason })
  if (!t) return handoff('ข้อความว่าง')
  if (isSensitive(t)) return handoff('เรื่องเงิน/ร้องเรียน — ให้พนักงานตอบเสมอ')

  // 1) เลขออร์เดอร์
  const code = String(text).match(/\bOR-\d{6}-\d{6}\b|\bOR-\d{3,}\b/i)
  if (code) {
    const o = db.orders.find((x) => x.code.toLowerCase() === code[0].toLowerCase())
    if (o && chat.customerId && o.customerId === chat.customerId) return { reply: orderStatusText(o), source: 'order', confidence: 1, handoff: false, reason: `เลขออร์เดอร์ ${o.code} (แชทผูกลูกค้าและออร์เดอร์เป็นของลูกค้าคนนี้)` }
    // ไม่ผูก / ไม่ใช่ของลูกค้า / ไม่พบ → ตอบเหมือนกันหมด ไม่เปิดเผยว่ามีออร์เดอร์นี้หรือไม่
    return { reply: 'ขอให้พนักงานช่วยยืนยันข้อมูลออร์เดอร์ให้นะคะ รอสักครู่ค่ะ', source: 'order_unverified', confidence: 1, handoff: true, reason: 'พบเลขออร์เดอร์แต่ยืนยันตัวตนไม่ได้ — ไม่เปิดเผยสถานะ' }
  }

  const intent = extractIntent(text, at)

  // 1.5) คำถามที่พบบ่อยที่ตรงชัด ๆ ตอบก่อน (กันคำถามขึ้นต้น "สั่ง..." ถูกมองว่าเป็นการสั่งซื้อ)
  const strong = faqBest(db, text)
  if (strong && strong.sim >= 0.6) return faqReply(strong)

  // 2) ขอข้อมูลที่ขาด (ข้อความที่ดูเหมือนจะสั่ง)
  const priceQ = /ราคา|เท่าไหร่|เท่าไร|กี่บาท/.test(t)
  const wantsOrder = !priceQ && (/สั่ง|อยากได้|ต้องการ|จอง|รับเค้ก/.test(t) || (!intent.empty && intent.mode))
  if (wantsOrder) {
    const cu = chat.customerId ? db.customers.find((c) => c.id === chat.customerId) : null
    const hasPhone = (cu && phoneValid(cu.phone)) || !!ctx.draft?.contactPhone
    if (!hasPhone) return { reply: 'ได้เลยค่ะ รบกวนขอเบอร์โทรติดต่อด้วยค่ะ', source: 'ask', confidence: 0.8, handoff: false, askField: 'phone', reason: 'ต้องการสั่ง แต่ยังไม่มีเบอร์โทร' }
    if (!intent.date && !ctx.draft?.time) return { reply: 'ต้องการรับเค้กวันไหน เวลากี่โมงคะ', source: 'ask', confidence: 0.8, handoff: false, askField: 'datetime', reason: 'ต้องการสั่ง แต่ยังไม่มีวัน/เวลานัด' }
  }

  // 3) กฎที่ตั้งเอง
  for (const r of db.bot.rules) {
    if (r.active === false) continue
    const kw = (r.keywords || []).map(lc).filter(Boolean).find((k) => t.includes(k))
    if (kw) return { reply: r.reply, source: 'rule', confidence: 0.9, handoff: false, reason: `ตรงกฎ "${r.name}" (คำว่า ${kw})`, ruleId: r.id }
  }

  // 4) เวลาเปิด
  if (/เปิดกี่โมง|ปิดกี่โมง|เวลาทำการ|เปิดไหม|ปิดไหม|เปิดวัน|กี่โมง.*(เปิด|ปิด)|opening/.test(t)) {
    const hours = (db.storefront.hours || []).map((h) => `${h.days} ${h.time}`).join(' · ')
    return { reply: `ร้านเปิด ${hours || `${db.shop.open}–${db.shop.close} น.`} ค่ะ`, source: 'hours', confidence: 0.9, handoff: false, reason: 'ถามเวลาเปิด-ปิด' }
  }
  // 5) ราคา / แนะนำสินค้า
  if (/ราคา|เท่าไหร่|เท่าไร|กี่บาท/.test(t) || (!intent.empty && (intent.flavors.length || intent.budget || intent.pounds))) {
    const top = scoreProducts(intent, db, 3)
    if (top.length) {
      const lines = top.map((p) => `• ${p.name} ${p.kind === 'custom' && p.from ? 'เริ่มต้น ' : ''}${money(p.price)}`)
      return { reply: `มีรายการแนะนำค่ะ\n${lines.join('\n')}\nสนใจแบบไหนบอกได้เลยนะคะ`, source: 'price', confidence: 0.75, handoff: false, reason: `จับความต้องการ: ${top[0].reasons.join(' · ')}` }
    }
  }
  // 6) FAQ หน้าร้าน (คล้ายพอสมควร)
  if (strong && strong.sim >= 0.4) return faqReply(strong)

  // 7) คำตอบที่เรียนรู้
  let L = null
  for (const l of db.bot.learned) {
    if (hasPlaceholder(l.a) && /\{(เบอร์|เลข|เลขออร์เดอร์|อีเมล)\}/.test(l.a)) continue // คำตอบที่มีข้อมูลเฉพาะบุคคลห้ามใช้ซ้ำ
    const sim = similarity(text, l.q)
    if (!L || sim > L.sim) L = { sim, l }
  }
  if (L && L.sim >= 0.5) {
    const ans = L.l.a.split('{ชื่อ}').join(chat.profileName || 'ลูกค้า')
    return { reply: ans, source: 'learned', confidence: Math.min(0.9, L.sim), handoff: false, reason: `คล้ายคำตอบที่พนักงานเคยตอบ (${Math.round(L.sim * 100)}%)`, learnedId: L.l.id }
  }

  // 8) นอกเวลาทำการ / ส่งต่อ
  if (db.bot.offHours.enabled && isOffHours(db.shop, at)) return { reply: fill(db.bot.offHours.text, vars), source: 'offhours', confidence: 1, handoff: false, reason: 'นอกเวลาทำการ' }
  return handoff('ไม่แน่ใจคำตอบ')
}
