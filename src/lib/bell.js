// กระดิ่งแจ้งเตือนในแอป (แยกจากคิวข้อความ outbox · ทำงานเสมอแม้กฎ/ช่องทางภายนอกปิด)
// ฟังก์ชันล้วน: ตารางเหตุการณ์ + ตัวกรองสิทธิ์/อ่านแล้ว · การเก็บข้อมูลอยู่ที่ store.js (db.bell)

export const BELL_MAX = 200

// ฝั่งพนักงาน: perms = มีสิทธิ์ข้อใดข้อหนึ่งจึงเห็น · to(ctx) = ลิงก์ปลายทาง · tone = สีจุด
export const BELL_STAFF = {
  team_customer_paid: { title: 'ลูกค้าแจ้งโอน', perms: ['confirmPayment', 'reportPayment'], tone: 'amber', to: () => '/admin/payments' },
  team_pay_extend_request: { title: 'ลูกค้าขอขยายเวลาชำระ', perms: ['confirmPayment', 'reportPayment'], tone: 'amber', to: () => '/admin/payments' },
  team_pay_overdue: { title: 'เกินกำหนดชำระ', perms: ['confirmPayment', 'reportPayment'], tone: 'rose', to: () => '/admin/payments' },
  team_new_order: { title: 'ออร์เดอร์ใหม่', perms: ['viewAllOrders'], tone: 'brand', to: (c) => (c.orderId ? `/admin/orders/${c.orderId}` : '/admin/orders') },
  team_approval_request: { title: 'ขออนุมัติยืนยันสั่งซื้อ', perms: ['confirmUnpaid', 'requestConfirmUnpaid'], tone: 'amber', to: (c) => (c.orderId ? `/admin/orders/${c.orderId}` : '/admin/orders') },
  team_due_soon: { title: 'งานใกล้เวลาต้องเสร็จ', perms: ['viewAllOrders', 'viewPrepOrders'], tone: 'rose', to: (c) => (c.orderId ? `/admin/orders/${c.orderId}` : '/admin/orders') },
  chat_inbound: { title: 'ข้อความใหม่จากลูกค้า', perms: ['chat'], tone: 'brand', to: (c) => (c.chatId ? `/admin/chat/${c.chatId}` : '/admin/chat') },
  notify_failed: { title: 'แจ้งลูกค้าไม่สำเร็จ', perms: ['chat', 'viewAllOrders'], tone: 'rose', to: (c) => (c.chatId ? `/admin/chat/${c.chatId}` : '/admin/chat') },
  bot_handoff: { title: 'บอทส่งต่อให้พนักงาน', perms: ['chat'], tone: 'amber', to: (c) => (c.chatId ? `/admin/chat/${c.chatId}` : '/admin/chat') },
  slip_check: { title: 'สลิปในแชทรอตรวจเอง', perms: ['chat'], tone: 'amber', to: (c) => (c.chatId ? `/admin/chat/${c.chatId}` : '/admin/chat') },
  team_photo_optout: { title: 'ลูกค้าขอไม่เผยแพร่รูป', perms: ['manage'], tone: 'amber', to: () => '/admin/settings/photo-requests' },
  deletion_request: { title: 'คำขอลบข้อมูลลูกค้า', perms: ['manage'], tone: 'amber', to: () => '/admin/settings/deletion-requests' },
  team_coupon_shown: { title: 'ลูกค้าแสดงคูปองที่ร้าน', perms: ['pos'], tone: 'brand', to: () => '/admin/pos' },
  team_vat_due: { title: 'ครบกำหนดยื่น ภ.พ.30', perms: ['acctView'], tone: 'rose', to: () => '/admin/accounting' },
  team_expense_missing: { title: 'ค่าใช้จ่ายที่ยังไม่ได้บันทึก', perms: ['acctView'], tone: 'amber', to: () => '/admin/accounting' },
  team_installment_due: { title: 'งวดผ่อนชำระใกล้/เลยกำหนด', perms: ['acctView'], tone: 'amber', to: () => '/admin/accounting' },
}

// ฝั่งลูกค้า (เฉพาะที่ผูกกับลูกค้า) · อวยพรวันเกิดไม่ขึ้นกระดิ่ง
export const BELL_CUSTOMER = {
  order_created: { title: 'รับออร์เดอร์แล้ว' },
  payment_requested: { title: 'แจ้งยอดชำระ' },
  payment_confirmed: { title: 'ยืนยันการชำระแล้ว' },
  order_confirmed: { title: 'ยืนยันการสั่งซื้อแล้ว' },
  prepared: { title: 'เตรียมสินค้าเสร็จแล้ว' },
  payment_reminder: { title: 'เตือนชำระเงิน' },
  pickup_reminder: { title: 'เตือนนัดรับ' },
  shipping: { title: 'ออกจัดส่งแล้ว' },
  delivered: { title: 'ส่งมอบแล้ว' },
  cancelled: { title: 'ยกเลิกออร์เดอร์' },
  order_refunded: { title: 'คืนเงินแล้ว' },
  order_refund_cancelled: { title: 'ยกเลิกการคืนเงิน' },
  photo_ready: { title: 'มีรูปงานเสร็จให้ดู' },
  photo_optout_done: { title: 'ลบรูปตามคำขอแล้ว' },
  photo_optout_rejected: { title: 'ร้านไม่อนุมัติคำขอไม่เผยแพร่รูป' },
  coupon_refunded: { title: 'ร้านคืนคะแนนจากคูปอง' },
  points_expiring: { title: 'คะแนนใกล้หมดอายุ', marketing: true },
}

const v = (vars, k) => (vars && vars[k] ? String(vars[k]) : '')
// ข้อความรายละเอียดสั้น ๆ จากตัวแปรของเหตุการณ์
export function bellText(event, vars = {}) {
  const code = v(vars, 'เลขออร์เดอร์')
  const who = v(vars, 'ชื่อลูกค้า')
  const head = [code, who].filter(Boolean).join(' · ')
  switch (event) {
    case 'team_customer_paid': return `${head} · ยอด ${v(vars, 'ยอดที่แจ้ง')}`.trim()
    case 'team_pay_extend_request':
    case 'team_pay_overdue': return `${head} · ชำระก่อน ${v(vars, 'ชำระก่อน')}`.trim()
    case 'team_coupon_shown': return `${who} · ${v(vars, 'รายการ')}`.trim()
    case 'team_vat_due': return `ภาษีเดือน ${v(vars, 'เดือนภาษี')} · ยื่นออนไลน์ภายใน ${v(vars, 'ชำระก่อน')}`
    case 'team_expense_missing': return `${v(vars, 'รายการ')} · เดือน ${v(vars, 'เดือนภาษี')}`
    case 'team_installment_due': return `${v(vars, 'รายการ')} · งวด ${v(vars, 'งวด')} · ${v(vars, 'วันที่')}`
    case 'payment_requested': return `${code} · ยอด ${v(vars, 'ยอดที่แจ้ง')} · ชำระก่อน ${v(vars, 'ชำระก่อน')}`
    case 'order_refund_cancelled':
    case 'order_refunded': return `${code} · คืน ${v(vars, 'ยอดที่แจ้ง')}`
    case 'points_expiring': return `คะแนน ${v(vars, 'คะแนน')} แต้มใกล้หมดอายุ`
    case 'coupon_refunded': return `${v(vars, 'รายการ')} · คืน ${v(vars, 'คะแนน')} คะแนน`
    case 'pickup_reminder': return `${code} · นัด ${v(vars, 'วันนัด')} ${v(vars, 'เวลานัด')}`
    default: return head || code
  }
}

// รายการที่พนักงานคนนี้มองเห็น (ตามสิทธิ์) — ใหม่สุดก่อน
export function visibleToStaff(items, can) {
  return items.filter((i) => {
    if (i.audience !== 'staff') return false
    const def = BELL_STAFF[i.event]
    return !!def && def.perms.some((p) => can(p))
  })
}
export const isReadStaff = (item, userId) => (item.readBy || []).includes(userId)
export function unreadStaff(items, userId, can) {
  return visibleToStaff(items, can).filter((i) => !isReadStaff(i, userId)).length
}
export const visibleToCustomer = (items, customerId) => items.filter((i) => i.audience === 'customer' && i.customerId === customerId)
export const unreadCustomer = (items, customerId) => visibleToCustomer(items, customerId).filter((i) => !i.read).length

// เวลาสัมพันธ์: เมื่อสักครู่ / N นาที / N ชม. / วันที่
export function relTime(at, nowMs = Date.now()) {
  const t = new Date(at).getTime()
  if (!Number.isFinite(t)) return ''
  const d = Math.max(0, nowMs - t)
  if (d < 60e3) return 'เมื่อสักครู่'
  if (d < 3600e3) return `${Math.floor(d / 60e3)} นาทีที่แล้ว`
  if (d < 24 * 3600e3) return `${Math.floor(d / 3600e3)} ชม.ที่แล้ว`
  const x = new Date(t)
  return `${x.getDate()}/${x.getMonth() + 1}/${x.getFullYear() + 543}`
}
