// ข้อมูลตัวอย่าง (เก็บในหน่วยความจำ รีเฟรชแล้วหาย)
// ขั้นต่อไปจะเปลี่ยนฟังก์ชันในไฟล์นี้ให้เรียก Supabase แทน
import { reactive } from 'vue'
import { PERMISSIONS } from '../lib/constants'
import { activeLists, priceDetail, orderTotals } from '../lib/pricing'
import { addDays, pointBalance, takePoints, returnPoints, couponUsable, pickPrize } from '../lib/loyalty'
import { pad, toDateStr } from '../lib/format'
import { nextBirthday, daysBetween } from '../lib/birthday'

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
// ราคาตามขนาด 1 / 2 / 3 / 5 ปอนด์ (s1–s4)
const sp = (a, b, c, d) => ({ s1: a, s2: b, s3: c, s4: d })
// หน้าเค้ก: ราคาตามขนาด (sizePrices) · เนื้อเค้ก: บวกคงที่ (price)
const faceOpt = (id, name, sizePrices, extra = {}) => ({ id, name, sizePrices, active: true, recipe: [], ...extra })
const flavorOpt = (id, name, price = 0, extra = {}) => ({ id, name, price, active: true, recipe: [], ...extra })

export const db = reactive({
  customers: [
    { id: 'c1', name: 'คุณมะลิ ใจดี', phone: '0812345678', line: 'mali.j', note: '' },
    { id: 'c2', name: 'คุณสมชาย รักเค้ก', phone: '0899998888', line: '', note: 'ชอบหวานน้อย' },
    { id: 'c3', name: 'บริษัท ขนมหวาน จำกัด', phone: '021234567', line: 'sweetco', note: 'ขอใบกำกับภาษี' },
  ],

  // ตั้งค่าร้าน: เวลานัดรับ ทุก slotMinutes นาที ระหว่าง open–close, nearbyHours = ค่าเริ่มต้นช่วงดูออร์เดอร์ก่อน/หลัง (0 = ทั้งวัน)
  // leadPickup / leadDelivery = ต้องเสร็จก่อนนัดกี่นาที (ตารางผลิต), depositPercent = มัดจำขั้นต่ำ % (0 = ไม่ใช้), birthdayDays = เตือนวันเกิดล่วงหน้ากี่วัน
  shop: { slotMinutes: 30, open: '09:00', close: '20:00', nearbyHours: 2, leadPickup: 60, leadDelivery: 120, depositPercent: 50, birthdayDays: 14 },
  // เตือนวันเกิด: key ที่กด "ทักแล้ว" (ลูกค้า|ชื่อ|MM-DD|ปี)
  birthdayGreeted: [],

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
  // ราคาพิเศษของตัวเลือกรองเก็บใน special: { [priceListId]: ราคา } ของตัวเลือกนั้น
  // ตารางราคาพิเศษ: sizes = { [sizeId] }, faces = { [faceId]: { [sizeId] } }, flavors = { [flavorId] } ช่องว่าง = ใช้ราคาปกติ
  priceLists: [
    { id: 'pl1', name: 'โปรเปิดร้าน', active: true, scheduled: true, from: at(-1, 0).slice(0, 10), to: at(7, 0).slice(0, 10), sizes: { s1: 400 }, faces: {}, flavors: {} },
    { id: 'pl2', name: 'ราคาสมาชิก', active: false, scheduled: false, from: '', to: '', sizes: {}, faces: {}, flavors: {} },
  ],

  // วัตถุดิบ (ตัวอย่าง)
  ingredients: [
    // ต้นทุน: packSize = ขนาดแพ็ก (หน่วยเดียวกับ unit), packPrice = ราคาต่อแพ็ก
    { id: 'm1', name: 'แป้งเค้ก', unit: 'g', packSize: 1000, packPrice: 45, active: true },
    { id: 'm2', name: 'น้ำตาลทราย', unit: 'g', packSize: 1000, packPrice: 28, active: true },
    { id: 'm3', name: 'ไข่ไก่', unit: 'ฟอง', packSize: 30, packPrice: 120, active: true },
    { id: 'm4', name: 'เนยจืด', unit: 'g', packSize: 454, packPrice: 135, active: true },
    { id: 'm5', name: 'วิปปิ้งครีม', unit: 'ml', packSize: 1000, packPrice: 190, active: true },
    { id: 'm6', name: 'ผงโกโก้', unit: 'g', packSize: 500, packPrice: 160, active: true },
    { id: 'm7', name: 'สตรอว์เบอร์รีสด', unit: 'g', packSize: 1000, packPrice: 250, active: true },
    { id: 'm8', name: 'กล่องเค้ก', unit: 'ใบ', packSize: 50, packPrice: 500, active: true },
  ],

  // เค้กสำเร็จ: ราคา = หน้าเค้ก (faceId ตามขนาด) + เนื้อเค้ก (flavorId) + ขนาด (sizeId) · recipe = สูตรวัตถุดิบของสินค้า (ตัวเลขตัวอย่าง)
  products: [
    { id: 'p1', name: 'เค้กช็อกโกแลตฟัดจ์', faceId: 'fr4', flavorId: 'sp2', sizeId: 's1', active: true, recipe: [r('m1', 150), r('m2', 120), r('m3', 3), r('m4', 80), r('m6', 40), r('m8', 1, 'piece')] },
    { id: 'p2', name: 'เค้กส้ม', faceId: 'fr1', flavorId: 'sp1', sizeId: 's1', active: true, recipe: [r('m1', 160), r('m2', 130), r('m3', 3), r('m4', 70), r('m8', 1, 'piece')] },
    { id: 'p3', name: 'เค้กใบเตยมะพร้าวอ่อน', faceId: 'fc1', flavorId: 'sp3', sizeId: 's2', active: true, recipe: [r('m1', 150), r('m2', 110), r('m3', 3), r('m5', 150), r('m8', 1, 'piece')] },
    { id: 'p4', name: 'เรดเวลเวท', faceId: 'fr5', flavorId: 'sp4', sizeId: 's1', active: true, recipe: [r('m1', 150), r('m2', 130), r('m3', 3), r('m4', 80), r('m6', 10), r('m8', 1, 'piece')] },
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
    // ---- กลุ่มหลัก: หน้าเค้ก > เนื้อเค้ก > ขนาด ----
    // ราคาเค้กหลัก = หน้าเค้ก (ตามขนาด) + เนื้อเค้ก (บวกคงที่) + ราคาขนาด ตั้งที่หน้าการกำหนดราคา
    { id: 'g_frosting', key: 'face', name: 'หน้าเค้ก', prepList: true, perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      faceOpt('fc1', 'เค้กแยมมะพร้าวอ่อน', sp(100, 180, 260, 400)), faceOpt('fc2', 'เค้กหน้านิ่ม', sp(50, 100, 150, 250), { allow: { g_sponge: ['sp2', 'sp3', 'sp4', 'sp5'] } }),
      faceOpt('fr1', 'วิปครีม', sp(0, 0, 0, 0), { recipe: [r('m5', 200), r('m2', 20)] }), faceOpt('fr2', 'บัตเตอร์ครีม', sp(50, 100, 150, 250)), faceOpt('fr3', 'ฟองดองท์', sp(200, 400, 600, 1000)),
      faceOpt('fr4', 'ช็อกโกแลตกานาช', sp(80, 160, 240, 400)), faceOpt('fr5', 'ครีมชีส', sp(80, 160, 240, 400)),
    ] },
    { id: 'g_sponge', key: 'flavor', name: 'เนื้อเค้ก', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      flavorOpt('sp1', 'วานิลลา', 0, { recipe: [r('m1', 150), r('m2', 120), r('m3', 3), r('m4', 70)] }),
      flavorOpt('sp2', 'ช็อกโกแลต', 30, { recipe: [r('m1', 140), r('m2', 120), r('m3', 3), r('m4', 70), r('m6', 30)] }), flavorOpt('sp3', 'ใบเตย'),
      flavorOpt('sp4', 'เรดเวลเวท', 50), flavorOpt('sp5', 'ชาไทย', 30),
    ] },
    { id: 'g_size', key: 'size', name: 'ขนาด', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('s1', '1 ปอนด์', 450, 'fixed', { pounds: 1, recipe: [r('m8', 1, 'piece')] }),
      opt('s2', '2 ปอนด์', 850, 'fixed', { pounds: 2, recipe: [r('m8', 1, 'piece')] }),
      opt('s3', '3 ปอนด์', 1250, 'fixed', { pounds: 3, recipe: [r('m8', 1, 'piece')] }),
      opt('s4', '5 ปอนด์', 2000, 'fixed', { pounds: 5, recipe: [r('m8', 1, 'piece')] }),
    ] },
    // ---- ตัวเลือกรอง ----
    { id: 'g_shape', name: 'รูปทรง', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      opt('sh1', 'กลม'), opt('sh2', 'สี่เหลี่ยม'), opt('sh3', 'หัวใจ', 100), opt('sh4', 'ตัวเลข/ตัวอักษร', 300),
    ] },
    { id: 'g_filling', name: 'สอดไส้', prepList: true, perTier: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('f1', 'ครีมสด', 0, 'fixed', { recipe: [r('m5', 100)] }),
      opt('f2', 'สตรอว์เบอร์รี', 0, 'per_size', { sizePrices: sp(60, 110, 160, 250), recipe: [r('m7', 80)] }),
      opt('f3', 'บลูเบอร์รี', 0, 'per_size', { sizePrices: sp(60, 110, 160, 250) }),
      opt('f4', 'คัสตาร์ด', 0, 'per_size', { sizePrices: sp(40, 70, 100, 160) }),
      opt('f5', 'ช็อกโกแลตกานาช', 0, 'per_size', { sizePrices: sp(50, 90, 130, 200) }),
    ], bundles: [
      { id: 'b1', name: 'สตรอว์เบอร์รี + บลูเบอร์รี', options: ['f2', 'f3'], discount: sp(20, 30, 40, 60), active: true },
    ] },
    { id: 'g_color', name: 'สีธีม', perTier: true, type: 'text', required: false, appliesTo: ['custom'], placeholder: 'เช่น ชมพูพาสเทล + ขาว' },
    { id: 'g_topping', name: 'On top / ท็อปปิ้ง', prepList: true, perTier: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('tp1', 'ผลไม้รวม', 0, 'per_size', { sizePrices: sp(150, 250, 350, 500) }),
      opt('tp2', 'สตรอว์เบอร์รีสด', 0, 'per_size', { sizePrices: sp(180, 300, 420, 600), recipe: [r('m7', 150, 'piece')] }),
      opt('tp3', 'มาการอง', 0, 'per_size', { sizePrices: sp(200, 300, 400, 550) }),
      opt('tp4', 'ช็อกโกแลตแท่ง/ตกแต่ง', 0, 'per_size', { sizePrices: sp(120, 180, 240, 350) }),
      opt('tp5', 'เม็ดมุกน้ำตาล', 0, 'per_size', { sizePrices: sp(50, 80, 110, 160) }),
    ] },
    { id: 'g_deco', name: 'ตกแต่ง', prepList: true, perTier: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
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
// ตารางราคา { [k]: { [sizeId]: ราคา } } ตัดช่องว่าง
const cleanTable = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, cleanSpecial(v)]))
export const savePriceList = (d) => upsert(db.priceLists, 'pl', { ...d, sizes: cleanSpecial(d.sizes), faces: cleanTable(d.faces), flavors: cleanSpecial(d.flavors) })
// ตารางราคาเค้กหลัก (หน้าการกำหนดราคา): sizes = { [sizeId] }, faces = { [faceId]: { [sizeId] } }, flavors = { [flavorId] }
export function saveMainPrices({ sizes = {}, faces = {}, flavors = {} }) {
  const byKey = (k) => db.optionGroups.find((x) => x.key === k)?.options || []
  for (const o of byKey('size')) if (sizes[o.id] !== undefined) o.price = Number(sizes[o.id]) || 0
  for (const o of byKey('face')) if (faces[o.id]) o.sizePrices = { ...(o.sizePrices || {}), ...cleanSpecial(faces[o.id]) }
  for (const o of byKey('flavor')) if (flavors[o.id] !== undefined) o.price = Number(flavors[o.id]) || 0
}
export const saveIngredient = (d) => upsert(db.ingredients, 'm', { ...d, packSize: Number(d.packSize) || 0, packPrice: Number(d.packPrice) || 0 })
export const saveProduct = (d) => upsert(db.products, 'p', { ...d, recipe: cleanRecipe(d.recipe) })
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
  const data = { ...d, recipe: cleanRecipe(d.recipe) }
  // ขนาด/หน้าเค้ก/เนื้อเค้ก: ราคาตั้งในหน้าการกำหนดราคา (ไม่แตะราคาที่นี่) · ตัวเลือกรอง: ราคาแบบเดิม
  for (const k of ['price', 'priceType', 'special', 'sizePrices', 'level', 'pounds']) delete data[k]
  if (g.key === 'size') {
    data.pounds = Number(d.pounds) || 1
    if (!d.id) data.price = 0
  } else if (g.key === 'face') {
    if (!d.id) data.sizePrices = {}
  } else if (g.key === 'flavor') {
    if (!d.id) data.price = 0
  } else {
    Object.assign(data, { price: Number(d.price) || 0, priceType: d.priceType || 'fixed', special: cleanSpecial(d.special) })
    if (data.priceType === 'per_size') data.sizePrices = cleanSpecial(d.sizePrices)
  }
  return upsert(g.options, 'o', data)
}

// บันเดิ้ล (คู่ตัวเลือกในกลุ่มเดียวกัน ลดราคาตามขนาด)
export function saveBundle(groupId, d) {
  const g = findGroup(groupId)
  if (!g) return null
  if (!g.bundles) g.bundles = []
  return upsert(g.bundles, 'b', { ...d, options: [...d.options], discount: cleanSpecial(d.discount) })
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
    birthday: payload.birthday?.md ? { name: payload.birthday.name || '', md: payload.birthday.md } : null, // { name, md: 'MM-DD' }
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

export function saveShopSettings(d) {
  db.shop.slotMinutes = Math.max(5, Number(d.slotMinutes) || 30)
  db.shop.open = d.open || '09:00'
  db.shop.close = d.close || '20:00'
  db.shop.nearbyHours = Math.max(0, Number(d.nearbyHours) || 0)
  db.shop.leadPickup = Math.max(0, Number(d.leadPickup) || 0)
  db.shop.leadDelivery = Math.max(0, Number(d.leadDelivery) || 0)
  db.shop.depositPercent = Math.min(100, Math.max(0, Number(d.depositPercent) || 0))
  db.shop.birthdayDays = Math.max(0, Number(d.birthdayDays) || 0)
}

// แก้วันเวลานัด (หน้ารายละเอียด)
export function setPickup(order, pickupAt) {
  if (order.pickupAt === pickupAt) return
  const fmt = (s) => s.replace('T', ' ')
  log(order, `เปลี่ยนวันนัด ${fmt(order.pickupAt)} → ${fmt(pickupAt)}`)
  order.pickupAt = pickupAt
}

// วันเกิดในออร์เดอร์ (null = ไม่มี)
export function setBirthday(order, b) {
  order.birthday = b?.md ? { name: b.name || '', md: b.md } : null
  log(order, order.birthday ? `บันทึกวันเกิด ${order.birthday.name || ''} ${order.birthday.md}`.replace('  ', ' ') : 'ลบวันเกิด')
}

// เวลาที่ต้องทำเสร็จ = เวลานัด − เวลาเผื่อ (รับที่ร้าน / จัดส่ง)
export function dueAt(order) {
  const lead = order.fulfillment === 'delivery' ? db.shop.leadDelivery : db.shop.leadPickup
  const d = new Date(order.pickupAt)
  d.setMinutes(d.getMinutes() - (Number(lead) || 0))
  return d
}

// มัดจำขั้นต่ำของออร์เดอร์ (ปัดขึ้นเป็นบาท)
export const depositOf = (total) => Math.ceil((Math.max(total, 0) * (Number(db.shop.depositPercent) || 0)) / 100)

// ---------- วันเกิด ----------
const bdKey = (b, year) => `${b.customerId}|${b.name}|${b.md}|${year}`

// วันเกิดจากออร์เดอร์ (ไม่นับยกเลิก) ไม่ซ้ำตาม ลูกค้า + ชื่อ + วัน ใช้ออร์เดอร์ล่าสุด
export function birthdayList(customerId = null) {
  const map = new Map()
  for (const o of db.orders) {
    if (!o.birthday?.md || o.status === 'cancelled') continue
    if (customerId && o.customerId !== customerId) continue
    const name = (o.birthday.name || '').trim()
    const k = `${o.customerId}|${name}|${o.birthday.md}`
    const cur = map.get(k)
    if (!cur || cur.order.pickupAt < o.pickupAt) map.set(k, { customerId: o.customerId, name, md: o.birthday.md, order: o })
  }
  return [...map.values()]
}

// วันเกิดที่จะถึงภายใน days วัน (วันนี้ = 0) เรียงใกล้สุดก่อน
export function upcomingBirthdays(days = db.shop.birthdayDays) {
  const today = toDateStr(new Date())
  return birthdayList()
    .map((b) => {
      const date = nextBirthday(b.md)
      const year = Number(date.slice(0, 4))
      return { ...b, date, inDays: daysBetween(today, date), greeted: db.birthdayGreeted.includes(bdKey(b, year)), year }
    })
    .filter((b) => b.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays)
}

export function setGreeted(b, on) {
  const k = bdKey(b, b.year)
  const i = db.birthdayGreeted.indexOf(k)
  if (on && i < 0) db.birthdayGreeted.push(k)
  if (!on && i >= 0) db.birthdayGreeted.splice(i, 1)
}

// เวลานัดที่เลือกได้ของวัน (HH:MM) ตามช่วงเวลา และตัดเวลาที่ผ่านไปแล้ว
export function pickupSlots(dateStr) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const out = []
  const now = new Date()
  for (let m = toMin(db.shop.open); m <= toMin(db.shop.close); m += db.shop.slotMinutes) {
    const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
    if (new Date(`${dateStr}T${t}`) > now) out.push(t)
  }
  return out
}

// ออร์เดอร์ (ไม่นับยกเลิก) ก่อน/หลังเวลานัด ภายใน hours ชั่วโมง (0 = ทั้งวัน)
export function nearbyOrders(pickupAt, hours, excludeId) {
  if (!pickupAt) return { before: [], after: [] }
  const at = new Date(pickupAt).getTime()
  const day = pickupAt.slice(0, 10)
  const list = db.orders
    .filter((o) => o.status !== 'cancelled' && o.id !== excludeId)
    .filter((o) => (hours ? Math.abs(new Date(o.pickupAt).getTime() - at) <= hours * 3600000 : o.pickupAt.slice(0, 10) === day))
    .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt))
  return {
    before: list.filter((o) => new Date(o.pickupAt).getTime() < at),
    after: list.filter((o) => new Date(o.pickupAt).getTime() >= at),
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
    customerId: 'c1', pickupAt: at(1, 14), fulfillment: 'pickup', birthday: { name: 'แม่', md: at(5, 0).slice(5, 10) },
    items: [{ id: uid('i'), kind: 'custom', name: 'วิปครีม · ช็อกโกแลต · 2 ปอนด์', qty: 1, note: 'ตามรูปตัวอย่าง', images: [],
      tiers: [{ selections: { g_size: 's2', g_sponge: 'sp2', g_filling: ['f2'], g_frosting: 'fr1', g_shape: 'sh3', g_color: 'ชมพูพาสเทล', g_topping: ['tp2'] } }],
      selections: { g_message: 'HBD แม่ 60 ปี', g_extra: ['x2'] } }],
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
