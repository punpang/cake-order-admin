export const STATUS = {
  draft: { label: 'ร่าง', cls: 'bg-stone-100 text-stone-700' },
  awaiting_payment: { label: 'รอชำระ', cls: 'bg-amber-100 text-amber-800' },
  payment_reported: { label: 'แจ้งชำระแล้ว', cls: 'bg-sky-100 text-sky-800' },
  payment_confirmed: { label: 'ยืนยันชำระ', cls: 'bg-indigo-100 text-indigo-800' },
  preparing: { label: 'กำลังเตรียม', cls: 'bg-orange-100 text-orange-800' },
  delivered: { label: 'ส่งมอบแล้ว', cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-rose-100 text-rose-700' },
}

export const ROLES = {
  admin: 'แอดมิน',
  sales: 'พนักงานขาย',
  baker: 'คนทำเค้ก',
  driver: 'คนส่งของ',
}

// สิทธิ์ของแต่ละบทบาท
export const PERMISSIONS = {
  createOrder: ['admin', 'sales'],
  sendToPayment: ['admin', 'sales'],
  reportPayment: ['admin', 'sales'],
  confirmPayment: ['admin'],
  adjustPrice: ['admin'],
  cancel: ['admin'],
  startPreparing: ['admin', 'baker'],
  deliverPickup: ['admin', 'sales'],
  deliverShipping: ['admin', 'driver'],
}

// สถานะที่แต่ละบทบาทเห็นในรายการ (null = เห็นทั้งหมด)
export const VISIBLE = {
  admin: null,
  sales: null,
  baker: (o) => ['payment_confirmed', 'preparing'].includes(o.status),
  driver: (o) => o.fulfillment === 'delivery' && ['preparing', 'delivered'].includes(o.status),
}

export const PAYMENT_METHODS = ['โอนเงิน', 'เงินสด', 'บัตร']
