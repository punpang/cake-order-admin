import { getSupabase } from './supabase'

// ลิงก์ออร์เดอร์ข้ามเครื่อง (โหมด Supabase): ลูกค้าเปิดลิงก์ในเบราว์เซอร์ของตัวเอง → ถาม Edge Function 'order-link'
// ได้ข้อมูลออร์เดอร์ที่ตัดข้อมูลภายในแล้ว → ใส่ในหน่วยความจำของเบราว์เซอร์นี้ (ดูอย่างเดียว · ไม่มีการเขียนกลับ)
// ออร์เดอร์ที่ได้มาจากทางนี้ติดธง _remote → การแจ้งชำระ/ขอขยายเวลา/ขอไม่เผยแพร่รูปไปทำที่เซิร์ฟเวอร์ (customer-order)
export async function fetchRemoteLink(token, { refresh = false } = {}) {
  const c = await getSupabase()
  if (!c) return null // ไม่ได้เปิด Supabase
  try {
    const r = await c.functions.invoke('order-link', { body: { token, refresh } })
    if (r.error) {
      const st = r.error.context?.status
      if (st === 429) return { error: 'ลองบ่อยเกินไป กรุณารอสักครู่', blocked: true }
      // ไม่มีสถานะ (เครือข่ายล่ม/ถึงเซิร์ฟเวอร์ไม่ได้) หรือเซิร์ฟเวอร์ผิดพลาด (5xx) = ยังไม่รู้ว่าลิงก์ใช้ได้ไหม → ให้ลองใหม่ ไม่ใช่ "ลิงก์หมดอายุ"
      if (!Number.isInteger(st) || st >= 500) return { netError: true }
      return { error: null }
    }
    return r.data?.order ? r.data : { error: null }
  } catch { return { netError: true } }
}

// ใส่ข้อมูลลง db (แทนที่ของเดิมที่ id เดียวกัน) · rowToOrder แปลงแถวเป็นออร์เดอร์ของแอป
export function injectRemoteLink(db, data, rowToOrder) {
  const o = { ...rowToOrder(data.order), _remote: true, _payInfo: data.shop?.payment || null, _depositPercent: Number(data.shop?.depositPercent) || 0 } // ช่องทางรับชำระของร้าน (เครื่องลูกค้าไม่มีข้อมูลร้าน)
  const put = (list, item) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list.splice(i, 1, item); else list.push(item) }
  put(db.orders, o)
  if (data.customer && !db.customers.some((c) => c.id === data.customer.id)) db.customers.push({ id: data.customer.id, name: data.customer.name, phone: data.customer.phone || '', note: '', deleted: !!data.customer.deleted })
  put(db.orderLinks, { ...data.link })
  return o
}
