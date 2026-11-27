import { getSupabase } from './supabase'
import { rowToOrder } from './ordersSync'

// บัญชีลูกค้าฝั่งเซิร์ฟเวอร์ (โหมด Supabase): ทุกอย่างผ่าน Edge Function 'customer-auth'
// เบราว์เซอร์เก็บเฉพาะโทเคนเซสชัน (สุ่ม 64 ตัวอักษร · ฝั่งเซิร์ฟเวอร์เก็บ hash) ไว้ใน localStorage
const KEY = 'punpang_customer_session'
export const readSessionToken = () => { try { return localStorage.getItem(KEY) || '' } catch { return '' } }
export const saveSessionToken = (t) => { try { localStorage.setItem(KEY, t) } catch { /* ข้าม */ } }
export const clearSessionToken = () => { try { localStorage.removeItem(KEY) } catch { /* ข้าม */ } }

const NET = 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'
// แลกของ/หมุนกาชาฝั่งเซิร์ฟเวอร์ (Edge Function customer-loyalty) · ตอบ { ok, customer, coupons, result } หรือ { error }
export async function callLoyalty(action, body = {}) {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เปิดใช้งานออนไลน์' }
  try {
    const r = await c.functions.invoke('customer-loyalty', { body: { action, ...body } })
    if (r.error) {
      let d = null
      try { d = await r.error.context?.json() } catch { d = null }
      return { ...(d || {}), error: d?.error || NET }
    }
    return r.data || { error: NET }
  } catch { return { error: NET } }
}

export async function callAuth(action, body = {}) {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เปิดใช้งานออนไลน์' }
  try {
    const r = await c.functions.invoke('customer-auth', { body: { action, ...body } })
    if (r.error) {
      let d = null
      try { d = await r.error.context?.json() } catch { d = null }
      return { ...(d || {}), error: d?.error || NET, status: r.error.context?.status }
    }
    return r.data || { error: NET }
  } catch { return { error: NET } }
}

const put = (list, item) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list.splice(i, 1, item); else list.push(item) }
// ใส่ข้อมูลของลูกค้าที่ล็อกอินลงหน่วยความจำของเบราว์เซอร์นี้ (ดูอย่างเดียว · ออร์เดอร์ติดธง _remote)
export function injectBundle(db, b) {
  put(db.customers, { note: '', ...b.customer })
  for (const o of b.orders || []) put(db.orders, { ...rowToOrder(o), _remote: true, _payInfo: b.shop?.payment || null })
  for (const c of b.coupons || []) put(db.coupons, c)
  for (const c of b.consents || []) put(db.consents, c)
  for (const c of b.reviews || []) put(db.reviews, c)
  for (const c of b.deletionRequests || []) put(db.deletionRequests, c)
  if (Number(b.loyalty?.pointValue) > 0) db.loyalty.pointValue = Number(b.loyalty.pointValue) // อัตราแลกของร้าน (ตรงกับฐานข้อมูล)
  if ('tier' in b) db.memberCard = b.tier?.enabled === true ? b.tier : null // ระดับสมาชิก (เซิร์ฟเวอร์เปิดให้เฉพาะโหมดใช้จริง) · ตอบกลับที่ไม่มี tier ไม่ล้างการ์ดเดิม
  return b.customer.id
}
// ออกจากระบบ: ล้างข้อมูลของลูกค้ารายนั้นออกจากหน่วยความจำ (เครื่องใช้ร่วมกัน)
export function clearBundle(db, customerId) {
  db.memberCard = null
  if (!customerId) return
  const drop = (list, f) => { for (let i = list.length - 1; i >= 0; i--) if (f(list[i])) list.splice(i, 1) }
  drop(db.orders, (o) => o._remote && o.customerId === customerId)
  drop(db.customers, (c) => c.id === customerId)
  drop(db.coupons, (c) => c.customerId === customerId)
  drop(db.consents, (c) => c.customerId === customerId)
  drop(db.reviews, (c) => c.customerId === customerId)
  drop(db.deletionRequests, (c) => c.customerId === customerId)
}
