import { modeOf, refuseInTest } from '../_shared/mode.ts'
import { corsWrap } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { priceCampaignOrder } from '../_shared/schedlib/preorderPrice.js'
import { MIN, hex, sha256Hex, randHex, thaiPhone } from '../_shared/otp.ts'
import { sendSmsGateway } from '../_shared/sms.ts'
import { verifyTurnstile } from '../_shared/turnstile.ts'
import { consentNeededFor, recordConsents } from '../_shared/consent.ts'
import { reserveOtpAttempt } from '../_shared/authguard.ts'
import { promptPayBillerPayload } from '../_shared/schedlib/promptpay.js'
import { publicPaymentOf } from '../_shared/shoppay.ts'

// สั่งล่วงหน้า (ลูกค้า): ฟังก์ชันสาธารณะ (--no-verify-jwt) · ขั้นนี้มี 2 action: campaigns (ดูแคมเปญที่เปิดรับ) และ quote (คิดราคาให้ดู)
// ข้อมูลที่ส่งกลับไม่มีตารางอัตราค่าส่ง · ราคาทั้งหมดคิดที่เซิร์ฟเวอร์ · ค่าที่ผู้ใช้ส่งมาเรื่องราคา/ค่าส่ง/แต้มไม่ถูกใช้
// การสร้างออร์เดอร์ใช้ได้เฉพาะเซสชันสั่งล่วงหน้าที่ได้จาก OTP (ไม่ใช้แต้มในขั้นนี้) · ยังไม่มีการจ่ายเงิน (เฟส 3)
const CORS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const bangkokToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// แคตาล็อกที่ใช้คิดราคา (ชุดย่อยของ loadCatalog: ร้าน สินค้าหน้าร้าน แต้ม)
async function catalogOf(sb: any) {
  const [shopRow, loyRow, items] = await Promise.all([
    sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle(),
    sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'loyalty').maybeSingle(),
    sb.from('punpang_items').select('id,kind,name,price,active,data').eq('kind', 'retail'),
  ])
  const shop = shopRow.data?.data?.v ?? {}
  const pointValue = Number(loyRow.data?.data?.v?.pointValue ?? 1)
  const retailItems = (items.data || []).map((x: any) => ({ ...(x.data || {}), id: x.id, name: x.name, price: Number(x.price) || 0, active: x.active !== false, kind: 'retail' }))
  return { catalog: { shop, retailItems, priceLists: [], optionGroups: [], bundles: [], posDiscounts: [], posBundles: [], posDeals: [] }, pointValue }
}

// แคมเปญที่เปิดรับตอนนี้ (สถานะ open และอยู่ในช่วงรับสั่ง)
async function openCampaign(sb: any, id: string) {
  const r = await sb.from('punpang_preorder_campaigns').select('*').eq('id', id).maybeSingle()
  const c = r.data
  if (!c || c.status !== 'open') return null
  const today = bangkokToday()
  if (today < c.order_from || today > c.order_to) return null
  return c
}


const OTP_TTL_MS = 5 * MIN
const OTP_RESEND_MS = MIN
const OTP_MAX_TRIES = 5
const SESSION_MS = 14 * 24 * 3600 * 1000
const ORDER_ID_RE = /^[0-9a-f]{32}$/

// เซสชันสั่งล่วงหน้า: เก็บ hash ของโทเคน ไม่เก็บโทเคนจริง · ไม่เกี่ยวกับเซสชันบัญชีลูกค้าเดิม
async function sessionCustomer(sb: any, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length !== 64) return null
  const r = await sb.from('punpang_preorder_sessions').select('customer_id,expires_at').eq('token_hash', await sha256Hex('presess:' + token)).maybeSingle()
  if (!r.data || new Date(r.data.expires_at).getTime() <= Date.now()) return null
  return r.data.customer_id
}
const QR_SUFFIX = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const randDigits = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => String(x % 10)).join('')
const randQrSuffix = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => QR_SUFFIX[x % QR_SUFFIX.length]).join('')
const QR_ERR: Record<string, string> = {
  bad_status: 'ออร์เดอร์นี้รับการชำระไม่ได้ในสถานะปัจจุบัน (ถ้าหมดเวลาแล้วให้ขอขยายเวลาก่อน)',
  over_total: 'ยอดเกินยอดที่ค้างชำระ',
  bad_amount: 'ยอดไม่ถูกต้อง',
}
const clientIpOf = (req: Request) => (req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',').pop() || '').trim()

Deno.serve(corsWrap(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const action = String(b.action || '')

  // ===== แคมเปญที่เปิดรับ (ไม่มีข้อมูลส่วนตัว ไม่มีอัตราค่าส่ง) =====
  if (action === 'campaigns') {
    const r = await sb.from('punpang_preorder_campaigns').select('*').eq('status', 'open')
    const today = bangkokToday()
    const open = (r.data || []).filter((c: any) => today >= c.order_from && today <= c.order_to)
    const { catalog } = await catalogOf(sb)
    const campaigns = open.map((c: any) => ({
      id: c.id,
      name: c.data?.name ?? '',
      orderFrom: c.order_from,
      orderTo: c.order_to,
      pickupFrom: c.pickup_from,
      pickupTo: c.pickup_to,
      depositPercent: c.deposit_percent,
      payDueMin: c.pay_due_min,
      parcelEnabled: c.data?.parcel?.enabled === true,
      shipping: c.data?.parcel?.enabled === true && c.data?.shipping ? { shipFrom: c.data.shipping.shipFrom, shipTo: c.data.shipping.shipTo } : null,
      deals: (c.data?.deals ?? []).map((d: any) => ({ kind: d.kind, name: d.name, tiers: d.tiers })),
      items: (c.data?.items ?? []).map((i: any) => {
        const p = catalog.retailItems.find((x: any) => x.id === i.retailId)
        return { retailId: i.retailId, name: p?.name ?? '', price: p?.price ?? 0, dayCap: i.dayCap ?? null }
      }),
    }))
    return json({ campaigns })
  }

  // ===== คิดราคาให้ดู (ไม่จองโควตา ไม่สร้างออร์เดอร์) =====
  if (action === 'quote') {
    const c = await openCampaign(sb, String(b.campaignId || ''))
    if (!c) return json({ error: 'แคมเปญนี้ไม่เปิดรับสั่งในขณะนี้' }, 409)
    if (!isDay(b.pickupDate) || b.pickupDate < c.pickup_from || b.pickupDate > c.pickup_to) return json({ error: 'วันรับสินค้าไม่อยู่ในช่วงที่กำหนด' }, 400)
    if (b.fulfillment !== 'pickup' && b.fulfillment !== 'delivery') return json({ error: 'เลือกรับที่ร้านหรือส่งพัสดุ' }, 400)
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 30) return json({ error: 'เลือกสินค้า 1–30 รายการ' }, 400)
    const lines = b.lines.map((l: any) => ({ retailId: String(l?.retailId ?? ''), qty: l?.qty }))
    const { catalog, pointValue } = await catalogOf(sb)
    const campaign = { id: c.id, items: (c.data?.items ?? []), deals: c.data?.deals ?? [], parcel: c.data?.parcel ?? { enabled: false } }
    const q: any = priceCampaignOrder({ campaign, catalog, lines, pickupDate: b.pickupDate, fulfillment: b.fulfillment, points: 0, pointValue, nowMs: Date.now() })
    if (!q.ok) return json({ error: q.error, itemId: q.itemId ?? null }, 400)
    return json({ ok: true, total: q.totals.total, vat: q.totals.vat, shippingFee: q.order.shippingFee, goods: q.totals.beforeVat ?? null, parcel: q.snapshot.parcel ? { chargeableG: q.snapshot.parcel.chargeableG } : null })
  }

  // ===== ขอรหัส OTP (ต้องผ่าน Turnstile · เพดานรวมกันในฐานข้อมูล · ตอบเหมือนกันทุกเบอร์) =====
  if (action === 'otp_request') {
    const ph = thaiPhone(b.phone)
    if (!ph) return json({ error: 'กรอกเบอร์โทรให้ถูกต้อง' }, 400)
    const ip = clientIpOf(req)
    if (!(await verifyTurnstile(String(b.turnstileToken || ''), ip, (Deno.env.get('TURNSTILE_SECRET_KEY') || '').trim()))) return json({ error: 'ยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่' }, 400)
    const allowed = await sb.rpc('punpang_preorder_otp_allowed', { p_phone_hash: await sha256Hex('preorder-otp-phone:' + ph.local), p_ip_hash: await sha256Hex('preorder-otp-ip:' + ip), p_purpose: 'preorder' })
    if (allowed.error) return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 503)
    if (allowed.data !== true) return json({ error: 'ขอรหัสบ่อยเกินไป กรุณาลองใหม่ภายหลัง' }, 429)
    const last = await sb.from('punpang_otps').select('sent_at').eq('phone', ph.local).eq('purpose', 'preorder').order('sent_at', { ascending: false }).limit(1).maybeSingle()
    if (last.data && Date.now() - new Date(last.data.sent_at).getTime() < OTP_RESEND_MS) return json({ error: 'ขอรหัสใหม่ได้ในอีกไม่กี่วินาที' }, 429)
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0')
    const salt = randHex(8)
    const id = randHex(16)
    await sb.from('punpang_otps').delete().eq('phone', ph.local).eq('purpose', 'preorder').eq('used', false)
    const ins = await sb.from('punpang_otps').insert({ id, phone: ph.local, purpose: 'preorder', code_hash: await sha256Hex(`${salt}:${code}`), salt, expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(), ip, customer_id: null })
    if (ins.error) return json({ error: 'ส่งรหัสไม่สำเร็จ กรุณาลองใหม่' }, 500)
    const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
    const name = String(shop.data?.data?.v?.name || 'ร้านเค้ก').slice(0, 40)
    const sent = await sendSmsGateway(ph.local, `รหัส OTP ของ ${name} คือ ${code} (ใช้ได้ 5 นาที ห้ามบอกผู้อื่น)`, id)
    if (!sent) { await sb.from('punpang_otps').delete().eq('id', id); return json({ error: 'ส่ง SMS ไม่สำเร็จ กรุณาลองใหม่ภายหลัง' }, 502) }
    return json({ ok: true })
  }

  // ===== ยืนยัน OTP → เซสชันสั่งล่วงหน้า (สร้าง/ผูกลูกค้าตามเบอร์ · ลูกค้าใหม่ต้องยินยอม) =====
  if (action === 'otp_verify') {
    const ph = thaiPhone(b.phone)
    if (!ph) return json({ error: 'กรอกเบอร์โทรให้ถูกต้อง' }, 400)
    const row = (await sb.from('punpang_otps').select('*').eq('phone', ph.local).eq('purpose', 'preorder').eq('used', false).maybeSingle()).data
    if (!row) return json({ error: 'ยังไม่ได้ขอรหัส กรุณาขอรหัสก่อน' }, 400)
    // จองครั้งที่ตรวจก่อนเทียบรหัส (เขียนแบบมีเงื่อนไข กันการยิงพร้อมกันเดารหัสเกินเพดาน)
    const gate = await reserveOtpAttempt({
      read: async () => (await sb.from('punpang_otps').select('attempts,used,expires_at').eq('id', row.id).maybeSingle()).data ?? null,
      casAttempts: async (expect: number) => {
        const u = await sb.from('punpang_otps').update({ attempts: expect + 1 }).eq('id', row.id).eq('attempts', expect).eq('used', false).select('id')
        return !u.error && (u.data || []).length > 0
      },
    }, { maxTries: OTP_MAX_TRIES }, row)
    if (!gate.ok) {
      if (gate.reason === 'busy') return json({ error: 'มีการตรวจรหัสหลายคำขอพร้อมกัน กรุณารอสักครู่แล้วลองใหม่' }, 429)
      if (gate.reason === 'expired') return json({ error: 'รหัสหมดอายุ กรุณาขอรหัสใหม่' }, 400)
      if (gate.reason === 'exhausted') return json({ error: 'กรอกผิดเกินกำหนด กรุณาขอรหัสใหม่' }, 429)
      return json({ error: 'ยังไม่ได้ขอรหัส กรุณาขอรหัสก่อน' }, 400)
    }
    if ((await sha256Hex(`${row.salt}:${String(b.code || '')}`)) !== row.code_hash) return json({ error: 'รหัสไม่ถูกต้อง' }, 400)
    // ใช้รหัสได้ครั้งเดียว: เขียนแบบมีเงื่อนไขว่ายังไม่ถูกใช้
    const used = await sb.from('punpang_otps').update({ used: true }).eq('id', row.id).eq('used', false).select('id')
    if (used.error || (used.data || []).length === 0) return json({ error: 'รหัสนี้ถูกใช้แล้ว กรุณาขอรหัสใหม่' }, 400)
    let cust = (await sb.from('punpang_customers').select('id,data').eq('phone', ph.local).maybeSingle()).data
    let customerId: string
    if (cust && !cust.data?.deleted) {
      customerId = cust.id
    } else {
      if (b.consent !== true) return json({ error: 'ต้องยินยอมก่อนสั่งสินค้า', needConsent: true }, 400)
      customerId = 'c' + randHex(8)
      const name = String(b.name ?? '').trim().slice(0, 80) || 'ลูกค้า'
      const ins = await sb.from('punpang_customers').insert({ id: customerId, name, phone: ph.local, data: { active: true, ledger: [], spins: 0, places: [], promoOptIn: false } })
      if (ins.error) return json({ error: 'สร้างบัญชีไม่สำเร็จ กรุณาลองใหม่' }, 500)
      await recordConsents(sb, customerId, ['privacy', 'terms'], 'preorder')
    }
    const token = randHex(32)
    await sb.from('punpang_preorder_sessions').insert({ token_hash: await sha256Hex('presess:' + token), customer_id: customerId, expires_at: new Date(Date.now() + SESSION_MS).toISOString() })
    return json({ ok: true, token })
  }

  // ===== ออร์เดอร์ของฉัน (เฉพาะของเซสชันนี้) =====
  if (action === 'state') {
    const cid = await sessionCustomer(sb, b.token)
    if (!cid) return json({ error: 'กรุณายืนยันเบอร์ใหม่' }, 401)
    const r = await sb.from('punpang_preorder_orders').select('*').eq('customer_id', cid)
    return json({ orders: (r.data || []).map((o: any) => ({ id: o.id, code: o.code, status: o.status, campaignId: o.campaign_id, pickupDate: o.pickup_date, total: o.data?.total ?? null, deposit: o.data?.deposit ?? null, payDueAt: o.data?.payDueAt ?? null })) })
  }

  // ===== สร้างออร์เดอร์ (จองโควตาและบันทึกในธุรกรรมเดียวในฐานข้อมูล) =====
  if (action === 'create') {
    const ip = clientIpOf(req)
    if (!(await verifyTurnstile(String(b.turnstileToken || ''), ip, (Deno.env.get('TURNSTILE_SECRET_KEY') || '').trim()))) return json({ error: 'ยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่' }, 400)
    const cid = await sessionCustomer(sb, b.token)
    if (!cid) return json({ error: 'กรุณายืนยันเบอร์ใหม่' }, 401)
    const orderId = String(b.orderId || '')
    if (!ORDER_ID_RE.test(orderId)) return json({ error: 'รหัสออร์เดอร์ไม่ถูกต้อง' }, 400)
    const c = await openCampaign(sb, String(b.campaignId || ''))
    if (!c) return json({ error: 'แคมเปญนี้ไม่เปิดรับสั่งในขณะนี้' }, 409)
    if (!isDay(b.pickupDate) || b.pickupDate < c.pickup_from || b.pickupDate > c.pickup_to) return json({ error: 'วันรับสินค้าไม่อยู่ในช่วงที่กำหนด' }, 400)
    if (b.fulfillment !== 'pickup' && b.fulfillment !== 'delivery') return json({ error: 'เลือกรับที่ร้านหรือส่งพัสดุ' }, 400)
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 30) return json({ error: 'เลือกสินค้า 1–30 รายการ' }, 400)
    const lines = b.lines.map((l: any) => ({ retailId: String(l?.retailId ?? ''), qty: l?.qty }))
    const { catalog, pointValue } = await catalogOf(sb)
    const campaign = { id: c.id, items: (c.data?.items ?? []), deals: c.data?.deals ?? [], parcel: c.data?.parcel ?? { enabled: false } }
    const q: any = priceCampaignOrder({ campaign, catalog, lines, pickupDate: b.pickupDate, fulfillment: b.fulfillment, points: 0, pointValue, nowMs: Date.now() })
    if (!q.ok) return json({ error: q.error, itemId: q.itemId ?? null }, 400)
    // ส่งพัสดุต้องมีที่อยู่และจังหวัด (เก็บในออร์เดอร์ ไม่ใช้ค่าจากตาราง)
    const address = String(b.address ?? '').trim().slice(0, 300)
    const province = String(b.province ?? '').trim().slice(0, 40)
    if (b.fulfillment === 'delivery' && (!address || !province)) return json({ error: 'กรอกที่อยู่และจังหวัดสำหรับส่งพัสดุ' }, 400)
    // ช่วงวันจัดส่งมาจากแคมเปญเท่านั้น (ไม่รับจากผู้ใช้) · แคมเปญที่ยังไม่ระบุต้องไม่รับออร์เดอร์พัสดุ
    const shipping = c.data?.shipping
    if (b.fulfillment === 'delivery' && (!shipping?.shipFrom || !shipping?.shipTo)) return json({ error: 'แคมเปญนี้ยังไม่ระบุวันจัดส่งพัสดุ' }, 409)
    const total = Math.round(q.totals.total * 100) / 100
    const deposit = Math.ceil((total * c.deposit_percent) / 100 * 100) / 100
    const payDueAt = new Date(Date.now() + c.pay_due_min * MIN).toISOString()
    const data = { ...q.order, total, deposit: { percent: c.deposit_percent, amount: deposit }, payDueAt, lines, pickupDate: b.pickupDate, ...(b.fulfillment === 'delivery' ? { address, province, shipping: { shipFrom: shipping.shipFrom, shipTo: shipping.shipTo } } : {}) }
    const rpc = await sb.rpc('punpang_preorder_create', {
      p_row: { id: orderId, customer_id: cid, campaign_id: c.id, pickup_date: b.pickupDate, status: 'awaiting_payment', fulfillment: b.fulfillment, data },
      p_lines: lines.map((l: any) => ({ itemId: l.retailId, qty: l.qty })),
      p_points: 0,
      p_amount: 0,
    })
    if (rpc.error) {
      const m = String(rpc.error.message || '')
      if (m.startsWith('reserve_failed:')) return json({ error: 'สินค้าหรือวันรับนี้เต็มแล้ว กรุณาเลือกใหม่', code: m.slice(15) }, 409)
      return json({ error: 'สร้างออร์เดอร์ไม่สำเร็จ กรุณาลองใหม่' }, 500)
    }
    if (rpc.data?.error === 'too_many_open') return json({ error: 'มีออร์เดอร์ที่ยังไม่จ่ายครบ 3 รายการแล้ว' }, 409)
    if (rpc.data?.error === 'no_customer') return json({ error: 'ไม่พบบัญชี' }, 401)
    if (rpc.data?.error) return json({ error: 'สร้างออร์เดอร์ไม่สำเร็จ กรุณาลองใหม่' }, 500)
    return json({ ok: true, already: rpc.data?.already === true, code: rpc.data?.code, orderId, total, deposit, payDueAt })
  }

  // คำขอ QR ของออร์เดอร์สั่งล่วงหน้า (ลูกค้าเจ้าของออร์เดอร์เท่านั้น): รหัส PRE สร้างที่นี่ · ยอดและสถานะตรวจในฐานข้อมูล
  if (action === 'qr_request') {
    const cid = await sessionCustomer(sb, b.token)
    if (!cid) return json({ error: 'กรุณายืนยันเบอร์ใหม่' }, 401)
    const orderId = String(b.orderId || '')
    if (!ORDER_ID_RE.test(orderId)) return json({ error: 'รหัสออร์เดอร์ไม่ถูกต้อง' }, 400)
    const amount = Number(b.amount)
    if (!(amount > 0) || Math.round(amount * 100) / 100 !== amount) return json({ error: 'ยอดไม่ถูกต้อง' }, 400)
    const o = await sb.from('punpang_preorder_orders').select('id,code').eq('id', orderId).eq('customer_id', cid).maybeSingle()
    if (!o.data) return json({ error: 'ไม่พบออร์เดอร์นี้' }, 404)
    const ddmmyy = String(o.data.code || '').match(/^PRE-(\d{6})-/)?.[1]
    if (!ddmmyy) return json({ error: 'รหัสออร์เดอร์ไม่ถูกต้อง' }, 500)
    const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
    const pay = publicPaymentOf(shop.data?.data?.v)
    if (!pay.billerId || !pay.merchantCode) return json({ error: 'ร้านยังไม่ได้ตั้งค่าพร้อมเพย์' }, 409)
    for (let attempt = 0; attempt < 3; attempt++) {
      const qrRef = 'PRE' + ddmmyy + randDigits(6) + randQrSuffix(5)
      const r = await sb.rpc('punpang_preorder_request_qr', { p_order: orderId, p_amount: amount, p_qr_ref: qrRef })
      if (r.error) return json({ error: 'สร้างคำขอ QR ไม่สำเร็จ กรุณาลองใหม่' }, 500)
      if (r.data?.error === 'ref_taken') continue
      if (r.data?.error) return json({ error: QR_ERR[r.data.error] ?? 'สร้างคำขอ QR ไม่สำเร็จ' }, 409)
      // ไฟล์ JS ที่คัดลอกมาให้ชนิดพารามิเตอร์ยอดเป็น null (ค่าเริ่มต้น) จึงระบุชนิดตอนเรียก
      const payload = (promptPayBillerPayload as (...a: unknown[]) => string | null)(pay.billerId, amount, pay.merchantCode, qrRef)
      if (!payload) return json({ error: 'สร้าง QR ไม่สำเร็จ' }, 500)
      return json({ ok: true, qrRef, amount, payload })
    }
    return json({ error: 'สร้างคำขอ QR ไม่สำเร็จ กรุณาลองใหม่' }, 500)
  }
  // ลูกค้าขอขยายเวลาของออร์เดอร์ที่หมดเวลาแล้ว (ร้านเป็นผู้อนุมัติ)
  if (action === 'extension_request') {
    const cid = await sessionCustomer(sb, b.token)
    if (!cid) return json({ error: 'กรุณายืนยันเบอร์ใหม่' }, 401)
    const orderId = String(b.orderId || '')
    if (!ORDER_ID_RE.test(orderId)) return json({ error: 'รหัสออร์เดอร์ไม่ถูกต้อง' }, 400)
    const o = await sb.from('punpang_preorder_orders').select('id').eq('id', orderId).eq('customer_id', cid).maybeSingle()
    if (!o.data) return json({ error: 'ไม่พบออร์เดอร์นี้' }, 404)
    const r = await sb.rpc('punpang_preorder_request_extension', { p_order: orderId })
    if (r.error) return json({ error: 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่' }, 500)
    if (r.data?.error === 'bad_status') return json({ error: 'ขอขยายเวลาได้เฉพาะออร์เดอร์ที่หมดเวลาแล้ว' }, 409)
    return json({ ok: true, already: r.data?.already === true })
  }
  return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)
}))
