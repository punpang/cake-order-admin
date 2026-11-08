export const STATUS = {
  draft: { label: 'ร่าง', cls: 'bg-stone-100 text-stone-600', dot: 'bg-stone-400', bar: 'bg-stone-300' },
  awaiting_payment: { label: 'รอชำระ', cls: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', bar: 'bg-amber-400' },
  payment_reported: { label: 'แจ้งยอดแล้ว', cls: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', bar: 'bg-orange-400' },
  payment_confirmed: { label: 'ยืนยันชำระ', cls: 'bg-brand-100 text-brand-700', dot: 'bg-brand-500', bar: 'bg-brand-400' },
  order_confirmed: { label: 'ยืนยันการสั่งซื้อ', cls: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500', bar: 'bg-violet-400' },
  preparing: { label: 'กำลังเตรียม', cls: 'bg-lime-100 text-lime-800', dot: 'bg-lime-500', bar: 'bg-lime-400' },
  prepared: { label: 'เตรียมสินค้าแล้ว', cls: 'bg-teal-100 text-teal-800', dot: 'bg-teal-500', bar: 'bg-teal-400' },
  ready_to_ship: { label: 'พร้อมจัดส่ง', cls: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500', bar: 'bg-sky-400' },
  shipping: { label: 'กำลังจัดส่ง', cls: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500', bar: 'bg-blue-400' },
  delivered: { label: 'ส่งมอบแล้ว', cls: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500', bar: 'bg-emerald-400' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', bar: 'bg-rose-300' },
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
  refundPartial: ['admin'], // คืนเงินบางส่วนโดยไม่ยกเลิกออร์เดอร์ (POS ใช้ posVoid)
  workPhoto: ['admin', 'sales', 'baker'], // อัปโหลด/ลบรูปงานเสร็จในออร์เดอร์ (เผยแพร่ขึ้นเว็บใช้สิทธิ์ manage)
  revertStatus: ['admin'], // ย้อนสถานะออร์เดอร์ทีละขั้น (ต้องใส่เหตุผล)
  adjustPrice: ['admin'],
  cancel: ['admin'],
  startPreparing: ['admin', 'baker'],
  markPrepared: ['admin', 'baker'], // เตรียมสินค้าเสร็จ
  confirmUnpaid: ['admin'], // ยืนยันการสั่งซื้อแบบยังไม่ชำระ / อนุมัติคำขอ
  requestConfirmUnpaid: ['admin', 'sales'], // ขออนุมัติยืนยันแบบยังไม่ชำระ
  deliverPickup: ['admin', 'sales'],
  deliverShipping: ['admin', 'driver'],
  manage: ['admin'],
  viewMaterials: ['admin', 'baker'],
  editItems: ['admin'],
  viewProfit: ['admin'], // ต้นทุน / กำไร
  useLoyalty: ['admin', 'sales'], // ใช้คะแนน/คูปองเป็นส่วนลดในออร์เดอร์
  editPickup: ['admin', 'sales'], // แก้วันเวลานัด (ก่อนส่งมอบ) / วันเกิดในออร์เดอร์
  birthdays: ['admin', 'sales'], // ดูรายชื่อเตือนวันเกิด
  chat: ['admin', 'sales'], // ศูนย์รวมแชท LINE OA + Facebook
  pos: ['admin', 'sales'], // ขายหน้าร้าน
  posVoid: ['admin'], // ยกเลิกบิลหน้าร้าน
  adjustPoints: ['admin'], // เพิ่ม/ลดคะแนนลูกค้าเอง (ต้องมีเหตุผล)
  changeBuyer: ['admin', 'sales'], // เปลี่ยนผู้ซื้อในออร์เดอร์/บิล
  // การเห็นรายการออร์เดอร์ (แทน VISIBLE รายบทบาท): ทั้งหมด | งานที่ต้องทำ (ยืนยันแล้ว→เตรียมแล้ว) | งานจัดส่ง
  viewAllOrders: ['admin', 'sales'],
  viewPrepOrders: ['baker'],
  viewDeliveryOrders: ['driver'],
  manageUsers: ['admin'], // แก้สิทธิ์/ผู้ใช้
  // ระบบบัญชี
  acctView: ['admin'], acctRecord: ['admin'], acctClose: ['admin'], acctReports: ['admin'], acctTax: ['admin'], acctAssets: ['admin'], taxInvoice: ['admin'], acctSettings: ['admin'],
}

// PERMISSIONS ข้างบน = ค่าตั้งต้นของแต่ละบทบาท · สิทธิ์จริงของผู้ใช้เก็บเป็นรายการที่ติ๊ก (user.perms)
export const ALL_PERMS = Object.keys(PERMISSIONS)
export const rolePreset = (role) => ALL_PERMS.filter((k) => PERMISSIONS[k].includes(role))

// รายการสิทธิ์สำหรับหน้าติ๊ก: กลุ่ม → [{ key, label, hint }]
export const PERM_GROUPS = [
  { title: 'ออร์เดอร์', items: [
    { key: 'viewAllOrders', label: 'เห็นออร์เดอร์ทั้งหมด', hint: 'ถ้าไม่ติ๊ก จะเห็นเฉพาะงานตามสิทธิ์ด้านล่าง' },
    { key: 'viewPrepOrders', label: 'เห็นงานที่ต้องทำ', hint: 'ยืนยันชำระ/ยืนยันสั่งซื้อ/กำลังเตรียม/เตรียมแล้ว' },
    { key: 'viewDeliveryOrders', label: 'เห็นงานจัดส่ง', hint: 'ออร์เดอร์จัดส่งที่กำลังเตรียม/เตรียมแล้ว/ส่งมอบแล้ว' },
    { key: 'createOrder', label: 'สร้างออร์เดอร์ / ส่งใบเสนอ / สร้างลูกค้า' },
    { key: 'sendToPayment', label: 'ส่งร่างไปรอชำระ' },
    { key: 'editPickup', label: 'แก้วันเวลานัด / วันเกิด / ข้อมูลจัดส่ง' },
    { key: 'editItems', label: 'แก้รายการสินค้าหลังสร้างออร์เดอร์' },
    { key: 'adjustPrice', label: 'ปรับราคา / ส่วนลดในออร์เดอร์' },
    { key: 'cancel', label: 'ยกเลิกออร์เดอร์' },
    { key: 'changeBuyer', label: 'เปลี่ยนผู้ซื้อ' },
    { key: 'useLoyalty', label: 'ใช้คะแนน / คูปองเป็นส่วนลดในออร์เดอร์' },
  ] },
  { title: 'การชำระเงิน', items: [
    { key: 'reportPayment', label: 'แจ้งยอด / แก้ / ยกเลิกยอดที่แจ้ง / ขยายเวลาชำระ' },
    { key: 'confirmPayment', label: 'ยืนยันยอดชำระ' },
    { key: 'cancelConfirmedPayment', label: 'ยกเลิกยอดที่ยืนยันแล้ว' },
    { key: 'refundPartial', label: 'คืนเงินบางส่วน (ไม่ยกเลิกออร์เดอร์)' },
    { key: 'revertStatus', label: 'ย้อนสถานะออร์เดอร์ทีละขั้น' },
    { key: 'workPhoto', label: 'อัปโหลด/ลบรูปงานเสร็จในออร์เดอร์' },
    { key: 'requestConfirmUnpaid', label: 'ขออนุมัติยืนยันสั่งซื้อ (ยังไม่ชำระ)' },
    { key: 'confirmUnpaid', label: 'อนุมัติ/ยืนยันสั่งซื้อแบบยังไม่ชำระ' },
  ] },
  { title: 'ผลิต / ส่งมอบ', items: [
    { key: 'startPreparing', label: 'เริ่มเตรียมสินค้า' },
    { key: 'markPrepared', label: 'เตรียมสินค้าเสร็จ' },
    { key: 'deliverPickup', label: 'ส่งมอบงานรับที่ร้าน' },
    { key: 'deliverShipping', label: 'ส่งมอบงานจัดส่ง' },
    { key: 'viewMaterials', label: 'ดูวัตถุดิบ / ตารางผลิต' },
  ] },
  { title: 'แชท / ลูกค้า / POS', items: [
    { key: 'chat', label: 'ศูนย์รวมแชท' },
    { key: 'birthdays', label: 'ดูเตือนวันเกิด' },
    { key: 'pos', label: 'ขายหน้าร้าน (POS)' },
    { key: 'posVoid', label: 'ยกเลิกบิลหน้าร้าน' },
    { key: 'adjustPoints', label: 'เพิ่ม/ลดคะแนนลูกค้า' },
  ] },
  { title: 'ต้นทุน / ตั้งค่า / ผู้ใช้', items: [
    { key: 'viewProfit', label: 'ดูต้นทุน / กำไร' },
    { key: 'manage', label: 'หน้าจัดการ (สินค้า ราคา ตั้งค่าร้าน ฯลฯ)' },
    { key: 'manageUsers', label: 'จัดการผู้ใช้และสิทธิ์', hint: 'ต้องมีอย่างน้อย 1 คนที่ใช้งานอยู่เสมอ' },
  ] },
  { title: 'บัญชี / ภาษี', items: [
    { key: 'acctView', label: 'เข้าระบบบัญชี / ดูรายการและรายงาน' },
    { key: 'acctRecord', label: 'บันทึก/แก้รายการบัญชี' },
    { key: 'acctClose', label: 'ปิดงวด / เปิดงวดบัญชี' },
    { key: 'acctReports', label: 'งบการเงิน / ส่งออกรายงาน' },
    { key: 'acctTax', label: 'ภาษี: ภ.พ.30 / ภาษีประจำปี / บันทึกการยื่น' },
    { key: 'acctAssets', label: 'สินทรัพย์ ค่าเสื่อม ผ่อนชำระ ค่าใช้จ่ายประจำ' },
    { key: 'taxInvoice', label: 'ออก/ยกเลิกใบกำกับภาษีเต็มรูป' },
    { key: 'acctSettings', label: 'ตั้งค่าบัญชี / ผังบัญชี' },
  ] },
]

// สถานะที่แต่ละบทบาทเห็นในรายการ (null = เห็นทั้งหมด)
export const VISIBLE = {
  admin: null,
  sales: null,
  baker: (o) => ['payment_confirmed', 'order_confirmed', 'preparing', 'prepared'].includes(o.status),
  driver: (o) => o.fulfillment === 'delivery' && ['preparing', 'prepared', 'ready_to_ship', 'shipping', 'delivered'].includes(o.status),
}

export const PAYMENT_METHODS = ['โอนเงิน', 'เงินสด', 'บัตร']

// กลุ่มตัวเลือก
// กลุ่มหลักของเค้กสั่งทำ (เรียงตามลำดับเลือก): ประเภท > เนื้อเค้ก > ขนาด
export const MAIN_KEYS = ['type', 'flavor', 'size', 'style', 'shape']
// หลักที่ "ตัวเลือกจำกัดตามประเภท (types)" ยังใช้งานอยู่ (รูปทรง) · หลักอื่นใช้ตัวกรองของประเภทเอง
export const TYPE_FILTERED_MAIN = ['shape']
export const typeFreeGroup = (g) => MAIN_KEYS.includes(g.key) && !TYPE_FILTERED_MAIN.includes(g.key)
// กลุ่มหลักที่ "เพิ่มภายหลัง": ฐานข้อมูลเดิมยังไม่มี → เติมให้อัตโนมัติ (ไม่บังคับเลือก ไม่มีตัวเลือกเริ่มต้น)
export const STYLE_GROUP = { id: 'g_style', key: 'style', name: 'รูปแบบตกแต่ง', perTier: true, type: 'single', required: false, appliesTo: ['custom'], active: true, options: [] }
// รูปทรง (g_shape) เดิมเป็นหัวข้อรอง → ยกเป็นหลัก 5: ใส่ key 'shape' และแปลงราคาเป็นบวกคงที่
export function ensureShapeMain(groups) {
  const sh = Array.isArray(groups) && groups.find((g) => g.id === 'g_shape' && !g.key)
  if (!sh) return groups
  sh.key = 'shape'
  for (const o of sh.options || []) if (o.priceType !== 'fixed') o.price = Number(o.price) || Object.values(o.sizePrices || {}).map(Number).find((n) => n > 0) || 0
  return groups
}
export function ensureStyleGroup(groups) {
  ensureShapeMain(groups)
  if (!Array.isArray(groups) || groups.some((g) => g.key === 'style')) return groups
  const at = groups.findIndex((g) => g.key === 'size')
  groups.splice(at >= 0 ? at + 1 : groups.length, 0, JSON.parse(JSON.stringify(STYLE_GROUP)))
  return groups
}

export const GROUP_TYPES = { single: 'เลือกได้ 1 อย่าง', multi: 'เลือกได้หลายอย่าง', text: 'พิมพ์ข้อความ' }
export const APPLIES_TO = { custom: 'สั่งทำ', ready: 'สินค้าสำเร็จ' }

// สูตรวัตถุดิบ
export const RECIPE_PER = { pound: 'ต่อปอนด์', piece: 'ต่อชิ้น' }
// สถานะที่นับรวมในหน้าสรุปวัตถุดิบ
export const MATERIAL_STATUSES = ['draft', 'awaiting_payment', 'payment_reported', 'payment_confirmed', 'order_confirmed', 'preparing', 'prepared']

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
  order_confirmed: { label: 'ยืนยันการสั่งซื้อ', audience: 'customer' },
  prepared: { label: 'เตรียมสินค้าเสร็จ (พร้อมรับ/ส่ง)', audience: 'customer' },
  payment_reminder: { label: 'เตือนชำระ (ออร์เดอร์พรุ่งนี้ ยังไม่ชำระ)', audience: 'customer', scheduled: true },
  pickup_reminder: { label: 'เตือนก่อนนัดรับ (24 ชม.)', audience: 'customer', scheduled: true },
  shipping: { label: 'ออร์เดอร์ออกจัดส่งแล้ว', audience: 'customer' },
  delivered: { label: 'ส่งมอบแล้ว', audience: 'customer' },
  cancelled: { label: 'ยกเลิกออร์เดอร์', audience: 'customer' },
  order_refunded: { label: 'คืนเงินบางส่วน', audience: 'customer' },
  order_refund_cancelled: { label: 'ยกเลิกการคืนเงินบางส่วน', audience: 'customer' },
  birthday: { label: 'อวยพรวันเกิด', audience: 'customer', scheduled: true, marketing: true },
  points_expiring: { label: 'คะแนนใกล้หมดอายุ', audience: 'customer', scheduled: true, marketing: true },
  team_new_order: { label: 'ออร์เดอร์ใหม่', audience: 'team' },
  team_payment_confirmed: { label: 'ยืนยันชำระแล้ว', audience: 'team' },
  team_due_soon: { label: 'งานใกล้เวลาต้องเสร็จ (2 ชม.)', audience: 'team', scheduled: true },
  team_cancelled: { label: 'ยกเลิกออร์เดอร์', audience: 'team' },
  team_approval_request: { label: 'ขออนุมัติยืนยันสั่งซื้อ (ยังไม่ชำระ)', audience: 'team' },
  team_pay_overdue: { label: 'เกินกำหนดชำระ', audience: 'team', scheduled: true },
  team_customer_paid: { label: 'ลูกค้าแจ้งโอน (รอตรวจสลิป)', audience: 'team' },
  photo_ready: { label: 'มีรูปงานเสร็จให้ดู', audience: 'customer' },
  photo_optout_done: { label: 'ลบรูปตามคำขอไม่เผยแพร่แล้ว', audience: 'customer' },
  photo_optout_rejected: { label: 'ร้านไม่อนุมัติคำขอไม่เผยแพร่รูป', audience: 'customer' },
  team_coupon_shown: { label: 'ลูกค้ากดแสดงคูปอง/ของรางวัลที่ร้าน', audience: 'team' },
  coupon_refunded: { label: 'ร้านคืนคะแนนจากคูปอง', audience: 'customer' },
  team_photo_optout: { label: 'ลูกค้าขอไม่ให้เผยแพร่รูป (รอตรวจสอบ)', audience: 'team' },
  team_pay_extend_request: { label: 'ลูกค้าขอขยายเวลาชำระ', audience: 'team' },
  team_expense_missing: { label: 'ค่าใช้จ่ายประจำเดือนที่ยังไม่ได้บันทึก', audience: 'team', scheduled: true },
  team_installment_due: { label: 'งวดผ่อนชำระใกล้/เลยกำหนด', audience: 'team', scheduled: true },
  team_vat_due: { label: 'ครบกำหนดยื่น ภ.พ.30 (ยังไม่ยื่น)', audience: 'team', scheduled: true },
}
export const NOTIFY_VARS = ['{ชื่อลูกค้า}', '{เลขออร์เดอร์}', '{ยอดรวม}', '{คงค้าง}', '{ยอดที่แจ้ง}', '{วันนัด}', '{เวลานัด}', '{ส่งมอบ}', '{ชื่อวันเกิด}', '{คะแนน}', '{ลิงก์ออร์เดอร์}', '{ชำระก่อน}', '{เดือนภาษี}', '{รายการ}', '{วันที่}', '{งวด}', '{นาที}', '{ยอดที่ชำระ}', '{ชำระแล้ว}', '{ข้อความรับสินค้า}', '{เวลาปิดร้าน}', '{ข้อความขอใช้ภาพ}']

export const POS_METHODS = { cash: 'เงินสด', transfer: 'โอนเงิน', card: 'บัตร' }

// หัวข้อ "กลางเค้ก" มีได้เฉพาะชั้นบนสุด (ชั้น 1) · ชั้นล่าง/ชั้นกลางไม่มี
export const topTierOnly = (g) => !!g && (g.id === 'g_topping' || g.topTierOnly === true)
