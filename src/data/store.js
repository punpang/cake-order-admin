// ข้อมูลตัวอย่าง (เก็บในหน่วยความจำ รีเฟรชแล้วหาย)
// ขั้นต่อไปจะเปลี่ยนฟังก์ชันในไฟล์นี้ให้เรียก Supabase แทน
import { reactive } from 'vue'
import { PERMISSIONS } from '../lib/constants'
import { calcUnitPrice } from '../lib/pricing'
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
const opt = (id, name, price = 0, priceType = 'fixed', extra = {}) => ({ id, name, price, priceType, active: true, ...extra })

export const db = reactive({
  customers: [
    { id: 'c1', name: 'คุณมะลิ ใจดี', phone: '0812345678', line: 'mali.j', note: '' },
    { id: 'c2', name: 'คุณสมชาย รักเค้ก', phone: '0899998888', line: '', note: 'ชอบหวานน้อย' },
    { id: 'c3', name: 'บริษัท ขนมหวาน จำกัด', phone: '021234567', line: 'sweetco', note: 'ขอใบกำกับภาษี' },
  ],

  // เค้กสำเร็จ
  products: [
    { id: 'p1', name: 'เค้กช็อกโกแลตฟัดจ์', pounds: 1, price: 420, active: true },
    { id: 'p2', name: 'เค้กส้ม', pounds: 1, price: 390, active: true },
    { id: 'p3', name: 'เค้กใบเตยมะพร้าวอ่อน', pounds: 2, price: 690, active: true },
    { id: 'p4', name: 'เรดเวลเวท', pounds: 1, price: 450, active: true },
  ],

  // ผู้ใช้ระบบ (email ใช้ล็อกอินเมื่อต่อ Supabase)
  users: [
    { id: 'u1', name: 'แอดมิน', email: 'admin@example.com', role: 'admin', active: true },
    { id: 'u2', name: 'พนักงานขาย', email: 'sales@example.com', role: 'sales', active: true },
    { id: 'u3', name: 'คนทำเค้ก', email: 'baker@example.com', role: 'baker', active: true },
    { id: 'u4', name: 'คนส่งของ', email: 'driver@example.com', role: 'driver', active: true },
  ],

  // กลุ่มตัวเลือก: type = single | multi | text, appliesTo = custom/ready
  optionGroups: [
    { id: 'g_size', key: 'size', name: 'ขนาด', type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('s1', '1 ปอนด์', 450, 'fixed', { pounds: 1 }),
      opt('s2', '2 ปอนด์', 850, 'fixed', { pounds: 2 }),
      opt('s3', '3 ปอนด์', 1250, 'fixed', { pounds: 3 }),
      opt('s4', '5 ปอนด์', 2000, 'fixed', { pounds: 5 }),
    ] },
    { id: 'g_shape', name: 'รูปทรง', type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('sh1', 'กลม'), opt('sh2', 'สี่เหลี่ยม'), opt('sh3', 'หัวใจ', 100), opt('sh4', 'ตัวเลข/ตัวอักษร', 300),
    ] },
    { id: 'g_tier', name: 'จำนวนชั้น', type: 'single', required: false, appliesTo: ['custom'], options: [
      opt('t1', '1 ชั้น'), opt('t2', '2 ชั้น', 600), opt('t3', '3 ชั้น', 1200),
    ] },
    { id: 'g_sponge', name: 'เนื้อเค้ก', type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('sp1', 'วานิลลา'), opt('sp2', 'ช็อกโกแลต', 30, 'per_pound'), opt('sp3', 'ใบเตย'),
      opt('sp4', 'เรดเวลเวท', 50, 'per_pound'), opt('sp5', 'ชาไทย', 30, 'per_pound'),
    ] },
    { id: 'g_filling', name: 'สอดไส้', type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('f1', 'ครีมสด'), opt('f2', 'สตรอว์เบอร์รี', 60, 'per_pound'), opt('f3', 'บลูเบอร์รี', 60, 'per_pound'),
      opt('f4', 'คัสตาร์ด', 40, 'per_pound'), opt('f5', 'ช็อกโกแลตกานาช', 50, 'per_pound'),
    ] },
    { id: 'g_frosting', name: 'หน้าเค้ก/ครีม', type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('fr1', 'วิปครีม'), opt('fr2', 'บัตเตอร์ครีม', 50, 'per_pound'), opt('fr3', 'ฟองดองท์', 200, 'per_pound'),
      opt('fr4', 'ช็อกโกแลตกานาช', 80, 'per_pound'), opt('fr5', 'ครีมชีส', 80, 'per_pound'),
    ] },
    { id: 'g_color', name: 'สีธีม', type: 'text', required: false, appliesTo: ['custom'], placeholder: 'เช่น ชมพูพาสเทล + ขาว' },
    { id: 'g_topping', name: 'On top / ท็อปปิ้ง', type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('tp1', 'ผลไม้รวม', 150), opt('tp2', 'สตรอว์เบอร์รีสด', 180), opt('tp3', 'มาการอง', 200),
      opt('tp4', 'ช็อกโกแลตแท่ง/ตกแต่ง', 120), opt('tp5', 'เม็ดมุกน้ำตาล', 50),
    ] },
    { id: 'g_deco', name: 'ตกแต่ง', type: 'multi', required: false, appliesTo: ['custom'], options: [
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

// ทุกรายการเริ่มต้นเป็น "ใช้งาน"
for (const c of db.customers) c.active = true
for (const g of db.optionGroups) g.active = true

// ---------- ฟังก์ชัน ----------
let orderNo = 0
const nextCode = () => `OR-${String(++orderNo).padStart(4, '0')}`

export const findOrder = (id) => db.orders.find((o) => o.id === id)
export const findCustomer = (id) => db.customers.find((c) => c.id === id)

export function addCustomer(data) {
  const c = { id: uid('c'), name: data.name.trim(), phone: data.phone?.trim() || '', line: data.line?.trim() || '', note: data.note?.trim() || '', active: true }
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

export const saveCustomer = (d) => upsert(db.customers, 'c', d)
export const saveProduct = (d) => upsert(db.products, 'p', { ...d, price: Number(d.price) || 0, pounds: Number(d.pounds) || 1 })
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
  const data = { ...d, price: Number(d.price) || 0 }
  if (g.key === 'size') data.pounds = Number(d.pounds) || 1
  return upsert(g.options, 'o', data)
}

// จำนวนออร์เดอร์ของลูกค้า
export const customerOrderCount = (id) => db.orders.filter((o) => o.customerId === id).length

export function priceItem(item) {
  return { ...item, unitPrice: calcUnitPrice(item, db.optionGroups, db.products) }
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
    items: payload.items.map(priceItem),
    adjustment: { amount: 0, reason: '' },
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
}

export function reportPayment(order, p) {
  order.payments.push({
    id: uid('pay'),
    amount: Number(p.amount),
    method: p.method,
    paidAt: p.paidAt,
    slip: p.slip || '',
    note: p.note || '',
    status: 'reported',
    reportedBy: session.role,
    confirmedBy: null,
  })
  log(order, `แจ้งชำระ ${Number(p.amount).toLocaleString('th-TH')} ฿ (${p.method})`)
  if (order.status === 'awaiting_payment') order.status = 'payment_reported'
}

export function confirmPayment(order, paymentId) {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!p) return
  p.status = 'confirmed'
  p.confirmedBy = session.role
  log(order, `ยืนยันชำระ ${p.amount.toLocaleString('th-TH')} ฿`)
  if (['awaiting_payment', 'payment_reported'].includes(order.status)) order.status = 'payment_confirmed'
}

export function setAdjustment(order, amount, reason) {
  order.adjustment = { amount: Number(amount) || 0, reason }
  log(order, `ปรับราคา ${Number(amount).toLocaleString('th-TH')} ฿ (${reason})`)
}

export function cancelOrder(order, c) {
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

// ---------- ออร์เดอร์ตัวอย่าง ----------
function seed() {
  const o1 = createOrder({
    customerId: 'c1', pickupAt: at(1, 14), fulfillment: 'pickup',
    items: [{ id: uid('i'), kind: 'custom', name: 'เค้กสั่งทำ 2 ปอนด์', qty: 1, note: 'ตามรูปตัวอย่าง', images: [],
      selections: { g_size: 's2', g_shape: 'sh3', g_sponge: 'sp2', g_filling: ['f2'], g_frosting: 'fr1', g_color: 'ชมพูพาสเทล', g_topping: ['tp2'], g_message: 'HBD แม่ 60 ปี', g_extra: ['x2'] } }],
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
