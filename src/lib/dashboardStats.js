// ตัวชี้วัดหน้า dashboard ของระบบหลังบ้าน · ฟังก์ชันล้วนจากข้อมูลที่โหลดอยู่แล้วในเบราว์เซอร์ (ไม่ยิงคำขอเพิ่ม)
// หมายเหตุ: วันนัดรับ (pickupAt) เก็บเป็นเวลาท้องถิ่นรูปแบบ YYYY-MM-DDTHH:MM จึงตัดวันจากตัวอักษรตรง ๆ · เวลาที่เป็น ISO (createdAt/at) แปลงเป็นวันไทย
import { thaiDay, shiftDay } from './aiStats.js'

const CLOSED = ['delivered', 'cancelled']
const pickupDay = (s) => String(s || '').slice(0, 10)

// คืนค่าตัวชี้วัดทั้งหมด · ส่วนที่ผู้ใช้ไม่มีสิทธิ์เห็น (เช่นแชท) จะเป็น null
export function computeDashboard({ now = new Date(), orders = [], chats = null, quotes = [], photoRequests = [], reviews = [], deletionRequests = [] }) {
  const today = thaiDay(now.toISOString())
  const weekFrom = shiftDay(today, -6)
  const inWeek = (iso) => { if (!iso) return false; const d = thaiDay(iso); return d >= weekFrom && d <= today }

  // ออร์เดอร์ที่ยังไม่ปิด แยกตามสถานะ · นัดรับวันนี้
  const open = orders.filter((o) => o && !CLOSED.includes(o.status))
  const byStatus = {}
  for (const o of open) byStatus[o.status] = (byStatus[o.status] || 0) + 1
  const pickupToday = orders.filter((o) => o && o.status !== 'cancelled' && pickupDay(o.pickupAt) === today).length

  // ลูกค้าใหม่ = ลูกค้าที่มีออร์เดอร์แรกในช่วง 7 วัน (ลูกค้าไม่มีวันที่สร้างในข้อมูล)
  const firstOrder = new Map()
  for (const o of orders) {
    if (!o?.customerId || !o.createdAt) continue
    const prev = firstOrder.get(o.customerId)
    if (!prev || o.createdAt < prev) firstOrder.set(o.customerId, o.createdAt)
  }
  let newCustomers7d = 0
  for (const iso of firstOrder.values()) if (inWeek(iso)) newCustomers7d++

  // แชท: นับลูกค้า Facebook (ผู้ที่เคยทัก) · รอตอบ = ข้อความล่าสุดเป็นของลูกค้า หรือยังมีข้อความที่พนักงานยังไม่อ่าน
  let chatCounts = null
  if (chats) {
    const fb = chats.filter((c) => c?.channel === 'facebook')
    // ทักใหม่ = ข้อความแรกที่เป็นของลูกค้า (แชทที่พนักงานทักก่อนไม่นับ)
    const firstAt = (c) => (Array.isArray(c.messages) ? c.messages.find((m) => m?.from === 'customer')?.at : null) || null
    const waiting = (c) => {
      const msgs = Array.isArray(c.messages) ? c.messages : []
      const last = msgs[msgs.length - 1]
      return Number(c.unreadStaff) > 0 || last?.from === 'customer'
    }
    chatCounts = {
      facebookTotal: fb.length,
      facebookNew7d: fb.filter((c) => inWeek(firstAt(c))).length,
      awaitingReply: chats.filter(waiting).length,
      awaitingFacebook: fb.filter(waiting).length,
    }
  }

  // งานค้างที่ต้องตรวจ
  const pending = {
    paymentReported: orders.filter((o) => o?.status === 'payment_reported').length,
    quotes: quotes.filter((q) => q?.status === 'pending').length,
    photoRequests: photoRequests.filter((r) => r?.status === 'pending').length,
    reviews: reviews.filter((r) => r?.status === 'pending').length,
    deletionRequests: deletionRequests.filter((r) => r?.status === 'pending').length,
  }

  return {
    today,
    weekFrom,
    orders: { open: open.length, byStatus, pickupToday, newCustomers7d },
    chats: chatCounts,
    pending,
  }
}
