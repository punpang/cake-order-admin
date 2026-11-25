import { corsWrap } from '../_shared/cors.ts'
import { serviceDb } from '../_shared/db.ts'
import { prepSheet, pickupList, shipQueue, dueList, campaignSummary, exceptionList } from '../_shared/schedlib/preorderReports.js'
import { notifyOrderEvent } from '../_shared/preorderNotify.ts'

// สั่งล่วงหน้า (ฝั่งร้าน): เฉพาะพนักงานที่มีสิทธิ์ managePreorder หรือ manage
// การกระทำ: list · accounting (ข้อมูลดิบสำหรับบัญชี) · set_shipping · mark_delivered · record_return · refund_return · reship · record_payment · cancel
// ทุกการกระทำเรียกฟังก์ชันฐานข้อมูลที่ตรวจกฎเอง (ยอด สถานะ ลำดับล็อก) ฟังก์ชันนี้ไม่คำนวณยอดเอง
const CORS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const ORDER_ID_RE = /^[0-9a-f]{32}$/

// มุมมองสำหรับพนักงาน: แสดงข้อมูลที่ใช้ตัดสินใจ (ไม่ส่งรหัสโควตา/คำขอ QR ภายในทั้งหมด)
function staffView(o: any, names: Record<string, string>) {
  const d = o.data || {}
  const pays: any[] = Array.isArray(d.payments) ? d.payments : []
  const paid = pays.filter((x) => x?.status === 'confirmed').reduce((a, x) => a + (Number(x.amount) || 0), 0)
  const reported = pays.filter((x) => x?.status === 'reported').map((x) => ({ id: x.id, amount: x.amount, qrRef: x.qrRef }))
  return {
    id: o.id, code: o.code, status: o.status, pickupDate: o.pickup_date, customerName: names[o.customer_id] ?? '',
    fulfillment: d.fulfillment ?? null, total: d.total ?? null, deposit: d.deposit ?? null, payDueAt: d.payDueAt ?? null,
    shippingFee: d.shippingFee ?? 0, paid: Math.round(paid * 100) / 100,
    pendingCash: reported,
    shipping: d.shipping ?? null, returns: d.returns ?? [], returnRequest: d.returnRequest ?? null,
    extensionRequest: d.extensionRequest ?? null, extensions: d.extensions ?? [],
  }
}

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const sb = serviceDb(req)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active,perms').eq('user_id', uid).maybeSingle()
  const perms: string[] = Array.isArray(st.data?.perms) ? st.data.perms : []
  let body: Record<string, any> = {}
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  // บัญชี (accounting) อ่านได้ด้วยสิทธิ์ดูบัญชี · การกระทำอื่นต้องมีสิทธิ์จัดการสั่งล่วงหน้า
  const manages = perms.includes('managePreorder') || perms.includes('manage')
  const readsAcct = body.action === 'accounting' && perms.includes('acctView')
  if (!st.data?.active || !(manages || readsAcct)) return json({ error: 'ไม่มีสิทธิ์จัดการสั่งล่วงหน้า' }, 403)
  const action = String(body.action ?? '')
  const orderId = String(body.orderId ?? '')

  // ทำเครื่องหมายเตรียมเสร็จ (แคมเปญโหมดรอบเท่านั้น) · บันทึกเวลาและแจ้งลูกค้าว่ารับได้ตั้งแต่รอบที่เลือก
  if (action === 'mark_ready') {
    if (!ORDER_ID_RE.test(orderId)) return json({ error: 'รหัสออร์เดอร์ไม่ถูกต้อง' }, 400)
    const o = (await sb.from('punpang_preorder_orders').select('id,campaign_id,status,data').eq('id', orderId).maybeSingle()).data
    if (!o) return json({ error: 'ไม่พบออร์เดอร์นี้' }, 404)
    if (['cancelled', 'expired', 'delivered', 'returned'].includes(o.status)) return json({ error: 'ออร์เดอร์นี้ปิดแล้ว' }, 409)
    const cmp = (await sb.from('punpang_preorder_campaigns').select('data').eq('id', o.campaign_id).maybeSingle()).data
    if (!cmp || cmp.data?.pickupMode !== 'slot') return json({ error: 'ทำเครื่องหมายเตรียมเสร็จได้เฉพาะแคมเปญแบบเลือกรอบเวลา' }, 409)
    if (!o.data?.pickupRound) return json({ error: 'ออร์เดอร์นี้ไม่มีรอบเวลา' }, 409)
    const readyAt = new Date().toISOString()
    const up = await sb.from('punpang_preorder_orders').update({ data: { ...(o.data || {}), readyAt } }).eq('id', orderId)
    if (up.error) return json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' }, 500)
    await notifyOrderEvent(sb, orderId, 'ready')
    return json({ ok: true, result: { readyAt } })
  }

  // ข้อมูลดิบทุกออเดอร์สำหรับบัญชี (เฟส 4) · แบ่งหน้าทีละ 1000 แถวจนครบ ไม่จำกัด 200 ล่าสุดแบบรายการ
  if (action === 'accounting') {
    const PAGE = 1000
    const all: any[] = []
    for (let from = 0; ; from += PAGE) {
      const r = await sb.from('punpang_preorder_orders').select('id,code,status,created_at,data').order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (r.error) return json({ error: 'โหลดข้อมูลบัญชีไม่สำเร็จ' }, 500)
      const rows: any[] = r.data || []
      for (const x of rows) all.push({ ...(x.data || {}), id: x.id, code: x.code, status: x.status, createdAt: x.created_at })
      if (rows.length < PAGE) break
    }
    return json({ orders: all })
  }

  // รายงานสั่งล่วงหน้า: คำนวณจากออเดอร์ทั้งหมดที่เซิร์ฟเวอร์อ่านเอง (ฟังก์ชันชุดเดียวกับแอป) · ไม่รับยอดจากหน้าจอ
  if (action === 'reports') {
    const REPORTS = ['prep', 'pickup', 'ship', 'due', 'campaign', 'exceptions']
    const report = String(body.report ?? '')
    if (!REPORTS.includes(report)) return json({ error: 'ไม่รู้จักรายงาน' }, 400)
    const PAGE = 1000
    const raw: any[] = []
    for (let from = 0; ; from += PAGE) {
      const r = await sb.from('punpang_preorder_orders').select('id,code,status,campaign_id,pickup_date,customer_id,data').order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (r.error) return json({ error: 'โหลดรายงานไม่สำเร็จ' }, 500)
      const rows: any[] = r.data || []
      raw.push(...rows)
      if (rows.length < PAGE) break
    }
    const cids = [...new Set(raw.map((x) => x.customer_id).filter(Boolean))]
    const cust = cids.length ? await sb.from('punpang_customers').select('id,name').in('id', cids) : { data: [] }
    const names: Record<string, string> = {}
    for (const c of (cust.data || []) as any[]) names[c.id] = c.name ?? ''
    const retailIds = [...new Set(raw.flatMap((x) => (Array.isArray(x.data?.lines) ? x.data.lines : []).map((l: any) => String(l?.retailId ?? ''))).filter(Boolean))]
    const items = retailIds.length ? await sb.from('punpang_items').select('id,name').in('id', retailIds) : { data: [] }
    const itemName: Record<string, string> = {}
    for (const it of (items.data || []) as any[]) itemName[it.id] = it.name ?? ''
    const orders = raw.map((x) => {
      const d = x.data || {}
      const pays: any[] = Array.isArray(d.payments) ? d.payments : []
      const paid = Math.round(pays.filter((p) => p?.status === 'confirmed').reduce((a, p) => a + (Number(p.amount) || 0), 0) * 100) / 100
      return { id: x.id, code: x.code, status: x.status, campaignId: x.campaign_id, pickupDate: x.pickup_date, customerName: names[x.customer_id] ?? '', fulfillment: d.fulfillment ?? null, total: d.total ?? 0, paid, shippingFee: d.shippingFee ?? 0, shipping: d.shipping ?? null, payDueAt: d.payDueAt ?? null, lines: Array.isArray(d.lines) ? d.lines : [], returnRequest: d.returnRequest ?? null }
    })
    if (report === 'prep') return json({ ok: true, data: prepSheet(orders, { names: itemName, campaignId: body.campaignId || undefined, from: body.from || undefined, to: body.to || undefined }) })
    if (report === 'pickup') return json({ ok: true, data: pickupList(orders, { date: String(body.date ?? '') }) })
    if (report === 'ship') return json({ ok: true, data: shipQueue(orders) })
    if (report === 'due') return json({ ok: true, data: dueList(orders, { nowMs: Date.now() }) })
    if (report === 'campaign') return json({ ok: true, data: campaignSummary(orders, { campaignId: String(body.campaignId ?? '') }) })
    return json({ ok: true, data: exceptionList(orders) })
  }

  if (action === 'list') {
    const r = await sb.from('punpang_preorder_orders').select('*').order('updated_at', { ascending: false }).limit(200)
    const rows: any[] = r.data || []
    const ids = [...new Set(rows.map((x) => x.customer_id).filter(Boolean))]
    const cust = ids.length ? await sb.from('punpang_customers').select('id,name').in('id', ids) : { data: [] }
    const names: Record<string, string> = {}
    for (const c of (cust.data || []) as any[]) names[c.id] = c.name ?? ''
    return json({ orders: rows.map((o) => staffView(o, names)) })
  }

  if (!ORDER_ID_RE.test(orderId)) return json({ error: 'รหัสออร์เดอร์ไม่ถูกต้อง' }, 400)
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))
  // ค่าไปรษณีย์จริงที่ร้านจ่าย (บาท): ไม่กรอก = 0 · ค่าอื่นที่ไม่ใช่ตัวเลข 0–100000 ไม่ผ่าน (ฐานข้อมูลตรวจซ้ำ)
  const postageOf = (v: unknown) => (v === undefined || v === null || v === '' ? 0 : Number(v))
  const calls: Record<string, () => Promise<{ data: any; error: any }>> = {
    set_shipping: async () => await sb.rpc('punpang_preorder_set_shipping', { p_order: orderId, p_carrier: String(body.carrier ?? ''), p_tracking: String(body.trackingNo ?? ''), p_postage: postageOf(body.postage) }),
    mark_delivered: async () => await sb.rpc('punpang_preorder_mark_delivered', { p_order: orderId }),
    record_return: async () => await sb.rpc('punpang_preorder_record_return', { p_order: orderId, p_reason: String(body.reason ?? '') }),
    refund_return: async () => await sb.rpc('punpang_preorder_refund_return', { p_order: orderId, p_refunds: Array.isArray(body.refunds) ? body.refunds : [] }),
    reship: async () => await sb.rpc('punpang_preorder_reship', { p_order: orderId, p_new_fee: num(body.newFee) }),
    record_payment: async () => await sb.rpc('punpang_preorder_record_payment', { p_order: orderId, p_amount: num(body.amount), p_method: String(body.method ?? ''), p_ref: body.ref ? String(body.ref) : null }),
    extend: async () => await sb.rpc('punpang_preorder_extend', { p_order: orderId, p_new_due: String(body.newDue ?? '') }),
    cancel: async () => await sb.rpc('punpang_preorder_cancel', { p_order: orderId, p_refunds: Array.isArray(body.refunds) ? body.refunds : [] }),
  }
  const fn = calls[action]
  if (!fn) return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)
  const r = await fn()
  if (r.error) return json({ error: 'ทำรายการไม่สำเร็จ กรุณาลองใหม่' }, 500)
  if (r.data?.error) return json({ error: r.data.error === 'past_last' ? 'ขยายเวลาเกินวันชำระสุดท้ายของแคมเปญไม่ได้' : r.data.error }, 409)
  // แจ้งลูกค้าหลังทำรายการสำเร็จเท่านั้น · ส่งไม่สำเร็จไม่กระทบผลลัพธ์
  // แจ้งลูกค้าหลังทำรายการสำเร็จเท่านั้น · ส่งไม่สำเร็จไม่กระทบผลลัพธ์
  const sumRefunds = () => (Array.isArray(body.refunds) ? body.refunds.reduce((a: number, x: any) => a + (Number(x?.amount) || 0), 0) : 0)
  const NOTIFY: Record<string, { event: string; key: () => string; refund?: () => number }> = {
    set_shipping: { event: 'shipped', key: () => '' },
    mark_delivered: { event: 'delivered', key: () => '' },
    extend: { event: 'extended', key: () => String(r.data?.payDueAt ?? '') },
    cancel: { event: 'cancelled', key: () => '', refund: sumRefunds },
    record_payment: { event: 'paid', key: () => String(r.data?.paymentId ?? Date.now()) },
    refund_return: { event: 'refunded', key: () => String(Date.now()), refund: sumRefunds },
  }
  if (NOTIFY[action]) {
    const n = NOTIFY[action]
    await notifyOrderEvent(sb, orderId, n.event, { refund: n.refund ? n.refund() : 0, key: n.key() })
  }
  return json({ ok: true, result: r.data })
}))
