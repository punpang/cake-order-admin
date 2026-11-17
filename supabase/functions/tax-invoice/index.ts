// Edge Function tax-invoice: ลูกค้าขอ/แก้ใบกำกับภาษีเต็มรูปเอง
// ยืนยันตัวตน 2 แบบ: เซสชันลูกค้า (state / request / edit) หรือ token ลิงก์ออร์เดอร์ (view = ดูเอกสารอย่างเดียว)
// ใช้ service role จึงตรวจสิทธิ์ เงื่อนไข ยอด และข้อมูลผู้ขายเองทั้งหมด · ยอดใช้ orderTotals ชุดเดียวกับแอป (_shared/schedlib/taxInvoice.js)
// ข้อมูลผู้ขายอ่านจากตั้งค่าร้านฝั่งเซิร์ฟเวอร์เท่านั้น (ไม่เปิดสาธารณะ) · เลขที่ใบออกโดยฐานข้อมูล (trigger ของ punpang_acct_invoices)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsWrap } from '../_shared/cors.ts'
import { createLimiter } from '../_shared/ratelimit.ts'
import { buildCreditNote, buildInvoice, cleanBuyer, customerInvoiceState, customerIssueBlock } from '../_shared/schedlib/taxInvoice.js'

const DAY = 86400000
const enc = new TextEncoder()
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const randHex = (n = 6) => hex(crypto.getRandomValues(new Uint8Array(n)))
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const days = (v: unknown, d: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 1 && x <= 365 ? x : d }
const NOT_FOUND = 'ไม่พบออร์เดอร์'
const LINK_GONE = 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว'
const SAVE_FAIL = 'บันทึกใบกำกับภาษีไม่สำเร็จ กรุณาลองใหม่'
const limited = createLimiter()

// วันนี้ตามเวลาไทย (YYYY-MM-DD) · เซิร์ฟเวอร์ใช้ UTC จึงบวก 7 ชั่วโมง
const bangkokToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
const newId = () => `ti${Date.now().toString(36)}${randHex()}`

type Doc = Record<string, any> & { id: string; no: string }

// ใบและใบลดหนี้ทั้งหมดของออร์เดอร์ (ข้อมูลเก็บในคอลัมน์ data รูปแบบเดียวกับหลังบ้าน)
async function loadInvoices(sb: any, orderId: string): Promise<Doc[]> {
  const r = await sb.from('punpang_acct_invoices').select('id,no,data').eq('order_id', orderId)
  if (r.error) throw new Error(`invoices: ${r.error.message}`)
  return (r.data || []).map((x: any) => ({ ...(x.data || {}), id: x.id, no: x.no }))
}

// ออร์เดอร์ของลูกค้าคนนี้ · ไม่พบ / ไม่ใช่ของลูกค้า / ร่าง = null
async function loadOrder(sb: any, orderId: string, customerId: string) {
  const r = await sb.from('punpang_orders').select('id,code,customer_id,status,data').eq('id', orderId).eq('customer_id', customerId).maybeSingle()
  if (r.error) throw new Error(`order: ${r.error.message}`)
  const row = r.data
  if (!row || row.status === 'draft') return null
  const d = row.data || {}
  return { ...d, id: row.id, code: row.code, status: row.status, customerId: row.customer_id, items: d.items || [], payments: d.payments || [] }
}

// ข้อมูล VAT ของร้าน (ตั้งค่าร้าน → VAT) อ่านจากฝั่งเซิร์ฟเวอร์เท่านั้น
async function shopVat(sb: any): Promise<Record<string, any>> {
  const r = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  return r.data?.data?.v?.vat ?? {}
}

// ลิงก์ออร์เดอร์ (กติกาเดียวกับ customer-order): ไม่ถูกเพิกถอน และยังไม่หมดอายุตามนโยบายลิงก์ของร้าน
async function linkOrderId(sb: any, token: string): Promise<string | null> {
  const lr = await sb.from('punpang_records').select('id,data').eq('collection', 'orderLinks').eq('data->>tokenHash', await sha256Hex(`orderlink:${token}`)).maybeSingle()
  if (lr.error || !lr.data) return null
  const link = lr.data.data as Record<string, any>
  const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  const pol = shop.data?.data?.v?.linkPolicy || {}
  const idle = days(pol.idleDays, 7)
  const never = days(pol.neverOpenedDays, 30)
  const expires = link.lastOpenedAt ? new Date(link.lastOpenedAt).getTime() + idle * DAY : new Date(link.createdAt).getTime() + never * DAY
  if (link.revokedAt || !(Date.now() <= expires)) return null
  return String(link.orderId)
}

// จดจำข้อมูลผู้ซื้อไว้ใช้ครั้งหน้า (ชุดเดียวต่อลูกค้า · ทับของเดิม)
async function rememberTax(sb: any, customerId: string, buyer: Record<string, string>) {
  const r = await sb.from('punpang_customers').select('data').eq('id', customerId).maybeSingle()
  if (!r.data) return
  await sb.from('punpang_customers').update({ data: { ...(r.data.data || {}), tax: buyer } }).eq('id', customerId)
}

// เพิ่มใบหรือใบลดหนี้ 1 ใบ · คืนเลขที่ที่ฐานข้อมูลออกให้ · null = บันทึกไม่สำเร็จ
async function insertDoc(sb: any, id: string, kind: 'invoice' | 'credit', orderId: string, date: string, data: Record<string, any>): Promise<string | null> {
  const r = await sb.from('punpang_acct_invoices').insert({ id, kind, order_id: orderId, doc_date: date, no: '', year: 0, seq: 0, data }).select('no').single()
  if (r.error || !r.data) return null
  return String(r.data.no)
}

Deno.serve(corsWrap(async (req) => {
  if (req.method !== 'POST') return json({ error: 'ใช้เมธอด POST' }, 405)
  try {
    const b = (await req.json().catch(() => null)) as Record<string, any> | null
    if (!b) return json({ error: 'คำขอไม่ถูกต้อง' }, 400)
    const action = String(b.action || '')
    if (!['state', 'view', 'request', 'edit'].includes(action)) return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const today = bangkokToday()

    // ---------- ลิงก์ออร์เดอร์: ดูเอกสารอย่างเดียว ----------
    if (action === 'view') {
      const token = String(b.token ?? '')
      if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json({ error: LINK_GONE }, 404)
      const orderId = await linkOrderId(sb, token)
      if (!orderId) return json({ error: LINK_GONE }, 404)
      const history = (await loadInvoices(sb, orderId)).sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')))
      return json({ ok: true, history })
    }

    // ---------- เซสชันลูกค้า (เฉพาะออร์เดอร์ของตัวเอง) ----------
    const session = String(b.session ?? '')
    if (!/^[a-f0-9]{64}$/.test(session)) return json({ error: 'กรุณาเข้าสู่ระบบก่อน' }, 401)
    const sess = (await sb.from('punpang_customer_sessions').select('customer_id,expires_at').eq('token_hash', await sha256Hex(`custsess:${session}`)).maybeSingle()).data
    if (!sess || new Date(sess.expires_at).getTime() < Date.now()) return json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401)
    const customerId = String(sess.customer_id)
    const orderId = String(b.orderId ?? '')
    const order = orderId ? await loadOrder(sb, orderId, customerId) : null
    if (!order) return json({ error: NOT_FOUND }, 404)
    const invoices = await loadInvoices(sb, orderId)

    if (action === 'state') return json({ ok: true, state: customerInvoiceState(order, invoices, today) })

    // ---------- ขอ/แก้ใบ ----------
    if (limited(`tax:${customerId}`, 20, 600_000)) return json({ error: 'ทำรายการถี่เกินไป กรุณารอสักครู่' }, 429)
    const edit = action === 'edit'
    const buyer = cleanBuyer(b.buyer)
    const seller = await shopVat(sb)
    const block = customerIssueBlock(order, invoices, buyer, seller, today, { edit })
    if (block) return json({ error: block }, 400)

    const by = `customer:${customerId}`
    const createdAt = new Date().toISOString()
    let rev = 0
    if (edit) {
      // customerIssueBlock รับรองแล้วว่ามีใบปัจจุบันและยังแก้ได้
      const cur = invoices.find((i) => i.type === 'invoice' && !i.voidedBy) as Doc
      rev = (Number(cur.rev) || 0) + 1
      const cnId = newId()
      const cn = buildCreditNote({ inv: cur, id: cnId, date: today, reason: 'ลูกค้าแก้ไขข้อมูลผู้ซื้อ', by, createdAt })
      if (!(await insertDoc(sb, cnId, 'credit', order.id, today, cn))) return json({ error: SAVE_FAIL }, 500)
      const vo = await sb.from('punpang_acct_invoices').update({ data: { ...cur, voidedBy: cnId } }).eq('id', cur.id)
      if (vo.error) return json({ error: SAVE_FAIL }, 500)
    }
    const id = newId()
    const inv = buildInvoice({ order, seller, buyer, id, by, rev, date: today, createdAt })
    const no = await insertDoc(sb, id, 'invoice', order.id, today, inv)
    if (!no) return json({ error: edit ? 'ออกใบใหม่ไม่สำเร็จ ใบเดิมถูกยกเลิกแล้ว กรุณาขอใบใหม่อีกครั้ง' : SAVE_FAIL }, 500)
    if (b.remember === true) await rememberTax(sb, customerId, buyer)
    const after = await loadInvoices(sb, orderId)
    return json({ ok: true, invoice: { ...inv, no }, state: customerInvoiceState(order, after, today) })
  } catch (e) {
    console.error('tax-invoice', e)
    return json({ error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่' }, 500)
  }
}))
