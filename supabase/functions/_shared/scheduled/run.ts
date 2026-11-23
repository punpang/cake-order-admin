// ส่งข้อความตามแผนงานตามเวลา (ฝั่ง IO) — เขียนผลลง punpang_records (outbox, bell, notifySent, orderLinks) และแชท (punpang_chats) เหมือนที่แอปทำ
import { gwFetch } from '../gwfetch.ts'
// ช่องทาง: Facebook (Graph API ภายใน 24 ชม. หลังลูกค้าทัก) · SMS (เกตเวย์ของร้าน)
// เปลี่ยนจากแอปตรงที่หาแชท Facebook ด้วยรหัส PSID ได้ด้วย (ไม่ต้องผูก customer_id ไว้ก่อน)
import { inFbWindow } from '../slipnotice.ts'
import { webChatFor } from '../webchat.ts'
import { genToken, hashToken } from '../schedlib/orderLink.js'
import { formatPhone } from '../schedlib/format.js'
import { marketingAllowed } from '../schedlib/promoConsent.js'
import { LOYALTY_EVENTS, smsAllowed } from '../schedlib/memberNotify.js'
import {
  BELL_CUSTOMER, BELL_STAFF, CHANNELS, CUSTOMER_CHANNEL_ORDER, NOTIFY_EVENTS, bellText, customerAddr, customerTargets, effectiveChannels, escapeHtml, escapeVars, plainText, renderFor, type Plan,
} from './plan.ts'

// deno-lint-ignore no-explicit-any
type Any = any
// ตารางจาก JS ไม่มีชนิดชัด → alias ที่รับคีย์เป็นสตริงได้
const EV: Any = NOTIFY_EVENTS
const BCUST: Any = BELL_CUSTOMER
const BSTAFF: Any = BELL_STAFF
const CHN: Any = CHANNELS
const targetsOf: Any = customerTargets

export type Ctx = {
  sb: Any
  nowMs: number
  rules: Any[]
  integrations: Any
  chats: Any[] // แชท facebook ทั้งหมด (โหลดครั้งเดียวต่อรอบ)
  fb: { token: string; version: string } | null
  gw: { url: string; key: string } | null // เกตเวย์ SMS (ไม่มี = ยังไม่ได้ตั้งค่า)
  tg: { token: string; chat: string } | null // Telegram (ไม่มี = ยังไม่ได้ตั้งค่า)
  siteUrl: string
}

const rand = (n = 12): string => {
  const a = new Uint8Array(Math.ceil(n / 2))
  crypto.getRandomValues(a)
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, n)
}
const iso = (ms: number) => new Date(ms).toISOString()

async function putRecord(ctx: Ctx, collection: string, id: string, data: Any): Promise<boolean> {
  const r = await ctx.sb.from('punpang_records').insert({ collection, id, data })
  return !r.error
}

async function bellPush(ctx: Ctx, item: Any): Promise<void> {
  await putRecord(ctx, 'bell', `bl${rand()}`, item)
}
// แจ้งพนักงานว่าส่งไม่สำเร็จ (เหมือน notify_failed ในแอป)
async function bellFail(ctx: Ctx, text: string, chatId: string | null): Promise<void> {
  await bellPush(ctx, { audience: 'staff', event: 'notify_failed', title: BELL_STAFF.notify_failed.title, text, chatId, orderId: null, readBy: [], at: iso(ctx.nowMs) })
}

// กระดิ่งของเหตุการณ์ (เหมือน emitBell ในแอป): ลูกค้า (ถ้าไม่ปิดการตลาด) หรือทีม
async function emitBell(ctx: Ctx, plan: Plan): Promise<void> {
  const ev = EV[plan.event]
  if (!ev) return
  if (ev.audience === 'team') {
    const d = BSTAFF[plan.event]
    if (!d) return
    await bellPush(ctx, { audience: 'staff', event: plan.event, title: d.title, text: bellText(plan.event, plan.vars), orderId: plan.orderId, readBy: [], at: iso(ctx.nowMs) })
    return
  }
  const d = BCUST[plan.event]
  const c = plan.customer
  if (!d || !c || c.deleted) return
  if (d.marketing && !marketingAllowed(c)) return
  await bellPush(ctx, { audience: 'customer', customerId: c.id, event: plan.event, title: d.title, text: bellText(plan.event, plan.vars), orderId: plan.orderId, read: false, at: iso(ctx.nowMs) })
}

// ลิงก์ดูออร์เดอร์ (เหมือน createOrderLink ในแอป): เก็บเฉพาะ hash ของโทเค็น
async function orderLinkUrl(ctx: Ctx, order: Any): Promise<string> {
  if (!order || order.status === 'draft' || order.channel === 'pos') return ''
  const token = genToken()
  await putRecord(ctx, 'orderLinks', `ol${rand()}`, { orderId: order.id, tokenHash: hashToken(token), createdAt: iso(ctx.nowMs), lastOpenedAt: null, openCount: 0, revokedAt: null })
  return `${ctx.siteUrl}/#/o/${token}`
}

// แชทของลูกค้าในช่องทางนั้น: ผูก customer_id ก่อน · ไม่ได้ผูก → หาด้วยรหัส PSID
function findChat(ctx: Ctx, customer: Any, channel: string): Any | null {
  const byCustomer = ctx.chats.find((c) => c.channel === channel && c.customer_id === customer.id)
  if (byCustomer) return byCustomer
  if (channel === 'facebook' && customer.fbPsid) return ctx.chats.find((c) => c.channel === 'facebook' && String(c.external_id) === String(customer.fbPsid)) ?? null
  return null
}

type StaffMsg = { id: string; from: 'staff'; kind: 'text' | 'card'; text: string; orderId: string | null; quoteId: null; replyTo: null; ask: null; answerFor: null; filled: null; at: string; by: string; delivery: string; deliveryError?: string; card?: Any; cardText?: string }
function staffMsg(ctx: Ctx, text: string, orderId: string | null, delivery: string): StaffMsg {
  return { id: `cm${rand()}`, from: 'staff', kind: 'text', text, orderId, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, at: iso(ctx.nowMs), by: 'ระบบ', delivery }
}
// ต่อข้อความลงแชท (เทียบ updated_at กันชนกับแอปและ webhook)
async function appendChat(ctx: Ctx, chatId: string, msg: StaffMsg): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const cur = await ctx.sb.from('punpang_chats').select('id,data,updated_at').eq('id', chatId).maybeSingle()
    if (cur.error || !cur.data) return
    const d = cur.data.data || {}
    const msgs: Any[] = Array.isArray(d.messages) ? d.messages : []
    const up = await ctx.sb.from('punpang_chats').update({ data: { ...d, messages: [...msgs, msg], updatedAt: msg.at } }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (!up.error && (up.data || []).length) return
  }
}

async function sendFb(ctx: Ctx, psid: string, text: string, url?: string): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.fb) return { ok: false, error: 'ยังไม่ได้เชื่อม Facebook Page' }
  // มีลิงก์ดูออร์เดอร์ → ปุ่มด้านล่างของข้อความ (button template · ข้อความไม่เกิน 640 ตัวอักษร)
  const message = url
    ? { attachment: { type: 'template', payload: { template_type: 'button', text: text.slice(0, 640), buttons: [{ type: 'web_url', url, title: 'ดูออร์เดอร์' }] } } }
    : { text }
  try {
    const r = await fetch(`https://graph.facebook.com/${ctx.fb.version}/me/messages?${new URLSearchParams({ access_token: ctx.fb.token })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message }),
      signal: AbortSignal.timeout(15000),
    })
    if (r.ok) return { ok: true }
    const j = await r.json().catch(() => null)
    return { ok: false, error: String(j?.error?.message || `Facebook ตอบ ${r.status}`).slice(0, 200) }
  } catch {
    return { ok: false, error: 'เชื่อมต่อ Facebook ไม่ได้' }
  }
}

// เบอร์: เหมือน normalizeNumber ใน sms-send (0xxxxxxxxx · 66xxxxxxxxx · 0066xxxxxxxxx)
function normalizeNumber(s: unknown): string | null {
  let d = String(s ?? '').replace(/\D/g, '')
  if (/^0066\d{8,9}$/.test(d)) d = `0${d.slice(4)}`
  else if (/^66\d{8,9}$/.test(d)) d = `0${d.slice(2)}`
  return /^0\d{8,9}$/.test(d) ? d : null
}
const SMS_MAX_TEXT = 350 // เพดานของเกตเวย์ (5 ฉบับ) ตรงกับ sms-send

async function sendSms(ctx: Ctx, number: string, text: string, idem: string): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.gw) return { ok: false, error: 'ยังไม่ได้ตั้งค่าเกตเวย์ SMS ของร้าน' }
  const to = normalizeNumber(number)
  if (!to) return { ok: false, error: 'เบอร์โทรไม่ถูกต้อง' }
  if (text.length > SMS_MAX_TEXT) return { ok: false, error: `ข้อความยาวเกิน ${SMS_MAX_TEXT} ตัวอักษร` }
  try {
    const r = await gwFetch(`${ctx.gw.url}/v1/sms`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.gw.key}`, 'content-type': 'application/json', 'idempotency-key': idem },
      body: JSON.stringify({ to, message: text }),
      signal: AbortSignal.timeout(10000),
    })
    return r.ok ? { ok: true } : { ok: false, error: `เกตเวย์ตอบ ${r.status}` }
  } catch {
    return { ok: false, error: 'เชื่อมต่อเกตเวย์ไม่ได้ (หมดเวลาหรือเครือข่ายขัดข้อง)' }
  }
}

async function sendTg(ctx: Ctx, text: string, parseMode: string): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.tg) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Telegram' }
  try {
    const r = await fetch(`https://api.telegram.org/bot${ctx.tg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ chat_id: ctx.tg.chat, text, disable_web_page_preview: true, ...(parseMode ? { parse_mode: parseMode } : {}) }),
      signal: AbortSignal.timeout(15000),
    })
    return r.ok ? { ok: true } : { ok: false, error: `http ${r.status}` }
  } catch {
    return { ok: false, error: 'เชื่อมต่อ Telegram ไม่ได้' }
  }
}

// กระทู้เว็บของลูกค้า: มีแล้วใช้เลย · มีบัญชีเว็บแต่ยังไม่มีกระทู้ → สร้างให้ (เหมือนแอปพนักงาน) · ไม่มีบัญชี = null
async function webChatOf(ctx: Ctx, customer: Any): Promise<{ id: string } | null> {
  return webChatFor(ctx.sb, String(customer.id), String(customer.name || ''), iso(ctx.nowMs))
}
type Out = { event: string; channel: string | null; to: string; text: string; orderId: string | null; customer: Any | null; parseMode?: string; url?: string; card?: Any; webChatId?: string }

// ส่งหนึ่งข้อความไปยังช่องทางหนึ่ง แล้วบันทึกคิวข้อความ (outbox) และแชท (ถ้ามี) — เหมือน pushOut ในแอป
async function pushOut(ctx: Ctx, m: Out): Promise<void> {
  const row: Any = { at: iso(ctx.nowMs), to: m.to, text: m.text, event: m.event, channel: m.channel, orderId: m.orderId, status: m.channel ? 'simulated' : 'no_channel' }
  const name = m.customer?.name || 'ลูกค้า'
  if (m.channel === 'facebook' && m.customer) {
    const chat = findChat(ctx, m.customer, m.channel)
    if (chat && m.channel === 'facebook') {
      const profile = chat.data?.profileName || name
      if (!inFbWindow(chat.data?.lastInboundAt, ctx.nowMs)) {
        const err = 'เกิน 24 ชั่วโมงหลังลูกค้าทักล่าสุด ส่งทาง Messenger ไม่ได้'
        row.status = 'failed'
        row.error = err
        await bellFail(ctx, `${profile}: ส่งทาง Facebook ไม่สำเร็จ (${err})`, chat.id)
        const msg = staffMsg(ctx, m.text, m.orderId, 'failed')
        msg.deliveryError = err
        await appendChat(ctx, chat.id, msg)
      } else {
        const r = await sendFb(ctx, String(chat.external_id), m.text, m.url)
        row.status = r.ok ? 'sent' : 'failed'
        if (!r.ok) row.error = r.error || ''
        if (!r.ok) await bellFail(ctx, `${profile}: ส่งทาง Facebook ไม่สำเร็จ${r.error ? ` (${r.error})` : ''}`, chat.id)
        const msg = staffMsg(ctx, m.text, m.orderId, r.ok ? 'sent' : 'failed')
        if (!r.ok) msg.deliveryError = r.error || ''
        await appendChat(ctx, chat.id, msg)
      }
    } else if (m.channel === 'facebook') {
      row.status = 'failed'
      row.error = 'ลูกค้ายังไม่มีแชท Facebook ที่ผูกไว้'
      await bellFail(ctx, `${name}: ยังไม่มีแชท Facebook ที่ผูกไว้ แจ้งทางอื่นเอง`, null)
    }
  }
  if (m.channel === 'web' && m.customer) {
    const chat = m.webChatId ? { id: m.webChatId } : await webChatOf(ctx, m.customer)
    if (!chat) {
      row.status = 'failed'
      row.error = 'ลูกค้ายังไม่มีแชทเว็บ'
    } else {
      const msg = staffMsg(ctx, m.text, m.orderId, 'sent')
      if (m.card) { msg.kind = 'card'; msg.card = m.card; msg.cardText = m.text }
      await appendChat(ctx, chat.id, msg)
      row.status = 'sent'
    }
  }
  if (m.channel === 'sms' && m.customer?.phone) {
    const idem = `ob${crypto.randomUUID().replace(/-/g, '')}`
    row.idem = idem
    const r = await sendSms(ctx, String(m.customer.phone), m.text, idem)
    row.status = r.ok ? 'sent' : 'failed'
    if (!r.ok) {
      row.error = r.error || ''
      await bellFail(ctx, `${name}: ส่ง SMS ไม่สำเร็จ${r.error ? ` (${r.error})` : ''}`, null)
    }
  }
  if (m.channel === 'telegram') {
    const r = await sendTg(ctx, m.text, m.parseMode || '')
    row.status = r.ok ? 'sent' : 'failed'
    if (!r.ok) row.error = r.error || ''
  }
  await putRecord(ctx, 'outbox', `msg${rand()}`, row)
}

// ทำตามแผนหนึ่งรายการ (เหมือน notify / notifyOrder ในแอป สำหรับเหตุการณ์ตามเวลา)
export async function execPlan(ctx: Ctx, plan: Plan): Promise<void> {
  await emitBell(ctx, plan)
  const rule = ctx.rules.find((r) => r.event === plan.event)
  const ev = EV[plan.event]
  if (!rule || !rule.enabled || !ev) return
  const order = plan.order
  const customer = plan.customer
  const orderMsg = ev.audience === 'customer' && !ev.marketing && !!order && order.channel !== 'pos'
  const url = plan.vars.ลิงก์ออร์เดอร์ || (orderMsg ? await orderLinkUrl(ctx, order) : '')

  if (ev.audience === 'team') {
    if (!rule.channels.includes('telegram') || !ctx.integrations?.telegram?.enabled) return
    const { text } = renderFor(rule, 'telegram', escapeVars(plan.vars), escapeHtml(url))
    await pushOut(ctx, { event: plan.event, channel: 'telegram', to: 'กลุ่มทีม', text, orderId: plan.orderId, customer: null, parseMode: 'HTML' })
    return
  }
  if (ev.marketing && customer && !marketingAllowed(customer)) return
  // ทุกออเดอร์: เว็บ/แอป (มีบัญชีหรือแชทเว็บ) → Facebook (ถ้าร้านเปิดไว้) → SMS · ตามกติกาของ event
  const allowed = effectiveChannels(rule, customer, order)
  const webChat = customer && allowed.web ? await webChatOf(ctx, customer) : null
  const targets: string[] = targetsOf({
    order: CUSTOMER_CHANNEL_ORDER,
    allowed,
    integrations: { ...ctx.integrations, web: { enabled: true } },
    addressOf: (k: string) => (k === 'web' ? (webChat ? String(customer.id) : '') : customerAddr(customer, k)),
    noSms: LOYALTY_EVENTS.includes(plan.event) && !smsAllowed(customer), // สิทธิ์สมาชิก: SMS ต้องยินยอมแยก
    marketing: !!ev.marketing,
  })
  if (!targets.length) {
    await pushOut(ctx, { event: plan.event, channel: null, to: customer?.name || '-', text: renderFor(rule, 'web', plan.vars, url).text, orderId: plan.orderId, customer })
    return
  }
  for (const ch of targets) {
    const to = `${ch === 'web' ? 'เว็บ/แอป' : CHN[ch].label}: ${customer?.name || ''}${ch === 'sms' ? ` (${formatPhone(customer.phone)})` : ''}`
    const main = renderFor(rule, ch, plan.vars, url)
    const text = ch === 'sms' || ch === 'facebook' ? plainText(main.text) : main.text
    await pushOut(ctx, { event: plan.event, channel: ch, to, text, orderId: plan.orderId, customer, ...(ch === 'web' && webChat ? { webChatId: webChat.id } : {}), ...(ch === 'facebook' && url ? { url } : {}), ...(ch === 'web' && url ? { card: { kind: 'link', title: 'ดูออร์เดอร์', subtitle: '', url } } : {}) })
  }
}

// รันทั้งแผน: จองคีย์กันส่งซ้ำก่อนทุกรายการ (เหมือนแอป) · รายการที่คีย์ซ้ำ (มีคนรันไปแล้ว) ข้าม
export async function runPlans(ctx: Ctx, plans: Plan[]): Promise<{ done: number; skipped: number; errors: string[] }> {
  let done = 0
  let skipped = 0
  const errors: string[] = []
  for (const p of plans) {
    const claimed = await putRecord(ctx, 'notifySent', p.key, {})
    if (!claimed) {
      skipped++
      continue
    }
    try {
      await execPlan(ctx, p)
      done++
    } catch (e) {
      errors.push(`${p.key}: ${String((e as Error)?.message || e)}`.slice(0, 300))
    }
  }
  return { done, skipped, errors }
}
