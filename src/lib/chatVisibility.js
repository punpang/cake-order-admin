// ตรรกะการซ่อน/ปักหมุด/รอตอบของแชท (ฟังก์ชันบริสุทธิ์ ไม่แตะ store เพื่อทดสอบได้)
// - ซ่อนด้วยมือ: chat.hiddenAt · กลับมาแสดงเองเมื่อลูกค้าทักมาหลังซ่อน (lastInboundAt > hiddenAt)
// - ซ่อนอัตโนมัติ: ไม่มีความเคลื่อนไหวเกิน N ชม. (นับจากข้อความล่าสุดของทั้งสองฝั่ง) · ไม่ซ่อนถ้ายังไม่อ่าน หรือมีออร์เดอร์ค้าง
//   chat.showAt = เวลาที่พนักงานกดแสดงกลับเอง → ไม่ซ่อนอัตโนมัติซ้ำจนกว่าจะมีข้อความใหม่หลังจากนั้น
export const NO_REPLY_HOURS = 1

const HOUR = 3600e3
const ms = (at) => {
  const n = Date.parse(at)
  return Number.isFinite(n) ? n : 0
}

export const chatLastAt = (c) => ms(c.messages?.[c.messages.length - 1]?.at || c.updatedAt)

export function isManuallyHidden(c) {
  if (!c.hiddenAt) return false
  return ms(c.lastInboundAt) <= ms(c.hiddenAt)
}

export function isAutoHidden(c, { hours, now, openCount = 0 }) {
  if (!(hours > 0)) return false
  if (c.unreadStaff > 0 || openCount > 0) return false
  const last = chatLastAt(c)
  if (c.showAt && ms(c.showAt) >= last) return false
  return now - last >= hours * HOUR
}

export const isHidden = (c, opts) => isManuallyHidden(c) || isAutoHidden(c, opts)

// ลูกค้าส่งข้อความล่าสุดและยังไม่ได้รับการตอบเกินกี่ชั่วโมง
export function awaitingReply(c, now, hours = NO_REPLY_HOURS) {
  const m = c.messages?.[c.messages.length - 1]
  return !!m && m.from === 'customer' && now - ms(m.at) >= hours * HOUR
}

// ออร์เดอร์ที่ยังไม่ปิด (ไม่รวม POS) ของลูกค้า → จัดกลุ่มตาม customerId
export function openOrdersByCustomer(orders, closed = ['delivered', 'cancelled']) {
  const map = new Map()
  for (const o of orders) {
    if (!o.customerId || o.channel === 'pos' || closed.includes(o.status)) continue
    if (!map.has(o.customerId)) map.set(o.customerId, [])
    map.get(o.customerId).push(o)
  }
  return map
}

// สถานะที่แสดงข้างชื่อ: ออร์เดอร์ล่าสุดที่ยังไม่ปิด + จำนวนที่เหลือ
export function orderBadgeOf(openOrders = []) {
  if (!openOrders.length) return null
  const latest = [...openOrders].sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0]
  return { status: latest.status, more: openOrders.length - 1 }
}
