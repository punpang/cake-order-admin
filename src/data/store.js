// ข้อมูลตัวอย่าง (เก็บในหน่วยความจำ รีเฟรชแล้วหาย)
// ขั้นต่อไปจะเปลี่ยนฟังก์ชันในไฟล์นี้ให้เรียก Supabase แทน
import { reactive } from 'vue'
import { PERMISSIONS } from '../lib/constants'
import { activeLists, priceDetail, orderTotals } from '../lib/pricing'
import { addDays, pointBalance, takePoints, returnPoints, couponUsable, pickPrize } from '../lib/loyalty'
import { pad, toDateStr } from '../lib/format'

let seq = 1000
const uid = (p) => `${p}${++seq}`
const now = () => new Date().toISOString()

const at = (dayOffset, hh, mm = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  return `${toDateStr(d)}T${pad(hh)}:${pad(mm)}`
}

// ---------- ผู้ใช้ (จำลอง) ----------
export const session = reactive({ role: 'admin' })
export const can = (action) => PERMISSIONS[action]?.includes(session.role)

// ---------- ข้อมูลหลัก ----------
const opt = (id, name, price = 0, priceType = 'fixed', extra = {}) => ({ id, name, price, priceType, active: true, recipe: [], ...extra })
// บรรทัดสูตร: วัตถุดิบ, ปริมาณ, ต่อปอนด์ (pound) หรือ ต่อชิ้น (piece)
const r = (ingredientId, qty, per = 'pound') => ({ ingredientId, qty, per })

export const db = reactive({
  customers: [
    { id: 'c1', name: 'คุณมะลิ ใจดี', phone: '0812345678', line: 'mali.j', note: '' },
    { id: 'c2', name: 'คุณสมชาย รักเค้ก', phone: '0899998888', line: '', note: 'ชอบหวานน้อย' },
    { id: 'c3', name: 'บริษัท ขนมหวาน จำกัด', phone: '021234567', line: 'sweetco', note: 'ขอใบกำกับภาษี' },
  ],

  // ---------- คะแนนสะสม / แลกของ / กาชา ----------
  // earnPer = ทุกกี่บาทได้ 1 คะแนน, pointValue = 1 คะแนนลดได้กี่บาท, spinCost = คะแนนต่อการหมุน 1 ครั้ง, spinPer = ทุกกี่บาทได้สิทธิ์หมุน 1 ครั้ง
  loyalty: { earnPer: 100, pointValue: 1, pointExpireDays: 365, couponExpireDays: 30, spinCost: 50, spinPer: 500 },
  rewards: [
    { id: 'rw1', name: 'เทียนวันเกิดเซ็ต', points: 30, active: true },
    { id: 'rw2', name: 'คัพเค้ก 1 ชิ้น', points: 80, active: true },
    { id: 'rw3', name: 'เค้ก 1 ปอนด์', points: 500, active: true },
  ],
  // type = points | reward | discount | none
  gachaPrizes: [
    { id: 'gp1', name: '10 คะแนน', type: 'points', value: 10, chance: 30, active: true },
    { id: 'gp2', name: '50 คะแนน', type: 'points', value: 50, chance: 10, active: true },
    { id: 'gp3', name: 'คัพเค้ก 1 ชิ้น', type: 'reward', rewardId: 'rw2', chance: 10, active: true },
    { id: 'gp4', name: 'ส่วนลด 50 บาท', type: 'discount', value: 50, chance: 15, active: true },
    { id: 'gp5', name: 'เสียใจด้วย', type: 'none', chance: 35, active: true },
  ],
  // คูปอง: type = reward (รอรับที่ร้าน) | discount (ใช้ลดในออร์เดอร์), status = pending | used | delivered
  coupons: [],
  spinLog: [],

  // ราคาพิเศษ (ตัวอย่าง): scheduled = กำหนดช่วงวัน (เทียบวันที่สร้างออร์เดอร์)
  // ราคาของแต่ละแบบเก็บใน special: { [priceListId]: ราคา } ของสินค้า/ตัวเลือก
  priceLists: [
    { id: 'pl1', name: 'โปรเปิดร้าน', active: true, scheduled: true, from: at(-1, 0).slice(0, 10), to: at(7, 0).slice(0, 10) },
    { id: 'pl2', name: 'ราคาสมาชิก', active: false, scheduled: false, from: '', to: '' },
  ],

  // วัตถุดิบ (ตัวอย่าง)
  ingredients: [
    { id: 'm1', name: 'แป้งเค้ก', unit: 'g', active: true },
    { id: 'm2', name: 'น้ำตาลทราย', unit: 'g', active: true },
    { id: 'm3', name: 'ไข่ไก่', unit: 'ฟอง', active: true },
    { id: 'm4', name: 'เนยจืด', unit: 'g', active: true },
    { id: 'm5', name: 'วิปปิ้งครีม', unit: 'ml', active: true },
    { id: 'm6', name: 'ผงโกโก้', unit: 'g', active: true },
    { id: 'm7', name: 'สตรอว์เบอร์รีสด', unit: 'g', active: true },
    { id: 'm8', name: 'กล่องเค้ก', unit: 'ใบ', active: true },
  ],

  // เค้กสำเร็จ (recipe = สูตรวัตถุดิบ ตัวเลขตัวอย่าง)
  products: [
    { id: 'p1', name: 'เค้กช็อกโกแลตฟัดจ์', pounds: 1, price: 420, active: true, recipe: [r('m1', 150), r('m2', 120), r('m3', 3), r('m4', 80), r('m6', 40), r('m8', 1, 'piece')] },
    { id: 'p2', name: 'เค้กส้ม', pounds: 1, price: 390, special: { pl1: 350 }, active: true, recipe: [r('m1', 160), r('m2', 130), r('m3', 3), r('m4', 70), r('m8', 1, 'piece')] },
    { id: 'p3', name: 'เค้กใบเตยมะพร้าวอ่อน', pounds: 2, price: 690, active: true, recipe: [r('m1', 150), r('m2', 110), r('m3', 3), r('m5', 150), r('m8', 1, 'piece')] },
    { id: 'p4', name: 'เรดเวลเวท', pounds: 1, price: 450, active: true, recipe: [r('m1', 150), r('m2', 130), r('m3', 3), r('m4', 80), r('m6', 10), r('m8', 1, 'piece')] },
  ],

  // ผู้ใช้ระบบ (email ใช้ล็อกอินเมื่อต่อ Supabase)
  users: [
    { id: 'u1', name: 'แอดมิน', email: 'admin@example.com', role: 'admin', active: true },
    { id: 'u2', name: 'พนักงานขาย', email: 'sales@example.com', role: 'sales', active: true },
    { id: 'u3', name: 'คนทำเค้ก', email: 'baker@example.com', role: 'baker', active: true },
    { id: 'u4', name: 'คนส่งของ', email: 'driver@example.com', role: 'driver', active: true },
  ],

  // กลุ่มตัวเลือก: type = single | multi | text, appliesTo = custom/ready, perTier = เลือกแยกแต่ละชั้น (สั่งทำ)
  optionGroups: [
    // ---- กลุ่มหลัก: หน้าเค้ก > เนื้อเค้ก > ขนาด (ราคาบวกกัน) ----
    { id: 'g_frosting', key: 'face', name: 'หน้าเค้ก', prepList: true, perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('fc1', 'เค้กแยมมะพร้าวอ่อน', 100), opt('fc2', 'เค้กหน้านิ่ม', 50, 'fixed', { allow: { g_sponge: ['sp2', 'sp3', 'sp4', 'sp5'] } }),
      opt('fr1', 'วิปครีม', 0, 'fixed', { recipe: [r('m5', 200), r('m2', 20)] }), opt('fr2', 'บัตเตอร์ครีม', 50, 'per_pound'), opt('fr3', 'ฟองดองท์', 200, 'per_pound'),
      opt('fr4', 'ช็อกโกแลตกานาช', 80, 'per_pound'), opt('fr5', 'ครีมชีส', 80, 'per_pound'),
    ] },
    { id: 'g_sponge', key: 'flavor', name: 'เนื้อเค้ก', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('sp1', 'วานิลลา', 0, 'fixed', { recipe: [r('m1', 150), r('m2', 120), r('m3', 3), r('m4', 70)] }),
      opt('sp2', 'ช็อกโกแลต', 30, 'per_pound', { recipe: [r('m1', 140), r('m2', 120), r('m3', 3), r('m4', 70), r('m6', 30)] }), opt('sp3', 'ใบเตย'),
      opt('sp4', 'เรดเวลเวท', 50, 'per_pound'), opt('sp5', 'ชาไทย', 30, 'per_pound'),
    ] },
    { id: 'g_size', key: 'size', name: 'ขนาด', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('s1', '1 ปอนด์', 450, 'fixed', { pounds: 1, recipe: [r('m8', 1, 'piece')] }),
      opt('s2', '2 ปอนด์', 850, 'fixed', { pounds: 2, recipe: [r('m8', 1, 'piece')] }),
      opt('s3', '3 ปอนด์', 1250, 'fixed', { pounds: 3, recipe: [r('m8', 1, 'piece')] }),
      opt('s4', '5 ปอนด์', 2000, 'fixed', { pounds: 5, recipe: [r('m8', 1, 'piece')] }),
    ] },
    // ---- ตัวเลือกรอง ----
    { id: 'g_shape', name: 'รูปทรง', type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('sh1', 'กลม'), opt('sh2', 'สี่เหลี่ยม'), opt('sh3', 'หัวใจ', 100), opt('sh4', 'ตัวเลข/ตัวอักษร', 300),
    ] },
    { id: 'g_filling', name: 'สอดไส้', prepList: true, perTier: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('f1', 'ครีมสด', 0, 'fixed', { recipe: [r('m5', 100)] }), opt('f2', 'สตรอว์เบอร์รี', 60, 'per_pound', { recipe: [r('m7', 80)] }), opt('f3', 'บลูเบอร์รี', 60, 'per_pound'),
      opt('f4', 'คัสตาร์ด', 40, 'per_pound'), opt('f5', 'ช็อกโกแลตกานาช', 50, 'per_pound'),
    ] },
    { id: 'g_color', name: 'สีธีม', type: 'text', required: false, appliesTo: ['custom'], placeholder: 'เช่น ชมพูพาสเทล + ขาว' },
    { id: 'g_topping', name: 'On top / ท็อปปิ้ง', prepList: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('tp1', 'ผลไม้รวม', 150), opt('tp2', 'สตรอว์เบอร์รีสด', 180, 'fixed', { recipe: [r('m7', 150, 'piece')] }), opt('tp3', 'มาการอง', 200),
      opt('tp4', 'ช็อกโกแลตแท่ง/ตกแต่ง', 120), opt('tp5', 'เม็ดมุกน้ำตาล', 50),
    ] },
    { id: 'g_deco', name: 'ตกแต่ง', prepList: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('d1', 'ดอกไม้ครีม', 150), opt('d2', 'ดอกไม้สด', 350), opt('d3', 'ฟิกเกอร์', 500),
      opt('d4', 'ภาพพิมพ์ทานได้', 250), opt('d5', 'โบว์/ริบบิ้น', 80),
    ] },
    { id: 'g_message', name: 'ข้อความบนเค้ก', type: 'text', required: false, appliesTo: ['custom', 'ready'], placeholder: 'เช่น HBD แม่ 60 ปี' },
    { id: 'g_extra', name: 'ของเสริม', type: 'multi', required: false, appliesTo: ['custom', 'ready'], options: [
      opt('x1', 'เทียนวันเกิด'), opt('x2', 'เทียนตัวเลข', 20), opt('x3', 'ป้ายข้อความ', 60),
      opt('x4', 'การ์ดอวยพร', 30), opt('x5', 'กล่องพิเศษ', 100), opt('x6', 'มีด + จาน'),
    ] },
    { id: 'g_diet', name: 'ข้อจำกัดอาหาร', type: 'multi', required: false, appliesTo: ['custom', 'ready'], options: [
      opt('dt1', 'หวานน้อย'), opt('dt2', 'ไม่ใส่ถั่ว'), opt('dt3', 'ไม่มีแอลกอฮอล์'), opt('dt4', 'ไม่ใส่นม'),
    ] },
    { id: 'g_allergy', name: 'แพ้อาหาร (ระบุ)', type: 'text', required: false, appliesTo: ['custom', 'ready'], placeholder: 'ถ้ามี' },
  ],

  orders: [],
})

// ทุกรายการเริ่มต้นเป็น "ใช้งาน" + สมุดคะแนน / สิทธิ์หมุน
for (const c of db.customers) Object.assign(c, { active: true, ledger: [], spins: 0 })
for (const g of db.optionGroups) g.active = true

// ---------- ฟังก์ชัน ----------
let orderNo = 0
const nextCode = () => `OR-${String(++orderNo).padStart(4, '0')}`

export const findOrder = (id) => db.orders.find((o) => o.id === id)
export const findCustomer = (id) => db.customers.find((c) => c.id === id)

export function addCustomer(data) {
  const c = { id: uid('c'), name: data.name.trim(), phone: data.phone?.trim() || '', line: data.line?.trim() || '', note: data.note?.trim() || '', active: true, ledger: [], spins: 0 }
  db.customers.push(c)
  return c
}

// ---------- หน้าจัดการ (บันทึก = เพิ่มใหม่ถ้าไม่มี id, แก้ไขถ้ามี id) ----------
const trim = (v) => (typeof v === 'string' ? v.trim() : v)
const cleanObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, trim(v)]))

function upsert(list, prefix, data) {
  const d = cleanObj(data)
  if (d.id) {
    const cur = list.find((x) => x.id === d.id)
    if (cur) Object.assign(cur, d)
    return cur
  }
  const item = { ...d, id: uid(prefix), active: d.active ?? true }
  list.push(item)
  return item
}

// ตัดบรรทัดสูตรที่ไม่ครบ และคัดลอกใหม่ไม่ให้ผูกกับฟอร์ม
const cleanRecipe = (list) =>
  (list || [])
    .filter((x) => x.ingredientId && Number(x.qty) > 0)
    .map((x) => ({ ingredientId: x.ingredientId, qty: Number(x.qty), per: x.per === 'piece' ? 'piece' : 'pound' }))

// ราคาพิเศษ: ตัดช่องว่างออก เก็บเป็นตัวเลข
const cleanSpecial = (obj) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== '' && v != null && Number(v) >= 0).map(([k, v]) => [k, Number(v)]))

export function saveCustomer(d) {
  const c = upsert(db.customers, 'c', d)
  if (!c.ledger) Object.assign(c, { ledger: [], spins: 0 })
  return c
}
export const savePriceList = (d) => upsert(db.priceLists, 'pl', d)
export const saveIngredient = (d) => upsert(db.ingredients, 'm', d)
export const saveProduct = (d) => upsert(db.products, 'p', { ...d, price: Number(d.price) || 0, pounds: Number(d.pounds) || 1, recipe: cleanRecipe(d.recipe), special: cleanSpecial(d.special) })
export const saveUser = (d) => upsert(db.users, 'u', d)
export const findGroup = (id) => db.optionGroups.find((g) => g.id === id)

export function saveGroup(d) {
  const g = upsert(db.optionGroups, 'g', d)
  if (!g.options) g.options = []
  return g
}

export function saveOption(groupId, d) {
  const g = findGroup(groupId)
  if (!g) return null
  const data = { ...d, price: Number(d.price) || 0, recipe: cleanRecipe(d.recipe), special: cleanSpecial(d.special) }
  if (g.key === 'size') data.pounds = Number(d.pounds) || 1
  return upsert(g.options, 'o', data)
}

// จำนวนออร์เดอร์ของลูกค้า
export const customerOrderCount = (id) => db.orders.filter((o) => o.customerId === id).length

// คิดราคาตามราคาพิเศษที่ใช้งาน ณ วันที่สร้างออร์เดอร์ (ค่าเริ่มต้น = วันนี้)
export const activeListsAt = (dateStr) => activeLists(db.priceLists, dateStr || toDateStr(new Date()))
export const orderDate = (order) => toDateStr(new Date(order.createdAt))

export function priceItem(item, dateStr) {
  return { ...item, ...priceDetail(item, db.optionGroups, db.products, activeListsAt(dateStr)) }
}

function log(order, text) {
  order.history.push({ at: now(), text, by: session.role })
}

export function createOrder(payload, asDraft = false) {
  const o = {
    id: uid('o'),
    code: nextCode(),
    customerId: payload.customerId,
    pickupAt: payload.pickupAt,
    fulfillment: payload.fulfillment,
    address: payload.fulfillment === 'delivery' ? payload.address : '',
    shippingFee: payload.fulfillment === 'delivery' ? Number(payload.shippingFee) || 0 : 0,
    items: payload.items.map((i) => priceItem(i)),
    adjustment: { amount: 0, reason: '' },
    pointsUsed: null, // { points, amount, entryId }
    couponsUsed: [], // [{ couponId, name, amount }]
    loyalty: null, // คะแนน/สิทธิ์หมุนที่ได้ตอนส่งมอบ { points, spins, lotId }
    status: asDraft ? 'draft' : 'awaiting_payment',
    payments: [],
    cancel: null,
    history: [],
    createdAt: now(),
  }
  log(o, asDraft ? 'สร้างออร์เดอร์ (ร่าง)' : 'สร้างออร์เดอร์ → รอชำระ')
  db.orders.unshift(o)
  return o
}

export function setStatus(order, status, text) {
  order.status = status
  log(order, text)
  if (status === 'delivered') awardOrder(order)
}

// แจ้งยอดชำระ = ส่งยอดไปให้ลูกค้า (ยังไม่ใช่ยอดที่จ่ายจริง) ยอดจริงใส่ตอนแอดมินยืนยัน
// payment.status = reported (รอลูกค้าชำระ) | confirmed | cancelled, requested = ยอดที่แจ้ง, amount = ยอดจริง (ตอนยืนยัน)
export function reportPayment(order, p) {
  order.payments.push({
    id: uid('pay'),
    requested: Number(p.amount),
    amount: Number(p.amount),
    method: p.method,
    paidAt: p.paidAt,
    slip: p.slip || '',
    note: p.note || '',
    status: 'reported',
    reportedBy: session.role,
    confirmedBy: null,
  })
  log(order, `แจ้งยอดชำระ ${Number(p.amount).toLocaleString('th-TH')} ฿ (${p.method})`)
  if (order.status === 'awaiting_payment') order.status = 'payment_reported'
}

const payFields = (p) => ({ method: p.method, paidAt: p.paidAt, slip: p.slip || '', note: p.note || '' })

export function updatePaymentRequest(order, paymentId, p) {
  const pay = order.payments.find((x) => x.id === paymentId)
  if (!pay || pay.status !== 'reported') return
  Object.assign(pay, { requested: Number(p.amount), amount: Number(p.amount), ...payFields(p) })
  log(order, `แก้ยอดที่แจ้งเป็น ${Number(p.amount).toLocaleString('th-TH')} ฿`)
}

export function cancelPaymentRequest(order, paymentId) {
  const pay = order.payments.find((x) => x.id === paymentId)
  if (!pay || pay.status !== 'reported') return
  pay.status = 'cancelled'
  log(order, `ยกเลิกยอดที่แจ้ง ${pay.requested.toLocaleString('th-TH')} ฿`)
  if (order.status === 'payment_reported' && !order.payments.some((x) => x.status === 'reported')) order.status = 'awaiting_payment'
}

// data = ยอดที่ได้รับจริง + รายละเอียด (ไม่ส่ง = ใช้ตามที่แจ้ง)
export function confirmPayment(order, paymentId, data = null) {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!p || p.status !== 'reported') return
  if (data) Object.assign(p, { amount: Number(data.amount), ...payFields(data) })
  p.status = 'confirmed'
  p.confirmedBy = session.role
  log(order, `ยืนยันชำระ ${p.amount.toLocaleString('th-TH')} ฿${p.amount !== p.requested ? ` (แจ้ง ${p.requested.toLocaleString('th-TH')} ฿)` : ''}`)
  if (['awaiting_payment', 'payment_reported'].includes(order.status)) order.status = 'payment_confirmed'
}

// แก้รายการสินค้าหลังสร้าง: คิดราคาใหม่ทุกรายการตามราคาปัจจุบัน
function repriceAll(order) {
  order.items = order.items.map((i) => priceItem(i, orderDate(order)))
}

export function saveOrderItem(order, item) {
  const i = order.items.findIndex((x) => x.id === item.id)
  if (i >= 0) order.items[i] = item
  else order.items.push(item)
  repriceAll(order)
  log(order, `${i >= 0 ? 'แก้ไข' : 'เพิ่ม'}สินค้า: ${item.name} × ${item.qty}`)
}

export function removeOrderItem(order, itemId) {
  const it = order.items.find((x) => x.id === itemId)
  if (!it || order.items.length <= 1) return false
  order.items = order.items.filter((x) => x.id !== itemId)
  repriceAll(order)
  log(order, `ลบสินค้า: ${it.name}`)
  return true
}

export function setAdjustment(order, amount, reason) {
  order.adjustment = { amount: Number(amount) || 0, reason }
  log(order, `ปรับราคา ${Number(amount).toLocaleString('th-TH')} ฿ (${reason})`)
}

export function cancelOrder(order, c) {
  undoLoyalty(order)
  order.cancel = { reason: c.reason, refundAmount: Number(c.refundAmount) || 0, refundMethod: c.refundMethod, refundNote: c.refundNote || '', at: now() }
  setStatus(order, 'cancelled', `ยกเลิก: ${c.reason}${order.cancel.refundAmount ? ` / คืนเงิน ${order.cancel.refundAmount.toLocaleString('th-TH')} ฿` : ''}`)
}

// จำนวนออร์เดอร์ (ไม่นับยกเลิก) ในวันเดียวกัน และในชั่วโมงเดียวกัน
export function countPickups(pickupAt, excludeId) {
  if (!pickupAt) return { day: 0, hour: 0 }
  const day = pickupAt.slice(0, 10)
  const hour = pickupAt.slice(0, 13)
  const list = db.orders.filter((o) => o.status !== 'cancelled' && o.id !== excludeId)
  return {
    day: list.filter((o) => o.pickupAt.slice(0, 10) === day).length,
    hour: list.filter((o) => o.pickupAt.slice(0, 13) === hour).length,
  }
}

// ---------- คะแนนสะสม ----------
const today = () => toDateStr(new Date())
export const customerPoints = (c) => pointBalance(c?.ledger, today())

function earnPoints(c, points, reason, orderId = null) {
  if (!(points > 0)) return null
  const lot = { id: uid('pt'), at: now(), delta: points, reason, orderId, expiresAt: addDays(today(), db.loyalty.pointExpireDays), remaining: points }
  c.ledger.push(lot)
  return lot
}

function spendPoints(c, points, reason, orderId = null) {
  const takes = takePoints(c.ledger, points, today())
  if (!takes) return null
  const e = { id: uid('pt'), at: now(), delta: -points, reason, orderId, takes }
  c.ledger.push(e)
  return e
}

function refundPoints(c, entryId, reason) {
  const e = c.ledger.find((x) => x.id === entryId)
  if (!e || e.refunded) return
  returnPoints(c.ledger, e.takes)
  e.refunded = true
  c.ledger.push({ id: uid('pt'), at: now(), delta: -e.delta, reason, orderId: e.orderId, refund: true })
}

function newCoupon(c, data) {
  const cp = { id: uid('cp'), customerId: c.id, status: 'pending', createdAt: now(), expiresAt: addDays(today(), db.loyalty.couponExpireDays), ...data }
  db.coupons.unshift(cp)
  return cp
}

export const customerCoupons = (c) => db.coupons.filter((x) => x.customerId === c?.id)
export const usableDiscountCoupons = (c) => customerCoupons(c).filter((x) => x.type === 'discount' && couponUsable(x, today()))

// ใช้คะแนน / คูปองเป็นส่วนลดในออร์เดอร์ (พนักงาน)
export function applyPoints(order, points) {
  const c = findCustomer(order.customerId)
  if (!c || order.pointsUsed) return false
  const e = spendPoints(c, points, `ใช้เป็นส่วนลด ${order.code}`, order.id)
  if (!e) return false
  order.pointsUsed = { points, amount: points * db.loyalty.pointValue, entryId: e.id }
  log(order, `ใช้ ${points} คะแนน ลด ${order.pointsUsed.amount.toLocaleString('th-TH')} ฿`)
  return true
}

export function removePoints(order) {
  const c = findCustomer(order.customerId)
  if (!c || !order.pointsUsed) return
  refundPoints(c, order.pointsUsed.entryId, `คืนคะแนน ${order.code}`)
  log(order, `ยกเลิกการใช้ ${order.pointsUsed.points} คะแนน`)
  order.pointsUsed = null
}

export function applyCoupon(order, couponId) {
  const cp = db.coupons.find((x) => x.id === couponId)
  if (!cp || cp.type !== 'discount' || !couponUsable(cp, today())) return false
  Object.assign(cp, { status: 'used', orderId: order.id, usedAt: now() })
  order.couponsUsed.push({ couponId, name: cp.name, amount: cp.amount })
  log(order, `ใช้คูปอง ${cp.name}`)
  return true
}

export function removeCoupon(order, couponId) {
  const cp = db.coupons.find((x) => x.id === couponId)
  if (cp) Object.assign(cp, { status: 'pending', orderId: null, usedAt: null })
  order.couponsUsed = order.couponsUsed.filter((x) => x.couponId !== couponId)
  log(order, `ยกเลิกการใช้คูปอง ${cp?.name || ''}`)
}

// ส่งมอบ: ได้คะแนน + สิทธิ์หมุน ตามยอดรวม
function awardOrder(order) {
  const c = findCustomer(order.customerId)
  if (!c || order.loyalty) return
  const total = Math.max(orderTotals(order).total, 0)
  const points = Math.floor(total / db.loyalty.earnPer)
  const spins = Math.floor(total / db.loyalty.spinPer)
  const lot = earnPoints(c, points, `ออร์เดอร์ ${order.code}`, order.id)
  c.spins += spins
  order.loyalty = { points, spins, lotId: lot?.id || null }
  if (points || spins) log(order, `ได้ ${points} คะแนน${spins ? ` + สิทธิ์หมุน ${spins} ครั้ง` : ''}`)
}

// ยกเลิก: คืนคะแนน/คูปองที่ใช้ และตัดคะแนน/สิทธิ์หมุนที่ได้
function undoLoyalty(order) {
  if (order.pointsUsed) removePoints(order)
  for (const u of [...order.couponsUsed]) removeCoupon(order, u.couponId)
  const c = findCustomer(order.customerId)
  if (c && order.loyalty) {
    const lot = c.ledger.find((x) => x.id === order.loyalty.lotId)
    if (lot) {
      const cut = lot.remaining
      lot.remaining = 0
      if (cut) c.ledger.push({ id: uid('pt'), at: now(), delta: -cut, reason: `ตัดคะแนน ${order.code} (ยกเลิก)`, orderId: order.id })
    }
    c.spins = Math.max(0, c.spins - order.loyalty.spins)
    order.loyalty = null
  }
}

// ---------- ฝั่งลูกค้า: แลกของ / หมุนกาชา ----------
export function redeemReward(c, rewardId) {
  const rw = db.rewards.find((x) => x.id === rewardId && x.active !== false)
  if (!rw || !spendPoints(c, rw.points, `แลก ${rw.name}`)) return null
  return newCoupon(c, { type: 'reward', rewardId: rw.id, name: rw.name, source: 'redeem' })
}

// usePoints = true ใช้คะแนนหมุน, false ใช้สิทธิ์หมุน
export function spinGacha(c, usePoints) {
  if (usePoints) {
    if (!spendPoints(c, db.loyalty.spinCost, 'หมุนกาชา')) return null
  } else {
    if (!(c.spins > 0)) return null
    c.spins -= 1
  }
  const prize = pickPrize(db.gachaPrizes)
  if (!prize) return null
  if (prize.type === 'points') earnPoints(c, Number(prize.value) || 0, `กาชา: ${prize.name}`)
  if (prize.type === 'reward') {
    const rw = db.rewards.find((x) => x.id === prize.rewardId)
    newCoupon(c, { type: 'reward', rewardId: prize.rewardId, name: rw?.name || prize.name, source: 'gacha' })
  }
  if (prize.type === 'discount') newCoupon(c, { type: 'discount', amount: Number(prize.value) || 0, name: prize.name, source: 'gacha' })
  db.spinLog.unshift({ id: uid('sp'), customerId: c.id, at: now(), prizeId: prize.id, prizeName: prize.name, via: usePoints ? 'points' : 'spin' })
  return prize
}

// หลังบ้าน: มอบของรางวัลแล้ว
export function markCouponDelivered(cp) {
  Object.assign(cp, { status: 'delivered', deliveredAt: now(), deliveredBy: session.role })
}

export const saveReward = (d) => upsert(db.rewards, 'rw', { ...d, points: Number(d.points) || 0 })
export const savePrize = (d) => upsert(db.gachaPrizes, 'gp', { ...d, chance: Number(d.chance) || 0, value: Number(d.value) || 0 })
export function saveLoyaltySettings(d) {
  for (const k of Object.keys(db.loyalty)) db.loyalty[k] = Math.max(Number(d[k]) || 0, 0)
}

// ---------- ออร์เดอร์ตัวอย่าง ----------
function seed() {
  const o1 = createOrder({
    customerId: 'c1', pickupAt: at(1, 14), fulfillment: 'pickup',
    items: [{ id: uid('i'), kind: 'custom', name: 'วิปครีม · ช็อกโกแลต · 2 ปอนด์', qty: 1, note: 'ตามรูปตัวอย่าง', images: [],
      tiers: [{ selections: { g_size: 's2', g_sponge: 'sp2', g_filling: ['f2'], g_frosting: 'fr1' } }],
      selections: { g_shape: 'sh3', g_color: 'ชมพูพาสเทล', g_topping: ['tp2'], g_message: 'HBD แม่ 60 ปี', g_extra: ['x2'] } }],
  })
  reportPayment(o1, { amount: 600, method: 'โอนเงิน', paidAt: at(0, 9) })
  confirmPayment(o1, o1.payments[0].id)

  const o2 = createOrder({
    customerId: 'c2', pickupAt: at(1, 14, 30), fulfillment: 'delivery', address: '99/9 ซ.สุขุมวิท 50 กรุงเทพฯ', shippingFee: 120,
    items: [{ id: uid('i'), kind: 'ready', productId: 'p1', name: 'เค้กช็อกโกแลตฟัดจ์', qty: 1, note: '', images: [], selections: { g_message: 'Happy Birthday', g_diet: ['dt1'] } }],
  })
  reportPayment(o2, { amount: 540, method: 'โอนเงิน', paidAt: at(0, 10) })

  createOrder({
    customerId: 'c3', pickupAt: at(3, 10), fulfillment: 'pickup',
    items: [{ id: uid('i'), kind: 'ready', productId: 'p3', name: 'เค้กใบเตยมะพร้าวอ่อน', qty: 3, note: '', images: [], selections: { g_extra: ['x6'] } }],
  })

  const o4 = createOrder({
    customerId: 'c1', pickupAt: at(0, 17), fulfillment: 'delivery', address: '12 ถ.พระราม 9 กรุงเทพฯ', shippingFee: 80,
    items: [{ id: uid('i'), kind: 'ready', productId: 'p4', name: 'เรดเวลเวท', qty: 1, note: '', images: [], selections: {} }],
  })
  reportPayment(o4, { amount: 530, method: 'เงินสด', paidAt: at(-1, 15) })
  confirmPayment(o4, o4.payments[0].id)
  setStatus(o4, 'preparing', 'เริ่มเตรียมสินค้า')

  createOrder({
    customerId: 'c2', pickupAt: at(5, 13), fulfillment: 'pickup',
    items: [{ id: uid('i'), kind: 'ready', productId: 'p2', name: 'เค้กส้ม', qty: 1, note: '', images: [], selections: {} }],
  }, true)
}
seed()

// คะแนนตัวอย่าง
earnPoints(db.customers[0], 120, 'คะแนนตัวอย่าง')
db.customers[0].spins = 2
const nearLot = earnPoints(db.customers[1], 40, 'คะแนนตัวอย่าง')
nearLot.expiresAt = addDays(today(), 10)
