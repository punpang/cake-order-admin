export const STATUS = {
  draft: { label: 'ร่าง', cls: 'bg-stone-100 text-stone-600', dot: 'bg-stone-400', bar: 'bg-stone-300' },
  awaiting_payment: { label: 'รอชำระ', cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-400' },
  payment_reported: { label: 'แจ้งยอดแล้ว', cls: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500', bar: 'bg-sky-400' },
  payment_confirmed: { label: 'ยืนยันชำระ', cls: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500', bar: 'bg-violet-400' },
  preparing: { label: 'กำลังเตรียม', cls: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500', bar: 'bg-orange-400' },
  delivered: { label: 'ส่งมอบแล้ว', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-400' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-rose-50 text-rose-600', dot: 'bg-rose-500', bar: 'bg-rose-300' },
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
  manage: ['admin'],
  viewMaterials: ['admin', 'baker'],
  editItems: ['admin'],
  useLoyalty: ['admin', 'sales'], // ใช้คะแนน/คูปองเป็นส่วนลดในออร์เดอร์
}

// สถานะที่แต่ละบทบาทเห็นในรายการ (null = เห็นทั้งหมด)
export const VISIBLE = {
  admin: null,
  sales: null,
  baker: (o) => ['payment_confirmed', 'preparing'].includes(o.status),
  driver: (o) => o.fulfillment === 'delivery' && ['preparing', 'delivered'].includes(o.status),
}

export const PAYMENT_METHODS = ['โอนเงิน', 'เงินสด', 'บัตร']

// กลุ่มตัวเลือก
// กลุ่มหลักของเค้กสั่งทำ (เรียงตามลำดับเลือก): หน้าเค้ก > เนื้อเค้ก > ขนาด ราคาบวกกัน
export const MAIN_KEYS = ['face', 'flavor', 'size']

export const GROUP_TYPES = { single: 'เลือกได้ 1 อย่าง', multi: 'เลือกได้หลายอย่าง', text: 'พิมพ์ข้อความ' }
export const APPLIES_TO = { custom: 'สั่งทำ', ready: 'เค้กสำเร็จ' }
export const PRICE_TYPES = { fixed: 'บวกคงที่', per_pound: 'บวกต่อปอนด์' }

// สูตรวัตถุดิบ
export const RECIPE_PER = { pound: 'ต่อปอนด์', piece: 'ต่อชิ้น' }
// สถานะที่นับรวมในหน้าสรุปวัตถุดิบ
export const MATERIAL_STATUSES = ['draft', 'awaiting_payment', 'payment_reported', 'payment_confirmed', 'preparing']
