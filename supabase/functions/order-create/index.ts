import { corsWrap } from '../_shared/cors.ts'
// Edge Function: สร้างออร์เดอร์ใหม่ — เซิร์ฟเวอร์คิดราคาเองจากแคตาล็อก แล้วบันทึกแถวออร์เดอร์ (แอปไม่เขียนออร์เดอร์ใหม่ตรงอีกแล้ว)
// - ตรวจสิทธิ์: พนักงานที่ active และมีสิทธิ์ createOrder (หรือ manage) · ยอดปรับราคาต้องมีสิทธิ์ adjustPrice
// - ตรรกะราคาและกติกาเดิมของ trigger อยู่ใน _shared/schedlib/orderCreate.js (ชุดเดียวกับแอป)
// - บันทึกด้วยบทบาทบริการ จึงตรวจกติกาที่ trigger เคยตรวจซ้ำที่นี่ (คะแนน/คูปอง/ออร์เดอร์จากใบเสนอ)
// ดู docs/security.md (บัค "ราคาต่อรายการตอนสร้างออร์เดอร์") และ migration 20261117140000 (ปิดการ INSERT ตรงจากแอป)
import { buildOrderFromDraft, orderRowOf, hasPerm, orderCodeOk, ORDER_ID_RE } from '../_shared/schedlib/orderCreate.js'
import { loadCatalog } from '../_shared/catalog.ts'
import { modeOf, restProfileHeaders } from '../_shared/mode.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const SERVICE_HEADERS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

// พนักงานที่ล็อกอินอยู่ (โทเค็นจากแอป) และ active จริง
async function staffOf(token: string): Promise<{ id: string; perms: string[] } | null> {
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  if (!u.ok) return null
  const user = await u.json()
  if (!user?.id) return null
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,active,perms`, { headers: SERVICE_HEADERS })
  const rows = r.ok ? await r.json() : []
  const s = Array.isArray(rows) ? rows[0] : null
  if (!s || s.active !== true) return null
  return { id: s.user_id, perms: Array.isArray(s.perms) ? s.perms : [] }
}

async function rest(path: string, rh: Record<string, string> = {}): Promise<any[] | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...SERVICE_HEADERS, ...rh } })
  if (!r.ok) return null
  const rows = await r.json()
  return Array.isArray(rows) ? rows : null
}

// ตรรกะเดียวกับ trigger punpang_orders_insert_guard (ผ่านฟังก์ชันเจ้าของ punpang__quote_check)
async function quoteCheck(order: any, quoteId: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/punpang__quote_check`, {
    method: 'POST',
    headers: { ...SERVICE_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_quote: quoteId, p_order: order.id, p_customer: order.customerId ?? null,
      p_items: order.items, p_vat: order.vat ?? null, p_shipping: Number(order.shippingFee) || 0,
    }),
  })
  if (!r.ok) return 'error'
  return String(await r.json())
}

const QUOTE_ERR: Record<string, [number, string]> = {
  not_found: [422, 'ไม่พบใบเสนอ'],
  not_ready: [409, 'ใบเสนอนี้ยังไม่พร้อมแปลงเป็นออร์เดอร์'],
  converted: [409, 'ใบเสนอนี้ถูกแปลงเป็นออร์เดอร์แล้ว'],
  customer: [422, 'ลูกค้าไม่ตรงกับใบเสนอ'],
  items: [422, 'รายการสินค้าไม่ตรงกับใบเสนอ'],
  vat: [422, 'VAT ไม่ตรงกับใบเสนอ'],
  shipping: [422, 'ค่าส่งไม่ตรงกับใบเสนอ'],
}

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'ไม่รองรับคำขอนี้' }, 405)
  if (!SUPABASE_URL || !ANON || !SERVICE) return json({ error: 'เซิร์ฟเวอร์ยังตั้งค่าไม่ครบ' }, 500)

  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')
  const who = m ? await staffOf(m[1]) : null
  if (!who) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  if (!hasPerm(who.perms, 'createOrder')) return json({ error: 'บทบาทนี้สร้างออร์เดอร์ไม่ได้' }, 403)
  const mode = modeOf(req)
  const rh = restProfileHeaders(mode) // โหมดทดสอบ: เขียนในสำเนาข้อมูลทดสอบเท่านั้น

  let body: any
  try { body = await req.json() } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400) }
  const id = typeof body?.id === 'string' ? body.id : ''
  const code = typeof body?.code === 'string' ? body.code : ''
  if (!ORDER_ID_RE.test(id) || !orderCodeOk(code, mode === 'test')) return json({ error: 'รหัสหรือเลขออร์เดอร์ไม่ถูกต้อง' }, 422)
  const chatId = typeof body?.chatId === 'string' && body.chatId ? body.chatId : null
  if (chatId && !ID_RE.test(chatId)) return json({ error: 'ไม่พบแชท' }, 404)
  const quoteId = typeof body?.quoteId === 'string' && body.quoteId ? body.quoteId : null
  if (quoteId && !ID_RE.test(quoteId)) return json({ error: 'ไม่พบใบเสนอ' }, 404)

  const nowMs = Date.now()
  const common = {
    id, code, nowMs, perms: who.perms, asDraft: body?.asDraft === true, chatId, test: mode === 'test',
    by: typeof body?.by === 'string' ? body.by : '',
    occasionKind: typeof body?.occasionKind === 'string' ? body.occasionKind : '',
    occasionConsent: body?.occasionConsent === true,
  }

  let built: any
  if (quoteId) {
    // ออร์เดอร์จากใบเสนอ: ใช้ราคาที่เซิร์ฟเวอร์คิดไว้ตอนส่งใบเสนอ ไม่รับรายการจากเครื่อง
    const qs = await rest(`punpang_quotes?id=eq.${encodeURIComponent(quoteId)}&select=id,chat_id,customer_id,status,order_id,data`, rh)
    if (!qs) return json({ error: 'อ่านใบเสนอไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)
    const q = qs[0]
    if (!q) return json({ error: 'ไม่พบใบเสนอ' }, 422)
    if (chatId && q.chat_id !== chatId) return json({ error: 'ใบเสนอนี้ไม่ใช่ของแชทนี้' }, 422)
    if (q.order_id && q.order_id !== id) return json({ error: 'ใบเสนอนี้ถูกแปลงเป็นออร์เดอร์แล้ว' }, 409)
    built = buildOrderFromDraft({ ...common, quotePayload: q.data?.payload ?? null, customerId: q.customer_id ?? null, quoteId })
    if (built.ok) {
      const qc = await quoteCheck(built.order, quoteId)
      if (qc !== 'ok') {
        const [status, msg] = QUOTE_ERR[qc] ?? [502, 'ตรวจใบเสนอไม่สำเร็จ ลองใหม่อีกครั้ง']
        return json({ error: msg, code: qc }, status)
      }
    }
  } else {
    // ออร์เดอร์ปกติ: คิดราคาทั้งหมดที่เซิร์ฟเวอร์จากแคตาล็อก
    const customerId = typeof body?.draft?.customerId === 'string' ? body.draft.customerId : ''
    if (!ID_RE.test(customerId)) return json({ error: 'ต้องเลือกลูกค้า' }, 422)
    const cs = await rest(`punpang_customers?id=eq.${encodeURIComponent(customerId)}&select=id,deleted`, rh)
    if (!cs) return json({ error: 'อ่านข้อมูลลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)
    if (!cs.length || cs[0].deleted) return json({ error: 'ไม่พบลูกค้า' }, 422)
    const catalog = await loadCatalog(SUPABASE_URL, SERVICE_HEADERS)
    if (!catalog) return json({ error: 'อ่านแคตาล็อกไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)
    built = buildOrderFromDraft({ ...common, draft: body.draft, customerId, catalog })
  }

  if (!built.ok) {
    const status = built.kind === 'forbidden' ? 403 : 422
    return json({ error: built.error, code: built.kind || 'invalid' }, status)
  }

  const row = orderRowOf(built.order)
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/punpang_orders`, {
    method: 'POST',
    headers: { ...SERVICE_HEADERS, ...rh, 'content-type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([row]),
  })
  if (ins.ok) {
    const rows = await ins.json()
    return json({ row: Array.isArray(rows) ? rows[0] : rows })
  }
  const err = await ins.json().catch(() => ({}))
  const msg = String(err?.message || '')
  if (ins.status === 409 || err?.code === '23505') {
    // แถวเดิมมีอยู่แล้ว (เช่น ส่งซ้ำหลังเครือข่ายขาด) → แอปแก้แถวเดิมแทน · เลขซ้ำ → แอปออกเลขใหม่
    if (/pkey/.test(msg)) return json({ error: 'ออร์เดอร์นี้บันทึกแล้ว', code: 'exists' }, 409)
    return json({ error: 'เลขออร์เดอร์ซ้ำ', code: 'code' }, 409)
  }
  if (err?.code === '23503') return json({ error: 'ข้อมูลลูกค้ายังไม่พร้อม ลองใหม่อีกครั้ง', code: 'fk' }, 409)
  return json({ error: 'บันทึกออร์เดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)
}))
