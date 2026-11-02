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
  cancelConfirmedPayment: ['admin'], // ยกเลิกยอดที่ยืนยันแล้ว
  adjustPrice: ['admin'],
  cancel: ['admin'],
  startPreparing: ['admin', 'baker'],
  deliverPickup: ['admin', 'sales'],
  deliverShipping: ['admin', 'driver'],
  manage: ['admin'],
  viewMaterials: ['admin', 'baker'],
  editItems: ['admin'],
  viewProfit: ['admin'], // ต้นทุน / กำไร
  useLoyalty: ['admin', 'sales'], // ใช้คะแนน/คูปองเป็นส่วนลดในออร์เดอร์
  editPickup: ['admin', 'sales'], // แก้วันเวลานัด (ก่อนส่งมอบ) / วันเกิดในออร์เดอร์
  birthdays: ['admin', 'sales'], // ดูรายชื่อเตือนวันเกิด
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
// กลุ่มหลักของเค้กสั่งทำ (เรียงตามลำดับเลือก): ประเภท > เนื้อเค้ก > ขนาด
export const MAIN_KEYS = ['type', 'flavor', 'size']

export const GROUP_TYPES = { single: 'เลือกได้ 1 อย่าง', multi: 'เลือกได้หลายอย่าง', text: 'พิมพ์ข้อความ' }
export const APPLIES_TO = { custom: 'สั่งทำ', ready: 'เค้กสำเร็จ' }

// สูตรวัตถุดิบ
export const RECIPE_PER = { pound: 'ต่อปอนด์', piece: 'ต่อชิ้น' }
// สถานะที่นับรวมในหน้าสรุปวัตถุดิบ
export const MATERIAL_STATUSES = ['draft', 'awaiting_payment', 'payment_reported', 'payment_confirmed', 'preparing']

// ---------- การเชื่อมต่อ & แจ้งเตือน (จำลอง ยังไม่ส่งจริง) ----------
export const CHANNELS = {
  telegram: { label: 'Telegram', audience: 'team', prep: 'สร้างบอทกับ @BotFather → token + chat_id ของกลุ่มทีม · ฟรี' },
  line: { label: 'LINE OA', audience: 'customer', prep: 'Messaging API channel → channel access token + secret · ผูกลูกค้าด้วย userId (เพิ่มเพื่อน/LINE Login) · push เกินโควตาคิดเงิน' },
  sms: { label: 'SMS', audience: 'customer', prep: 'ผู้ให้บริการ SMS ไทย + ชื่อผู้ส่ง (sender name) · คิดเงินต่อข้อความ (ไทย 70 ตัวอักษร/ข้อความ)' },
  facebook: { label: 'Facebook Page', audience: 'customer', prep: 'Meta App + Page access token · ต้องผ่าน App Review · ส่งได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด' },
}
// ลำดับเลือกช่องทางถึงลูกค้า
export const CUSTOMER_CHANNEL_ORDER = ['line', 'facebook', 'sms']
// เหตุการณ์: audience = customer (ส่งลูกค้า) | team (แจ้งทีมผ่าน Telegram), scheduled = ตรวจตามเวลา (ของจริงใช้ cron), marketing = ต้องให้ลูกค้ายินยอมรับข่าว
export const NOTIFY_EVENTS = {
  order_created: { label: 'สร้างออร์เดอร์ (สรุป)', audience: 'customer' },
  payment_requested: { label: 'แจ้งยอดชำระ', audience: 'customer' },
  payment_confirmed: { label: 'ยืนยันชำระแล้ว', audience: 'customer' },
  pickup_reminder: { label: 'เตือนก่อนนัดรับ (24 ชม.)', audience: 'customer', scheduled: true },
  delivered: { label: 'ส่งมอบแล้ว', audience: 'customer' },
  cancelled: { label: 'ยกเลิกออร์เดอร์', audience: 'customer' },
  birthday: { label: 'อวยพรวันเกิด', audience: 'customer', scheduled: true, marketing: true },
  points_expiring: { label: 'คะแนนใกล้หมดอายุ', audience: 'customer', scheduled: true, marketing: true },
  team_new_order: { label: 'ออร์เดอร์ใหม่', audience: 'team' },
  team_payment_confirmed: { label: 'ยืนยันชำระแล้ว', audience: 'team' },
  team_due_soon: { label: 'งานใกล้เวลาต้องเสร็จ (2 ชม.)', audience: 'team', scheduled: true },
  team_cancelled: { label: 'ยกเลิกออร์เดอร์', audience: 'team' },
}
export const NOTIFY_VARS = ['{ชื่อลูกค้า}', '{เลขออร์เดอร์}', '{ยอดรวม}', '{คงค้าง}', '{ยอดที่แจ้ง}', '{วันนัด}', '{เวลานัด}', '{ส่งมอบ}', '{ชื่อวันเกิด}', '{คะแนน}']
