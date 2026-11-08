import { getSupabase } from './supabase'

// ลิงก์ออร์เดอร์ข้ามเครื่อง (โหมด Supabase): ลูกค้าเปิดลิงก์ในเบราว์เซอร์ของตัวเอง → ถาม Edge Function 'order-link'
// ได้ข้อมูลออร์เดอร์ที่ตัดข้อมูลภายในแล้ว → ใส่ในหน่วยความจำของเบราว์เซอร์นี้ (ดูอย่างเดียว · ไม่มีการเขียนกลับ)
// ออร์เดอร์ที่ได้มาจากทางนี้ติดธง _remote เพื่อให้ปิดการแจ้งชำระ/ขอขยายเวลา/ขอไม่เผยแพร่รูป (ยังต้องผ่าน Edge Function ในอนาคต)
export async function fetchRemoteLink(token) {
  const c = await getSupabase()
  if (!c) return null // ไม่ได้เปิด Supabase
  try {
    const r = await c.functions.invoke('order-link', { body: { token } })
    if (r.error) return { error: r.error.context?.status === 429 ? 'ลองบ่อยเกินไป กรุณารอสักครู่' : null, blocked: r.error.context?.status === 429 }
    return r.data?.order ? r.data : { error: null }
  } catch { return { error: null } }
}

// ใส่ข้อมูลลง db (แทนที่ของเดิมที่ id เดียวกัน) · rowToOrder แปลงแถวเป็นออร์เดอร์ของแอป
export function injectRemoteLink(db, data, rowToOrder) {
  const o = { ...rowToOrder(data.order), _remote: true }
  const put = (list, item) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list.splice(i, 1, item); else list.push(item) }
  put(db.orders, o)
  if (data.customer && !db.customers.some((c) => c.id === data.customer.id)) db.customers.push({ id: data.customer.id, name: data.customer.name, phone: data.customer.phone || '', line: '', note: '', deleted: !!data.customer.deleted })
  put(db.orderLinks, { ...data.link })
  return o
}
