import { corsWrap } from '../_shared/cors.ts'
import { serviceDb } from '../_shared/db.ts'

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
  const calls: Record<string, () => Promise<{ data: any; error: any }>> = {
    set_shipping: async () => await sb.rpc('punpang_preorder_set_shipping', { p_order: orderId, p_carrier: String(body.carrier ?? ''), p_tracking: String(body.trackingNo ?? '') }),
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
  if (r.data?.error) return json({ error: r.data.error }, 409)
  return json({ ok: true, result: r.data })
}))
