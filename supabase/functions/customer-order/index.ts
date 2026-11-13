import { filesEnv, svcDelete, svcUpload } from '../_shared/filesvc.ts'
import { newQrSuffix } from '../_shared/payqr.ts'
import { orderNo, refOfCode } from '../_shared/slipref.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { PAY_MSG, bankByCode, checkCustomerTxn, normalizeRef, refTaken } from '../_shared/payfields.ts'
import { autoConfirmOf, slipKeyOf } from '../_shared/slip.ts'
import { autoConfirmDecision, confirmSlipPayment } from '../_shared/slipautoconfirm.ts'
import { readSlipQr } from '../_shared/slipread.ts'
import { ocrFlagsOf, readSlipFields, readSlipFieldsWorkersAI, type OcrEngine } from '../_shared/slipocr.ts'
import { readSlipOnce } from '../_shared/slipstore.ts'
import { inFbWindow, renderSlipNotice, slipNoticeOn, slipNoticeTemplate } from '../_shared/slipnotice.ts'

// การกระทำของลูกค้าบนออร์เดอร์ (ฝั่งเซิร์ฟเวอร์): แจ้งชำระ(แนบสลิป) · ขอขยายเวลา · ขอ/ยกเลิกขอไม่เผยแพร่รูป
// ยืนยันตัวตนได้ 2 แบบ: ลิงก์ออร์เดอร์ (token 32 ตัวอักษร เก็บ hash ใน punpang_records) หรือเซสชันลูกค้า (+ orderId ที่เป็นของตัวเอง)
// ใช้ service role ฟังก์ชันนี้จึงต้องตรวจสิทธิ์/เงื่อนไขเองทุกอย่าง · เขียนออร์เดอร์แบบเทียบ updated_at (กันทับกับพนักงานที่แก้พร้อมกัน)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const DAY = 86400000
const enc = new TextEncoder()
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const randHex = (n = 8) => hex(crypto.getRandomValues(new Uint8Array(n)))
const days = (v: unknown, d: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 1 && x <= 365 ? x : d }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const NOT_FOUND = { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' }
const PAY = { perHour: 5, slipMaxBytes: 5 * 1024 * 1024, noteMax: 200 }

// จำกัดลองผิด/ยิงถี่ต่อ IP (ต่อ instance)
const hits = new Map<string, number[]>()
const limited = (ip: string, max: number, windowMs = 300000) => { const now = Date.now(); const a = (hits.get(ip) || []).filter((t) => now - t < windowMs); a.push(now); hits.set(ip, a); return a.length > max }

// ยอดรวม/ค้างชำระ — ต้องตรงกับ orderTotals ในแอป (src/lib/pricing.js): total = gross + VAT นอก · balance = total - ยืนยันชำระแล้ว
export function totals(o: any) {
  const items = o.items || []
  const subtotal = items.reduce((s: number, i: any) => s + (Number(i.unitPrice) || 0) * (Number(i.qty) || 0), 0)
  const shipFee = o.fulfillment === 'delivery' ? Number(o.shippingFee) || 0 : 0
  const shipping = shipFee - (o.shipPromo?.free ? shipFee : 0)
  const adjustment = Number(o.adjustment?.amount) || 0
  const pointsDiscount = Number(o.pointsUsed?.amount) || 0
  const couponDiscount = (o.couponsUsed || []).reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0)
  const gross = subtotal + shipping + adjustment - pointsDiscount - couponDiscount
  const rate = Number(o.vat?.rate) || 0
  const exclusive = rate > 0 && o.vat?.mode === 'exclusive'
  const vatAdd = exclusive ? r2((Math.max(gross, 0) * rate) / 100) : 0
  const total = gross + vatAdd
  const paid = (o.payments || []).filter((p: any) => p.status === 'confirmed').reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)
  return { total, paid, balance: total - paid }
}
// เวลาในข้อมูลเป็นเวลาท้องถิ่นไทยไม่มีโซน ("YYYY-MM-DDTHH:mm") → ตีความเป็น +07:00
const dueMs = (s: unknown) => { const v = String(s || ''); if (!v) return NaN; return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}${v.length === 16 ? ':00' : ''}+07:00`).getTime() }
export const isOverdue = (p: any, nowMs = Date.now()) => p?.status === 'reported' && !!p.dueAt && dueMs(p.dueAt) < nowMs
const ddmmyy = () => { const d = new Date(Date.now() + 7 * 3600000); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}${p(d.getUTCFullYear() % 100)}` }

// ตรวจชนิดไฟล์จากไบต์จริง (ไม่เชื่อ MIME ที่ลูกค้าส่งมา)
export function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'image/png', ext: 'png' }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: 'image/webp', ext: 'webp' }
  return null
}

// ถอดรูปสลิปจาก data URL แล้วตรวจชนิดจากไบต์จริง · คืน { bytes, type, ext } หรือ { error }
function decodeSlip(s: unknown): { bytes: Uint8Array; type: string; ext: string } | { error: string } {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(s ?? ''))
  if (!m) return { error: 'แนบสลิปเป็นรูปภาพ (PNG / JPG / WEBP)' }
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) } catch { return { error: 'ไฟล์สลิปไม่ถูกต้อง' } }
  if (bytes.length > PAY.slipMaxBytes) return { error: 'ไฟล์สลิปใหญ่เกินไป (ไม่เกิน 5 MB)' }
  const kind = sniffImage(bytes)
  if (!kind) return { error: 'ไฟล์สลิปไม่ใช่รูปภาพที่รองรับ (PNG / JPG / WEBP)' }
  return { bytes, type: kind.type, ext: kind.ext }
}

// ---------- แจ้งลูกค้าทาง Facebook เมื่อส่งสลิปผ่านหน้าออร์เดอร์/บัญชี (งานพื้นหลัง · ไม่ทำให้การส่งสลิปล้มเหลว) ----------
type SlipNotice = { orderCode: string; orderId: string; customerId: string; amount: number }
async function notifySlipFacebook(sb: any, n: SlipNotice): Promise<void> {
  const nowIso = () => new Date().toISOString()
  const bellFail = (reason: string) => sb.from('punpang_records').insert({ collection: 'bell', id: `bl${randHex(6)}`, data: { audience: 'staff', event: 'notify_failed', title: 'แจ้งลูกค้าไม่สำเร็จ', text: `${n.orderCode} · ${reason}`, orderId: n.orderId, readBy: [], at: nowIso() } })
  const cu = await sb.from('punpang_customers').select('name,data').eq('id', n.customerId).maybeSingle()
  const psid = String(cu.data?.data?.fbPsid || '')
  if (!/^\d{5,30}$/.test(psid)) return // ลูกค้ารายนี้ไม่ได้ผูก Facebook
  const kv = await sb.from('punpang_kv').select('id,data').eq('collection', 'config').in('id', ['notifyRules', 'integrations'])
  const cfg: { notifyRules?: any; integrations?: any } = {}
  for (const r of kv.data || []) {
    if (r.id === 'notifyRules') cfg.notifyRules = r.data?.v
    if (r.id === 'integrations') cfg.integrations = r.data?.v
  }
  if (!slipNoticeOn(cfg)) return
  const pg = await sb.from('punpang_fb_pages').select('token').limit(1).maybeSingle()
  if (!pg.data?.token) return
  const chat = await sb.from('punpang_chats').select('id,data,updated_at').eq('channel', 'facebook').eq('external_id', psid).maybeSingle()
  if (!chat.data) return
  if (!inFbWindow(chat.data.data?.lastInboundAt, Date.now())) { await bellFail('เกิน 24 ชม. หลังลูกค้าทัก Facebook ล่าสุด ส่งไม่ได้'); return }
  const text = renderSlipNotice(slipNoticeTemplate(cfg), { code: n.orderCode, amount: n.amount, name: String(cu.data?.name || '').trim() })
  const ver = (Deno.env.get('FB_GRAPH_VERSION') || 'v24.0').trim()
  let sent = false
  try {
    const r = await fetch(`https://graph.facebook.com/${ver}/me/messages?${new URLSearchParams({ access_token: pg.data.token })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } }), signal: AbortSignal.timeout(10000) })
    sent = r.ok
  } catch { sent = false }
  // บันทึกลงแชทเป็นข้อความของระบบ (พร้อมผลส่ง) · เขียนแบบเทียบ updated_at กันชนกับ webhook
  const sm = { id: `cm${randHex(6)}`, from: 'staff', kind: 'text', text, orderId: n.orderId, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, at: nowIso(), by: 'ระบบ', delivery: sent ? 'sent' : 'failed', ...(sent ? {} : { deliveryError: 'ส่ง Facebook ไม่สำเร็จ' }) }
  for (let i = 0; i < 4; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chat.data.id).maybeSingle()
    if (cur.error || !cur.data) break
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    const up = await sb.from('punpang_chats').update({ data: { ...d, messages: [...msgs, sm] } }).eq('id', chat.data.id).eq('updated_at', cur.data.updated_at).select('id')
    if (!up.error && (up.data || []).length) break
  }
  if (!sent) await bellFail('ส่ง Facebook ไม่สำเร็จ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (limited(ip, 40)) return json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' }, 429)
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // อ่านยอดและวัน-เวลาจากภาพสลิป (เหมือนสลิปในแชท) · เฉพาะเมื่อร้านเปิดไว้และมีคีย์ · อ่านไม่ได้ = null (ไม่บล็อกการส่ง)
  // อ่านภาพเพียงครั้งเดียวต่อเลขอ้างอิงสลิป: ผลที่โมเดลตอบแล้วจำไว้ตามเลขอ้างอิง (ตามการตั้งค่าผลอ่านสลิป) ตอนแนบ/ตอนส่งใช้ผลเดียวกัน ไม่เรียกโมเดลซ้ำ
  // เลขอ้างอิงของสลิปนี้ถูกใช้ในรายการชำระของออร์เดอร์ไหนแล้วหรือยัง (ไม่นับรายการที่ยกเลิก)
  const refUsed = async (ref: string) => {
    if (!ref) return false
    const seen = await sb.from('punpang_orders').select('id,data').contains('data', { payments: [{ ref }] })
    return (seen.data || []).some((r: any) => refTaken(r.data?.payments, ref))
  }
  // ลำดับเดียวกับสลิปในแชท: เรียกเฉพาะเมื่อ QR เป็นสลิปธนาคารแล้ว · Workers AI → ระบบเดิม (Claude) · ตัวที่เปิดไว้และตั้งค่าครบจึงลอง · ใช้ค่าที่เคยอ่านของเลขอ้างอิงนี้ก่อน (ประหยัด) · อ่านไม่ผ่านเก็บรูปไว้ชุดเทรน
  const slipFieldsOf = async (bytes: Uint8Array, qr: { bankCode: string; ref: string }) => {
    const flags = ocrFlagsOf((await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'slipQr').maybeSingle()).data?.data?.v?.ocr)
    const engines: OcrEngine[] = []
    const cfId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID') || ''
    const cfTok = Deno.env.get('CLOUDFLARE_API_TOKEN') || ''
    if (flags.wai && cfId && cfTok) engines.push({ name: 'wai', read: (x) => readSlipFieldsWorkersAI({ bytes: x, accountId: cfId, token: cfTok, model: Deno.env.get('WAI_MODEL') || undefined }) })
    const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
    if (flags.claude && key) engines.push({ name: 'claude', read: (x) => readSlipFields({ bytes: x, key, model: flags.model }) })
    if (!engines.length) return null
    return readSlipOnce(sb, { key: slipKeyOf(qr.bankCode, normalizeRef(qr.ref)), bytes, bankCode: qr.bankCode, source: 'order', engines, files: filesEnv() })
  }
  // ยืนยันสลิปอัตโนมัติ: ค่าจาก config/slipQr.autoConfirm + รหัสร้านค้าจาก config/shop (ว่าง = ยังไม่ผ่านข้อรหัสร้านค้า)
  const autoConfirmCfgOf = async () => {
    const sq = (await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'slipQr').maybeSingle()).data?.data?.v
    const sh = (await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()).data?.data?.v
    return { auto: autoConfirmOf(sq), merchantCode: String(sh?.merchantCode ?? '').replace(/\D/g, '') }
  }
  const action = String(b.action || '')
  if (!['pay', 'read_slip', 'extend', 'photo_optout', 'photo_optout_cancel', 'qr_request'].includes(action)) return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)

  // ---------- ระบุออร์เดอร์ + ตรวจสิทธิ์ ----------
  let orderId = ''
  let customerIdOfSession: string | null = null
  if (b.token != null) {
    const token = String(b.token)
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json(NOT_FOUND, 404)
    const lr = await sb.from('punpang_records').select('id,data').eq('collection', 'orderLinks').eq('data->>tokenHash', await sha256Hex(`orderlink:${token}`)).maybeSingle()
    if (lr.error || !lr.data) return json(NOT_FOUND, 404)
    const link = lr.data.data as Record<string, any>
    const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
    const pol = shop.data?.data?.v?.linkPolicy || {}
    const idle = days(pol.idleDays, 7), never = days(pol.neverOpenedDays, 30)
    const expires = link.lastOpenedAt ? new Date(link.lastOpenedAt).getTime() + idle * DAY : new Date(link.createdAt).getTime() + never * DAY
    if (link.revokedAt || !(Date.now() <= expires)) return json(NOT_FOUND, 404)
    orderId = String(link.orderId)
  } else {
    const t = String(b.session ?? '')
    if (!/^[a-f0-9]{64}$/.test(t)) return json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, 401)
    const s = (await sb.from('punpang_customer_sessions').select('customer_id,expires_at').eq('token_hash', await sha256Hex(`custsess:${t}`)).maybeSingle()).data
    if (!s || new Date(s.expires_at).getTime() < Date.now()) return json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401)
    customerIdOfSession = s.customer_id
    orderId = String(b.orderId ?? '')
  }

  // ---------- อ่าน QR จากรูปสลิป (ไม่เขียนข้อมูล) · ใช้เติมธนาคาร/เลขอ้างอิงในฟอร์มให้ลูกค้าตรวจก่อนส่ง ----------
  if (action === 'read_slip') {
    const ro = (await sb.from('punpang_orders').select('id,customer_id,status').eq('id', orderId).maybeSingle()).data
    if (!ro || ro.status === 'draft' || (customerIdOfSession && ro.customer_id !== customerIdOfSession)) return json({ error: customerIdOfSession ? 'ไม่พบออร์เดอร์' : NOT_FOUND.error }, 404)
    const img = decodeSlip(b.slip)
    if ('error' in img) return json({ error: img.error }, 400)
    // อ่าน QR ก่อน · เป็นสลิปธนาคารจึงส่งต่อไปอ่านยอด/วัน-เวลา (รูปอื่นไม่ส่งไปโมเดล)
    const qr = await readSlipQr(img.bytes)
    // สลิปซ้ำ (เลขอ้างอิงถูกใช้ไปแล้ว) ไม่ส่งให้โมเดลอ่านซ้ำ
    const fields = qr.kind === 'slip' && !(await refUsed(qr.ref)) ? await slipFieldsOf(img.bytes, qr) : null
    return json({ ok: true, qr, fields })
  }

  // ---------- อ่าน-แก้-เขียนออร์เดอร์ (เทียบ updated_at ลองใหม่ได้ 3 ครั้ง) ----------
  const NOTIFY: Record<string, { title: string; text: (o: any, x: any) => string }> = {
    team_customer_paid: { title: 'ลูกค้าแจ้งโอน', text: (o, x) => `${orderNo(o.code)} · ยอด ${x.amount}` },
    team_pay_extend_request: { title: 'ลูกค้าขอขยายเวลาชำระ', text: (o) => orderNo(o.code) },
    team_photo_optout: { title: 'ลูกค้าขอไม่เผยแพร่รูป', text: (o) => orderNo(o.code) },
  }
  async function bell(event: string, o: any, extra: any = {}) {
    const d = NOTIFY[event]
    await sb.from('punpang_records').insert({ collection: 'bell', id: `bl${randHex(6)}`, data: { audience: 'staff', event, title: d.title, text: d.text(o, extra), orderId: o.id, readBy: [], at: new Date().toISOString() } })
  }
  const nowIso = () => new Date().toISOString()
  const logTo = (d: any, text: string) => { d.history = [...(d.history || []), { at: nowIso(), text, by: 'customer' }] }

  for (let attempt = 0; attempt < 3; attempt++) {
    const or = await sb.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,updated_at,data').eq('id', orderId).maybeSingle()
    const row = or.data
    if (!row || row.status === 'draft' || (customerIdOfSession && row.customer_id !== customerIdOfSession)) return json({ error: customerIdOfSession ? 'ไม่พบออร์เดอร์' : NOT_FOUND.error }, 404)
    const d: Record<string, any> = { ...(row.data || {}) }
    d.payments = (d.payments || []).map((p: any) => ({ ...p }))
    d.items = d.items || []
    const order = { id: row.id, code: row.code, ...d }
    let newStatus = row.status
    let extraBell: { event: string; x: any } | null = null
    let autoBell: { code: string; amount: string } | null = null
    let slipNotice: SlipNotice | null = null
    let result: Record<string, unknown> = { ok: true }
    let newSlipPath = ''
    let reqRow: { collection: string; id: string; data: any } | null = null
    let cancelReq: { id: string; data: any } | null = null

    if (action === 'pay') {
      if (limited(`pay:${ip}`, 12, 3600000)) return json({ error: 'ส่งสลิปบ่อยเกินไป กรุณารอสักครู่' }, 429)
      if (row.channel === 'pos') return json({ error: 'บิลหน้าร้านแจ้งชำระผ่านเว็บไม่ได้' }, 400)
      if (row.status === 'cancelled') return json({ error: 'ออร์เดอร์นี้ถูกยกเลิกแล้ว' }, 400)
      const t = totals(order)
      if (t.balance <= 0.004) return json({ error: 'ชำระครบแล้ว' }, 400)
      if (d.payments.some((p: any) => isOverdue(p) && row.status !== 'delivered')) return json({ error: 'เกินกำหนดชำระ กรุณากดขอขยายเวลาก่อน' }, 400)
      const pendingSum = r2(d.payments.filter((p: any) => p.status === 'reported' && p.customerSubmitted).reduce((x: number, p: any) => x + (Number(p.amount) || 0), 0))
      if (t.balance - pendingSum <= 0.004) return json({ error: 'ร้านกำลังตรวจสอบสลิปที่ส่งแล้ว' }, 400)
      const recent = d.payments.filter((p: any) => p.customerSubmitted && Date.now() - new Date(p.submittedAt || 0).getTime() < 3600000).length
      if (recent >= PAY.perHour) return json({ error: 'ส่งสลิปบ่อยเกินไป กรุณารอสักครู่' }, 429)
      const amt = r2(Number(b.amount))
      const room = r2(t.balance - pendingSum)
      if (!(amt > 0)) return json({ error: 'กรอกยอดที่โอน' }, 400)
      if (amt > room + 1e-9) return json({ error: `ยอดเกินคงค้าง (ชำระได้ไม่เกิน ${room.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` }, 400)
      const img = decodeSlip(b.slip)
      if ('error' in img) return json({ error: img.error }, 400)
      const bytes = img.bytes
      // QR ในรูปคือหลักฐานจริง: อ่านเป็นสลิปได้ → ค่าที่กรอกต้องตรงกับ QR · QR พร้อมเพย์ของร้านไม่ใช่สลิป
      const qr = await readSlipQr(bytes)
      if (qr.kind === 'promptpay') return json({ error: PAY_MSG.notSlip }, 400)
      const txn = checkCustomerTxn({ txnDate: b.txnDate, txnTime: b.txnTime, bankCode: b.bankCode, ref: b.ref, createdAt: d.createdAt })
      if ('error' in txn) return json({ error: txn.error }, 400)
      const { paidAt } = txn.value
      // ยอดและวัน-เวลาในสลิป (อ่านจากภาพ) ต้องตรงกับที่ลูกค้ากรอก · อ่านไม่ได้ = ไม่ตรวจ
      // สลิปซ้ำ (เลขอ้างอิงถูกใช้ไปแล้ว) ไม่ส่งให้โมเดลอ่านซ้ำ · การตรวจซ้ำเต็มรูปแบบอยู่ด้านล่าง
      const fields = qr.kind === 'slip' && !(await refUsed(qr.ref)) ? await slipFieldsOf(bytes, qr) : null
      if (fields?.amount != null && Math.abs(fields.amount - amt) > 0.005) return json({ error: `ยอดในสลิป (${fields.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}) ไม่ตรงกับยอดที่แจ้ง กรุณาตรวจอีกครั้ง` }, 400)
      if (fields?.paidAt && fields.paidAt !== paidAt) return json({ error: 'วัน-เวลาในสลิปไม่ตรงกับที่กรอก กรุณาตรวจอีกครั้ง' }, 400)
      // ธนาคาร/เลขอ้างอิง: ถ้าอ่านจาก QR ในสลิปได้ ใช้ค่าจาก QR (ที่ลูกค้ากรอกมาต้องตรงกัน) · ไม่ได้กรอกก็ไม่เป็นไร ร้านตรวจจากสลิป
      let bankCode = txn.value.bankCode
      let ref = txn.value.ref
      if (qr.kind === 'slip') {
        if ((bankCode && bankCode !== qr.bankCode) || (ref && ref !== qr.ref)) return json({ error: PAY_MSG.qrMismatch }, 400)
        bankCode = qr.bankCode
        ref = qr.ref
      }
      if (bankCode && qr.kind !== 'slip' && !bankByCode(bankCode)) return json({ error: PAY_MSG.bank }, 400)
      // เลขอ้างอิงที่รู้แล้วห้ามซ้ำทั้งระบบ (รวมออร์เดอร์อื่น · รายการที่ยกเลิกแล้วใช้ซ้ำได้)
      if (ref) {
        const seen = await sb.from('punpang_orders').select('id,data').contains('data', { payments: [{ ref }] })
        if (seen.error) return json({ error: 'ตรวจเลขอ้างอิงไม่สำเร็จ กรุณาลองใหม่' }, 500)
        if ((seen.data || []).some((r: any) => refTaken(r.data?.payments, ref))) return json({ error: PAY_MSG.refTaken }, 400)
      }
      const ocrFields = { ...(fields?.amount != null ? { ocrAmount: fields.amount } : {}), ...(fields?.paidAt ? { ocrPaidAt: fields.paidAt } : {}), ...(fields?.receiverAccount ? { ocrReceiverAccount: fields.receiverAccount } : {}) }
      const txnFields = { ...ocrFields, paidAt, bankCode: bankCode || null, bankName: bankCode ? (bankByCode(bankCode)?.name ?? null) : null, ref: ref || '', refSource: qr.kind === 'slip' ? 'qr' : (ref ? 'typed' : '') }
      // ยืนยันสลิปอัตโนมัติ (ครบ 5 ข้อจากภาพสลิปเทียบกับออร์เดอร์และรายการแจ้งชำระ + นัดรับห่างพอ + เปิดไว้) · ตัดสินตรงนี้ ใช้ผลตอนบันทึก
      // รายการแจ้งชำระที่รหัสสุ่ม (Ref 2) ตรงกับสลิป → เป็นงวดที่สลิปนี้ชำระ (ไม่สร้างรายการซ้ำ)
      const reqPay = fields?.qrRef ? (d.payments.find((p: any) => p.qrRef === fields.qrRef && p.status === 'reported' && p.customerSubmitted !== true) ?? null) : null
      const acCfg = await autoConfirmCfgOf()
      const autoDecision = autoConfirmDecision({ enabled: acCfg.auto.enabled, days: acCfg.auto.days, fields, order: { code: row.code, createdAt: d.createdAt, pickupAt: d.pickupAt }, configuredMerchantCode: acCfg.merchantCode, balance: t.balance, nowMs: Date.now(), request: reqPay })
      let autoDone = false
      let autoCancelled: any[] = []
      const note = String(b.note ?? '').trim().slice(0, PAY.noteMax)
      const pid = reqPay ? reqPay.id : (b.paymentId ? String(b.paymentId) : '')
      let target: any = null
      if (pid) {
        target = d.payments.find((x: any) => x.id === pid)
        // รายการที่ลูกค้าขอ QR ไว้เอง (qrRequest) รับสลิปได้ · ยอดต้องตรงกับ QR ที่ออกไว้
        if (!target || target.status !== 'reported' || (target.source === 'customer' && !target.qrRequest)) return json({ error: 'ไม่พบยอดที่ร้านแจ้ง' }, 400)
        if (target.customerSubmitted) return json({ error: 'ส่งสลิปของยอดนี้แล้ว รอร้านตรวจสอบ' }, 400)
        if (target.qrRequest && amt !== r2(Number(target.amount))) return json({ error: 'ยอดต้องตรงกับ QR ที่สร้างไว้' }, 400)
      }
      // อัปโหลดสลิปก่อน (ล้มเหลว = ไม่แตะออร์เดอร์) · ไฟล์ใหม่เก็บที่ R2 ผ่าน Worker เท่านั้น · แนบซ้ำตอนลองใหม่ใช้ไฟล์เดิม
      let up: { key: string; ref: string }
      try { up = await svcUpload(filesEnv(), bytes, row.id) } catch (e) { const fe = filesEnv(); console.error('slip-upload', (e as Error)?.message ?? String(e), 'hasUrl', !!fe.url, 'hasKey', !!fe.key); return json({ error: 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่' }, 500) }
      newSlipPath = up.key
      const slipRef = up.ref
      if (target) Object.assign(target, { amount: amt, slip: slipRef, note, customerSubmitted: true, submittedAt: nowIso(), ...txnFields })
      else {
        const al = await sb.rpc('punpang_alloc_numbers_server', { p_prefix: 'PAY', p_day: ddmmyy(), p_n: 1 })
        if (al.error || !Number.isInteger(al.data)) { await svcDelete(filesEnv(), [newSlipPath]); return json({ error: 'ออกเลขรายการไม่สำเร็จ กรุณาลองใหม่' }, 500) }
        const code = `PAY-${ddmmyy()}-${String(al.data).padStart(5, '0')}`
        target = { id: `pay${Date.now().toString(36)}${randHex(3)}`, code, requested: amt, amount: amt, method: 'โอนเงิน', slip: slipRef, note, dueAt: '', extension: null, status: 'reported', source: 'customer', customerSubmitted: true, submittedAt: nowIso(), createdAt: nowIso(), reportedBy: 'customer', confirmedBy: null, ...txnFields }
        d.payments.push(target)
      }
      // ยืนยันอัตโนมัติ: ยืนยันงวดนี้ + ยกเลิกยอดที่ร้านแจ้งเดิมที่ยังรออยู่ของออร์เดอร์
      if (autoDecision.ok) {
        const conf = confirmSlipPayment(d.payments, target.id, nowIso())
        d.payments = conf.payments
        autoCancelled = conf.cancelled
        autoDone = true
      }
      logTo(d, autoDone ? `ลูกค้าแจ้งชำระ ${amt.toFixed(2)} ผ่านหน้าออร์เดอร์ (ระบบยืนยันอัตโนมัติ)` : `ลูกค้าแจ้งชำระ ${amt.toFixed(2)} ผ่านหน้าออร์เดอร์ (รอตรวจสลิป)`)
      if (autoDone) {
        d.history = [...(d.history || []), { at: nowIso(), text: `ยืนยันชำระอัตโนมัติ (ครบ 5 ข้อ · นัดรับห่าง ${autoDecision.daysLeft} วัน · ยังไม่ได้ตรวจกับธนาคาร)`, by: 'auto' }]
        if (autoCancelled.length) d.history = [...d.history, { at: nowIso(), text: `ยกเลิกยอดที่แจ้งเดิม ${autoCancelled.length} รายการ (${autoCancelled.map((p: any) => (Number(p.amount) || 0).toFixed(2)).join(', ')}) เพราะยืนยันชำระอัตโนมัติแล้ว`, by: 'auto' }]
        newStatus = ['awaiting_payment', 'payment_reported'].includes(row.status) ? 'payment_confirmed' : row.status
        autoBell = { code: row.code, amount: amt.toFixed(2) }
      } else {
        if (row.status === 'awaiting_payment') newStatus = 'payment_reported'
        extraBell = { event: 'team_customer_paid', x: { amount: amt.toFixed(2) } }
      }
      // ยืนยันอัตโนมัติ → ไม่ส่ง "ได้รับสลิป" (ข้อความยืนยันชำระจะส่งจากรอบ scheduled)
      slipNotice = autoDone ? null : { orderCode: row.code, orderId: row.id, customerId: row.customer_id, amount: amt }
      result = { ok: true, paymentId: target.id, ...(autoDone ? { autoConfirmed: true } : {}) }
    } else if (action === 'extend') {
      const p = d.payments.find((x: any) => x.id === String(b.paymentId ?? ''))
      if (!p || p.source === 'customer') return json({ error: 'ไม่พบยอดที่ร้านแจ้ง' }, 400)
      if (['draft', 'cancelled', 'delivered'].includes(row.status) || !isOverdue(p) || p.extension?.status === 'pending') return json({ error: 'ขอขยายเวลาไม่ได้ (ยังไม่เกินกำหนด หรือมีคำขอรออยู่)' }, 400)
      p.extension = { status: 'pending', at: nowIso(), note: String(b.note ?? '').trim().slice(0, 200) }
      logTo(d, 'ลูกค้าขอขยายเวลาชำระ')
      extraBell = { event: 'team_pay_extend_request', x: {} }
    } else if (action === 'photo_optout') {
      const has = d.items.some((i: any) => (i.workPhotos || []).length)
      const st = d.photoConsent?.status || 'ok'
      if (!has) return json({ error: 'ยังไม่มีรูปงานในออร์เดอร์นี้' }, 400)
      if (st === 'requested') return json({ error: 'ส่งคำขอไว้แล้ว รอร้านตรวจสอบ' }, 400)
      if (st === 'revoked') return json({ error: 'ร้านลบรูปตามคำขอไว้แล้ว' }, 400)
      const at = nowIso()
      const note = String(b.note ?? '').trim().slice(0, 300)
      const rid = `pr${randHex(6)}`
      reqRow = { collection: 'photoRequests', id: rid, data: { orderId: row.id, customerId: row.customer_id, status: 'pending', note, createdAt: at, decidedAt: null, decidedBy: null, decisionNote: '' } }
      d.photoConsent = { status: 'requested', requestedAt: at, note, history: [...(d.photoConsent?.history || []), { at, text: 'ลูกค้าขอไม่ให้ใช้รูปเผยแพร่' }] }
      logTo(d, 'ลูกค้าขอไม่ให้ใช้รูปงานเผยแพร่ (รอร้านตรวจสอบ · ระงับการแสดงบนเว็บชั่วคราว)')
      extraBell = { event: 'team_photo_optout', x: {} }
    } else if (action === 'qr_request') {
      // ขอ QR ชำระ = สร้างรายการแจ้งชำระใหม่ของลูกค้า (ยังไม่มีสลิป) พร้อมรหัสสุ่มไม่ซ้ำ (Ref 2)
      if (limited(`qr:${ip}`, 30, 3600000)) return json({ error: 'ขอ QR บ่อยเกินไป กรุณารอสักครู่' }, 429)
      if (row.channel === 'pos') return json({ error: 'บิลหน้าร้านแจ้งชำระผ่านเว็บไม่ได้' }, 400)
      if (row.status === 'cancelled') return json({ error: 'ออร์เดอร์นี้ถูกยกเลิกแล้ว' }, 400)
      const t = totals(order)
      if (t.balance <= 0.004) return json({ error: 'ชำระครบแล้ว' }, 400)
      if (d.payments.some((p: any) => isOverdue(p) && row.status !== 'delivered')) return json({ error: 'เกินกำหนดชำระ กรุณากดขอขยายเวลาก่อน' }, 400)
      const pendingSum = r2(d.payments.filter((p: any) => p.status === 'reported' && p.customerSubmitted).reduce((x: number, p: any) => x + (Number(p.amount) || 0), 0))
      const room = r2(t.balance - pendingSum)
      const amt = r2(Number(b.amount))
      if (!(amt > 0)) return json({ error: 'กรอกยอดที่ชำระ' }, 400)
      if (amt > room + 1e-9) return json({ error: `ยอดเกินคงค้าง (ชำระได้ไม่เกิน ${room.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` }, 400)
      // รหัสสุ่มไม่ซ้ำทั้งระบบ: ออกใหม่ถ้าเคยถูกใช้ (ค้นใน JSON ของออร์เดอร์ทั้งหมด)
      let qrRef = refOfCode(row.code) + newQrSuffix()
      for (let k = 0; k < 3; k++) {
        const seen = await sb.from('punpang_orders').select('id').contains('data', { payments: [{ qrRef }] })
        if (seen.error) return json({ error: 'สร้าง QR ไม่สำเร็จ กรุณาลองใหม่' }, 500)
        if (!(seen.data || []).length) break
        qrRef = refOfCode(row.code) + newQrSuffix()
      }
      const al = await sb.rpc('punpang_alloc_numbers_server', { p_prefix: 'PAY', p_day: ddmmyy(), p_n: 1 })
      if (al.error || !Number.isInteger(al.data)) return json({ error: 'ออกเลขรายการไม่สำเร็จ กรุณาลองใหม่' }, 500)
      const code = `PAY-${ddmmyy()}-${String(al.data).padStart(5, '0')}`
      const reqPay = { id: `pay${Date.now().toString(36)}${randHex(3)}`, code, requested: amt, amount: amt, method: 'โอนเงิน', slip: '', note: '', dueAt: '', extension: null, status: 'reported', source: 'customer', qrRequest: true, qrRef, customerSubmitted: false, createdAt: nowIso(), reportedBy: 'customer', confirmedBy: null }
      d.payments.push(reqPay)
      logTo(d, `ลูกค้าขอ QR ชำระ ${amt.toFixed(2)} (รอแนบสลิป)`)
      result = { ok: true, paymentId: reqPay.id, qrRef, amount: amt }
    } else {
      const pr = await sb.from('punpang_records').select('id,data').eq('collection', 'photoRequests').eq('data->>orderId', row.id)
      const req = (pr.data || []).find((x: any) => x.data?.status === 'pending')
      if (!req || (d.photoConsent?.status || 'ok') !== 'requested') return json({ error: 'ไม่มีคำขอที่รอตรวจสอบ' }, 400)
      cancelReq = { id: req.id, data: req.data }
      d.photoConsent = { ...d.photoConsent, status: 'ok', history: [...(d.photoConsent.history || []), { at: nowIso(), text: 'ลูกค้ายกเลิกคำขอ' }] }
      logTo(d, 'ลูกค้ายกเลิกคำขอไม่ให้ใช้รูป')
    }

    // เขียนแบบเทียบ updated_at: ถ้าพนักงานแก้ออร์เดอร์พร้อมกัน แถวไม่ตรง → อ่านใหม่แล้วทำซ้ำ
    const up = await sb.from('punpang_orders').update({ data: d, status: newStatus }).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (up.error || !(up.data || []).length) {
      if (newSlipPath) await svcDelete(filesEnv(), [newSlipPath]) // รอบหน้าอัปโหลดใหม่ (ไม่ทิ้งไฟล์ค้าง)
      if (up.error) return json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' }, 500)
      continue
    }
    if (reqRow) await sb.from('punpang_records').insert(reqRow)
    if (cancelReq) await sb.from('punpang_records').update({ data: { ...cancelReq.data, status: 'cancelled', decidedAt: nowIso(), decidedBy: 'customer' } }).eq('collection', 'photoRequests').eq('id', cancelReq.id)
    if (extraBell) await bell(extraBell.event, { id: row.id, code: row.code }, extraBell.x)
    if (autoBell) await sb.from('punpang_records').insert({ collection: 'bell', id: `bl${randHex(6)}`, data: { audience: 'staff', event: 'team_customer_paid', title: 'ยืนยันชำระอัตโนมัติแล้ว', text: `${autoBell.code} · ยอด ${autoBell.amount} (อ่านจากภาพ ยังไม่ได้ตรวจกับธนาคาร)`, orderId: row.id, readBy: [], at: new Date().toISOString() } })
    if (slipNotice) {
      // ไม่รอผลส่ง: ให้ลูกค้าได้รับคำตอบเร็ว · ถ้าเปิดได้ (EdgeRuntime.waitUntil) ให้งานทำต่อหลังตอบกลับ
      const job = notifySlipFacebook(sb, slipNotice).catch((e) => console.error('slip-notify', String((e as Error)?.message || e)))
      const er = (globalThis as any).EdgeRuntime
      if (er?.waitUntil) er.waitUntil(job)
      else await job
    }
    return json(result)
  }
  return json({ error: 'ออร์เดอร์กำลังถูกแก้ไขอยู่ กรุณาลองใหม่อีกครั้ง' }, 409)
})
