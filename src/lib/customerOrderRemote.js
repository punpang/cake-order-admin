import { getSupabase } from './supabase'
import { fetchRemoteLink, injectRemoteLink } from './remoteLink'
import { rowToOrder } from './ordersSync'
import { callAuth, readSessionToken, injectBundle } from './customerRemote'

// การกระทำของลูกค้าบนออร์เดอร์ที่โหลดมาจากเซิร์ฟเวอร์ (ธง _remote) → Edge Function 'customer-order'
// ctx = { token } (ลิงก์ออร์เดอร์) หรือ { orderId } (ล็อกอิน แนบเซสชัน) · สำเร็จแล้วโหลดออร์เดอร์ล่าสุดกลับมาใส่ db
const NET = 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'
export async function remoteOrderAction(db, ctx, action, body = {}) {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เปิดใช้งานออนไลน์' }
  const auth = ctx?.token ? { token: ctx.token } : { session: readSessionToken(), orderId: ctx?.orderId }
  if (!ctx?.token && !auth.session) return { error: 'กรุณาเข้าสู่ระบบ' }
  let r
  try { r = await c.functions.invoke('customer-order', { body: { action, ...auth, ...body } }) } catch { return { error: NET } }
  if (r.error) {
    let d = null
    try { d = await r.error.context?.json() } catch { d = null }
    // ยังไม่ยินยอม (ก่อนชำระ) → ส่งรายการที่ต้องยินยอมกลับไปให้หน้าจอถาม
    return { error: d?.error || NET, ...(d?.consentNeeded ? { consentNeeded: d.consentNeeded } : {}) }
  }
  if (!r.data?.ok) return { error: r.data?.error || NET }
  // โหลดออร์เดอร์ล่าสุด (ล้มเหลวไม่ถือว่าทำรายการไม่สำเร็จ แต่บอก stale = ข้อมูลบนจอยังไม่ตรงเซิร์ฟเวอร์)
  let stale = false
  try {
    if (ctx?.token) { const d = await fetchRemoteLink(ctx.token); if (d?.order) injectRemoteLink(db, d, rowToOrder); else stale = true }
    else { const s = await callAuth('session', { session: auth.session }); if (s.ok && s.customer) injectBundle(db, s); else stale = true }
  } catch { stale = true }
  return { ok: true, paymentId: r.data.paymentId, ...(r.data.qrRef ? { qrRef: r.data.qrRef, amount: r.data.amount } : {}), ...(r.data.autoConfirmed ? { autoConfirmed: true } : {}), ...(stale ? { stale: true } : {}) }
}

// อ่าน QR ในสลิปที่ลูกค้าแนบ (เซิร์ฟเวอร์ตอบ { qr }) · ไม่มีการเปลี่ยนแปลงออร์เดอร์ จึงไม่โหลดออร์เดอร์ใหม่
export async function remoteReadSlip(ctx, slip) {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เปิดใช้งานออนไลน์' }
  const auth = ctx?.token ? { token: ctx.token } : { session: readSessionToken(), orderId: ctx?.orderId }
  if (!ctx?.token && !auth.session) return { error: 'กรุณาเข้าสู่ระบบ' }
  let r
  try { r = await c.functions.invoke('customer-order', { body: { action: 'read_slip', ...auth, slip } }) } catch { return { error: NET } }
  if (r.error) {
    let d = null
    try { d = await r.error.context?.json() } catch { d = null }
    return { error: d?.error || NET }
  }
  if (!r.data?.ok) return { error: r.data?.error || NET }
  return { ok: true, qr: r.data.qr || { kind: 'none' }, fields: r.data.fields || null }
}

// แชทกับร้าน และแจ้งเตือนของเครื่อง (เฉพาะลูกค้าที่ล็อกอิน) → Edge Function 'customer-order' · action = chat_list | chat_send | push_register
export async function remoteChat(action, body = {}) {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เปิดใช้งานออนไลน์' }
  const session = readSessionToken()
  if (!session) return { error: 'กรุณาเข้าสู่ระบบ' }
  let r
  try { r = await c.functions.invoke('customer-order', { body: { action, session, ...body } }) } catch { return { error: NET } }
  if (r.error) {
    let d = null
    try { d = await r.error.context?.json() } catch { d = null }
    return { error: d?.error || NET }
  }
  return r.data || {}
}
