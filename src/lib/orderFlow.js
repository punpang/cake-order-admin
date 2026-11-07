// ลำดับสถานะออร์เดอร์ (ฟังก์ชันล้วน) · ใช้กับปุ่ม "ย้อนสถานะ" (ย้อนทีละขั้น)
// คืนสถานะก่อนหน้าของออร์เดอร์ หรือ null ถ้าย้อนไม่ได้ (ร่าง/ไม่มีขั้นก่อนหน้า/ยกเลิกที่ย้อนไม่ได้)
export function prevStatus(o) {
  const ship = o.fulfillment === 'delivery'
  const pays = o.payments || []
  const hasConfirmed = pays.some((p) => p.status === 'confirmed')
  const hasReported = pays.some((p) => p.status === 'reported')
  switch (o.status) {
    case 'delivered': return ship ? 'shipping' : 'prepared'
    case 'shipping': return 'ready_to_ship'
    case 'ready_to_ship': return 'prepared'
    case 'prepared': return 'preparing'
    case 'preparing': return hasConfirmed ? 'payment_confirmed' : 'order_confirmed'
    case 'payment_confirmed': return hasReported ? 'payment_reported' : 'awaiting_payment'
    case 'order_confirmed': return hasReported ? 'payment_reported' : 'awaiting_payment'
    case 'payment_reported': return 'awaiting_payment'
    case 'awaiting_payment': return 'draft'
    case 'cancelled': return o.cancel?.restorable ? o.cancel.prevStatus : null
    default: return null
  }
}
