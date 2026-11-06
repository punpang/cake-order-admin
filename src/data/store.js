// ข้อมูลตัวอย่าง (เก็บในหน่วยความจำ รีเฟรชแล้วหาย)
// ขั้นต่อไปจะเปลี่ยนฟังก์ชันในไฟล์นี้ให้เรียก Supabase แทน
import { reactive } from 'vue'
import { PERMISSIONS, ALL_PERMS, rolePreset, CHANNELS, CUSTOMER_CHANNEL_ORDER, NOTIFY_EVENTS, POS_METHODS } from '../lib/constants'
import { activeLists, priceDetail, orderTotals, itemNets, describeSelections } from '../lib/pricing'
import { applyPosPromos, pointMultiplier, round2, blankSchedule } from '../lib/posPromo'
import { REFUND_METHODS, normalizeRefunds, refundErrors, defaultRefundMethod, refundList } from '../lib/refund'
import { addDays, pointBalance, takePoints, returnPoints, couponUsable, pickPrize, expiringSoon } from '../lib/loyalty'
import { pad, toDateStr, money, phoneDigits, phoneValid, formatPhone, dateOnly, timeOnly } from '../lib/format'
import { nextBirthday, daysBetween } from '../lib/birthday'
import { parseAnswer } from '../lib/chatParse'
import { LEGAL_KINDS, ACCOUNT_CONSENT_KINDS, DEFAULT_PRIVACY, DEFAULT_TERMS, DEFAULT_COOKIE, DEFAULT_LEGAL_CONTACT } from '../lib/legalDefaults'
import { BOT_DEFAULTS, botReply, scrubPII, similarity, isSensitive, LEARN_MAX } from '../lib/chatBot'
import { checkTelegram, checkSmsUrl, checkSmsSender } from '../lib/integrationCheck'
import { genToken, isTokenShape, hashToken, genCode, isCodeShape, cleanPolicy, cleanAllowlist, checkTarget, linkAlive, linkExpiresAt, failBlocked, DEFAULT_LINK_POLICY, LINK_ERROR } from '../lib/orderLink'
import { digitsOf, promptPayKind } from '../lib/promptpay'
import { cleanClosures, emptyClosures, slotClosed, pickupClosed, isClosedNow, nextOpen } from '../lib/shopHours'
import { decodeCake, findCodes, CODE_RE } from '../lib/cakeCode'
import { deliveryFee, cleanDelivery, cleanDeliveryConfig, rememberPlace, DEFAULT_DELIVERY } from '../lib/delivery'
import { dueState, overduePayments, orderDue, quickDue, isHHmm, remainingText } from '../lib/payDue'
import { OTP, PIN, OTP_PURPOSE, isPin, isOtpCode, weakPin, randomHex, hashPin, safeEqual, genOtp } from '../lib/customerAuth'

let seq = 1000
const uid = (p) => `${p}${++seq}`
const now = () => new Date().toISOString()

const at = (dayOffset, hh, mm = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  return `${toDateStr(d)}T${pad(hh)}:${pad(mm)}`
}

// ---------- ผู้ใช้ (จำลอง) ----------
// session.userId = ผู้ใช้ที่ทดลองใช้งานอยู่ · session.role = บทบาทของผู้ใช้ (ไว้บันทึกประวัติ/ป้าย)
export const session = reactive({ role: 'admin', userId: 'u1' })
// สิทธิ์จริง = รายการที่ติ๊กของผู้ใช้ (user.perms) · ถ้า session.role ถูกสลับตรง ๆ (ไม่ผ่าน switchUser เช่นในเทสต์) ใช้ค่าตั้งต้นของบทบาทนั้นแทน
const permsOf = () => {
  const u = db.users.find((x) => x.id === session.userId)
  if (u && u.active !== false && u.role === session.role && Array.isArray(u.perms)) return u.perms
  return u && u.active === false ? [] : rolePreset(session.role)
}
export const can = (action) => permsOf().includes(action)
export const canAny = (actions) => (Array.isArray(actions) ? actions : [actions]).some(can)
export function switchUser(userId) {
  const u = db.users.find((x) => x.id === userId && x.active !== false)
  if (!u) return false
  session.userId = u.id
  session.role = u.role
  return true
}
// ออร์เดอร์ที่ผู้ใช้เห็นในรายการ (ตามสิทธิ์ viewAllOrders / viewPrepOrders / viewDeliveryOrders)
const PREP_VISIBLE = ['payment_confirmed', 'order_confirmed', 'preparing', 'prepared']
export function orderVisible(o) {
  if (can('viewAllOrders')) return true
  if (can('viewPrepOrders') && PREP_VISIBLE.includes(o.status)) return true
  if (can('viewDeliveryOrders') && o.fulfillment === 'delivery' && ['preparing', 'prepared', 'delivered'].includes(o.status)) return true
  return false
}

// ---------- ข้อมูลหลัก ----------
// ตัวเลือกรอง: ตามขนาด (sizePrices = { [sizeId]: บาท }) หรือ คงที่ (price)
// types = ใช้ได้กับประเภทไหน (ว่าง = ทุกประเภท), typePrices / typePrice = ราคาแยกประเภท (ว่าง = ราคากลาง)
const opt = (id, name, sizePrices = {}, extra = {}) => ({ id, name, priceType: 'size', sizePrices, price: 0, types: [], typePrices: {}, typePrice: {}, active: true, recipe: [], ...extra })
const fix = (id, name, price = 0, extra = {}) => ({ id, name, priceType: 'fixed', sizePrices: {}, price, types: [], typePrices: {}, typePrice: {}, active: true, recipe: [], ...extra })
// บรรทัดสูตร: วัตถุดิบ, ปริมาณ, ต่อปอนด์ (pound) หรือ ต่อชิ้น (piece)
const r = (ingredientId, qty, per = 'pound') => ({ ingredientId, qty, per })
// ราคาตามขนาด 1 / 2 / 3 / 5 ปอนด์ (s1–s4)
const sp = (a, b, c, d) => ({ s1: a, s2: b, s3: c, s4: d })
// กฎแจ้งเตือน (จำลอง)
const rule = (event, channels, template) => ({ event, channels, template, enabled: true })
// ประเภท: ราคาคงที่ (price) + ราคาขนาดของประเภท (sizePrices) · เนื้อเค้ก: บวกคงที่ (price) · ขนาด: ชื่อ + ปอนด์
const typeOpt = (id, name, price, sizePrices, extra = {}) => ({ id, name, price, sizePrices, active: true, recipe: [], ...extra })
const sizeOpt = (id, name, pounds) => ({ id, name, pounds, active: true, recipe: [r('m8', 1, 'piece')] })
const flavorOpt = (id, name, price = 0, extra = {}) => ({ id, name, price, active: true, recipe: [], ...extra })

export const db = reactive({
  customers: [
    { id: 'c1', name: 'คุณมะลิ ใจดี', phone: '0812345678', line: 'mali.j', note: '' },
    { id: 'c2', name: 'คุณสมชาย รักเค้ก', phone: '0899998888', line: '', note: 'ชอบหวานน้อย' },
    { id: 'c3', name: 'บริษัท ขนมหวาน จำกัด', phone: '021234567', line: 'sweetco', note: 'ขอใบกำกับภาษี' },
  ],

  // ตั้งค่าร้าน: เวลานัดรับ ทุก slotMinutes นาที ระหว่าง open–close, nearbyHours = ค่าเริ่มต้นช่วงดูออร์เดอร์ก่อน/หลัง (0 = ทั้งวัน)
  // leadPickup / leadDelivery = ต้องเสร็จก่อนนัดกี่นาที (ตารางผลิต), depositPercent = มัดจำขั้นต่ำ % (0 = ไม่ใช้), birthdayDays = เตือนวันเกิดล่วงหน้ากี่วัน
  shop: { name: 'ร้านเค้กตัวอย่าง', slotMinutes: 30, open: '09:00', close: '20:00', nearbyHours: 2, leadPickup: 60, leadDelivery: 120, depositPercent: 50, birthdayDays: 14,
    // กำหนดชำระเริ่มต้นตอนแจ้งยอด (นาที) · 0 = ไม่กำหนด
    payDueMin: 30,
    // ตัวเลือกกำหนดชำระตามนัด: ก่อนนัด hoursBefore ชม. · ล่วงหน้า daysBefore วัน ก่อน atTime · เตือนลูกค้าที่ยังไม่ชำระของพรุ่งนี้ตอน payReminderTime
    payDueRule: { hoursBefore: 24, daysBefore: 1, atTime: '12:00' },
    payReminderTime: '09:00',
    // ค่าส่งจากระยะทาง (กม.): ปิดอยู่จนกว่าร้านจะตั้งเรต
    delivery: { ...DEFAULT_DELIVERY },
    // วัน-เวลาปิดร้าน: ประจำสัปดาห์ / ช่วงวัน / ช่วงเวลาในวัน · วัน-เวลานัดที่ตรงช่วงปิดเลือกไม่ได้
    closures: emptyClosures(),
    // ช่องทางชำระเงินที่แสดงให้ลูกค้า (พร้อมเพย์ = เบอร์มือถือ/เลขบัตร/e-Wallet)
    payment: { promptpayId: '', accountName: '', bank: '', accountNo: '', note: '' },
    // VAT: ฐาน = สินค้า+ค่าส่ง หลังส่วนลด · mode inclusive (ราคารวม VAT แล้ว) | exclusive (บวกเพิ่มท้ายยอด) · เก็บ snapshot {rate, mode} ในแต่ละออร์เดอร์ (order.vat)
    vat: { enabled: false, rate: 7, mode: 'inclusive', taxId: '', legalName: '' },
    // ลิงก์ออร์เดอร์: หมดอายุ = เปิดล่าสุด + idleDays (เลื่อนทุกครั้งที่เปิด) · ไม่เคยเปิด = สร้าง + neverOpenedDays · linkAllowlist = โฮสต์ภายนอกที่ลิงก์ย่อชี้ไปได้ (https)
    linkPolicy: { ...DEFAULT_LINK_POLICY }, linkAllowlist: ['lin.ee', 'line.me', 'facebook.com', 'fb.me', 'maps.app.goo.gl', 'maps.google.com'] },
  // เตือนวันเกิด: key ที่กด "ทักแล้ว" (ลูกค้า|ชื่อ|MM-DD|ปี)
  birthdayGreeted: [],

  // ---------- คะแนนสะสม / แลกของ / กาชา ----------
  // earnPer = ทุกกี่บาทได้ 1 คะแนน, pointValue = 1 คะแนนลดได้กี่บาท, spinCost = คะแนนต่อการหมุน 1 ครั้ง, spinPer = ทุกกี่บาทได้สิทธิ์หมุน 1 ครั้ง
  loyalty: { earnPer: 100, pointValue: 1, pointExpireDays: 365, couponExpireDays: 30, spinCost: 50, spinPer: 500 },
  rewards: [
    { id: 'rw1', name: 'เทียนวันเกิดเซ็ต', points: 30, active: true },
    { id: 'rw2', name: 'คัพเค้ก 1 ชิ้น', points: 80, active: true },
    { id: 'rw3', name: 'เค้ก 1 ปอนด์', points: 500, active: true },
    { id: 'rw4', name: 'คูปองส่วนลด 50 บาท (ตัวอย่าง)', kind: 'coupon', points: 100, amount: 50, minSpend: 200, validDays: 30, active: true },
  ],
  // rewards: kind = item (ของรางวัลรับที่ร้าน) | coupon (คูปองส่วนลด amount ฿ ขั้นต่ำ minSpend อายุ validDays วัน ใช้ที่ POS/ออร์เดอร์)
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
  // ตารางราคาพิเศษ: types = { [typeId] }, typeSizes = { [typeId]: { [sizeId] } }, flavors = { [flavorId] } ช่องว่าง = ใช้ราคาปกติ
  priceLists: [
    { id: 'pl1', name: 'โปรเปิดร้าน', active: true, scheduled: true, from: at(-1, 0).slice(0, 10), to: at(7, 0).slice(0, 10), types: {}, typeSizes: { t1: { s1: 400 } }, flavors: {} },
    { id: 'pl2', name: 'ราคาสมาชิก', active: false, scheduled: false, from: '', to: '', types: {}, typeSizes: {}, flavors: {} },
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

  // ผู้ใช้ระบบ (email ใช้ล็อกอินเมื่อต่อ Supabase)
  users: [
    { id: 'u1', name: 'แอดมิน', email: 'admin@example.com', role: 'admin', active: true },
    { id: 'u2', name: 'พนักงานขาย', email: 'sales@example.com', role: 'sales', active: true },
    { id: 'u3', name: 'คนทำเค้ก', email: 'baker@example.com', role: 'baker', active: true },
    { id: 'u4', name: 'คนส่งของ', email: 'driver@example.com', role: 'driver', active: true },
  ],

  // ประวัติแก้สิทธิ์ผู้ใช้ [{ at, by (userId), userId, added, removed }]
  permLog: [],

  // กลุ่มตัวเลือก: type = single | multi | text, appliesTo = custom/ready, perTier = เลือกแยกแต่ละชั้น (สั่งทำ)
  optionGroups: [
    // ---- กลุ่มหลัก: ประเภท > เนื้อเค้ก > ขนาด ----
    // ราคาเค้กหลัก = ประเภท (คงที่) + เนื้อเค้ก (คงที่) + ราคาขนาดของประเภทนั้น ตั้งที่หน้าการกำหนดราคา
    // allow = เนื้อเค้ก/ขนาดที่ประเภทนี้มี (ไม่มี key = ได้ทุกตัว)
    { id: 'g_type', key: 'type', name: 'ประเภท', prepList: true, perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      typeOpt('t1', 'เค้กครีม', 0, sp(450, 850, 1250, 2000), { recipe: [r('m5', 200), r('m2', 20)] }),
      typeOpt('t2', 'เค้กหน้านิ่ม', 50, sp(450, 850, 1250, 2000), { allow: { g_sponge: ['sp2', 'sp3', 'sp4', 'sp5'] } }),
      typeOpt('t3', 'เค้กแยมมะพร้าวอ่อน', 100, sp(500, 950, 1400, 2200), { allow: { g_size: ['s1', 's2', 's3'] } }),
      typeOpt('t4', 'เค้กฟองดองท์', 200, sp(650, 1250, 1850, 3000)),
    ] },
    { id: 'g_sponge', key: 'flavor', name: 'เนื้อเค้ก', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      flavorOpt('sp1', 'วานิลลา', 0, { recipe: [r('m1', 150), r('m2', 120), r('m3', 3), r('m4', 70)] }),
      flavorOpt('sp2', 'ช็อกโกแลต', 30, { recipe: [r('m1', 140), r('m2', 120), r('m3', 3), r('m4', 70), r('m6', 30)] }), flavorOpt('sp3', 'ใบเตย'),
      flavorOpt('sp4', 'เรดเวลเวท', 50), flavorOpt('sp5', 'ชาไทย', 30),
    ] },
    { id: 'g_size', key: 'size', name: 'ขนาด', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      sizeOpt('s1', '1 ปอนด์', 1), sizeOpt('s2', '2 ปอนด์', 2), sizeOpt('s3', '3 ปอนด์', 3), sizeOpt('s4', '5 ปอนด์', 5),
    ] },
    // ---- ตัวเลือกรอง: ราคาตามขนาด ----
    { id: 'g_shape', name: 'รูปทรง', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      fix('sh1', 'กลม'), fix('sh2', 'สี่เหลี่ยม'), opt('sh3', 'หัวใจ', sp(100, 150, 200, 300)), opt('sh4', 'ตัวเลข/ตัวอักษร', sp(300, 400, 500, 700)),
    ] },
    { id: 'g_filling', name: 'สอดไส้', prepList: true, perTier: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      fix('f1', 'ครีมสด', 0, { recipe: [r('m5', 100)] }),
      opt('f2', 'สตรอว์เบอร์รี', sp(60, 110, 160, 250), { recipe: [r('m7', 80)], typePrices: { t4: sp(80, 140, 200, 320) } }),
      opt('f3', 'บลูเบอร์รี', sp(60, 110, 160, 250)),
      opt('f4', 'คัสตาร์ด', sp(40, 70, 100, 160)),
      opt('f5', 'ช็อกโกแลตกานาช', sp(50, 90, 130, 200)),
    ] },
    { id: 'g_color', name: 'สีธีม', perTier: true, type: 'text', required: false, appliesTo: ['custom'], placeholder: 'เช่น ชมพูพาสเทล + ขาว' },
    { id: 'g_topping', name: 'On top / ท็อปปิ้ง', prepList: true, perTier: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('tp1', 'ผลไม้รวม', sp(150, 250, 350, 500)),
      opt('tp2', 'สตรอว์เบอร์รีสด', sp(180, 300, 420, 600), { recipe: [r('m7', 150, 'piece')] }),
      opt('tp3', 'มาการอง', sp(200, 300, 400, 550), { types: ['t1', 't4'] }),
      opt('tp4', 'ช็อกโกแลตแท่ง/ตกแต่ง', sp(120, 180, 240, 350)),
      opt('tp5', 'เม็ดมุกน้ำตาล', sp(50, 80, 110, 160)),
    ] },
    { id: 'g_deco', name: 'ตกแต่ง', prepList: true, perTier: true, type: 'multi', required: false, appliesTo: ['custom'], options: [
      opt('d1', 'ดอกไม้ครีม', sp(150, 200, 250, 350)), opt('d2', 'ดอกไม้สด', sp(350, 450, 550, 750)), fix('d3', 'ฟิกเกอร์', 500, { typePrice: { t4: 400 } }),
      fix('d4', 'ภาพพิมพ์ทานได้', 250), fix('d5', 'โบว์/ริบบิ้น', 80),
    ] },
    { id: 'g_message', name: 'ข้อความบนเค้ก', type: 'text', required: false, appliesTo: ['custom', 'ready'], placeholder: 'เช่น HBD แม่ 60 ปี' },
    { id: 'g_extra', name: 'ของเสริม', type: 'multi', required: false, appliesTo: ['custom', 'ready'], options: [
      fix('x1', 'เทียนวันเกิด'), fix('x2', 'เทียนตัวเลข', 20), fix('x3', 'ป้ายข้อความ', 60),
      fix('x4', 'การ์ดอวยพร', 30), opt('x5', 'กล่องพิเศษ', sp(80, 100, 120, 160)), fix('x6', 'มีด + จาน'),
    ] },
    { id: 'g_diet', name: 'ข้อจำกัดอาหาร', type: 'multi', required: false, appliesTo: ['custom', 'ready'], options: [
      fix('dt1', 'หวานน้อย'), fix('dt2', 'ไม่ใส่ถั่ว'), fix('dt3', 'ไม่มีแอลกอฮอล์'), fix('dt4', 'ไม่ใส่นม'),
    ] },
    { id: 'g_allergy', name: 'แพ้อาหาร (ระบุ)', type: 'text', required: false, appliesTo: ['custom', 'ready'], placeholder: 'ถ้ามี' },
  ],

  // บันเดิ้ล (ตัวเลือกรอง ในกลุ่มเดียวกันหรือข้ามกลุ่ม): items = [{ groupId, optionId }] ≥ 2, discount = { [sizeId]: บาท }
  // types = ใช้ได้กับประเภทไหน (ว่าง = ทุกประเภท), typeDiscount = { [typeId]: { [sizeId] } } ส่วนลดแยกประเภท (ว่าง = ส่วนลดกลาง)
  bundles: [
    { id: 'b1', name: 'สตรอว์เบอร์รี + บลูเบอร์รี', items: [{ groupId: 'g_filling', optionId: 'f2' }, { groupId: 'g_filling', optionId: 'f3' }], discount: sp(20, 30, 40, 60), types: [], typeDiscount: {}, active: true },
    { id: 'b2', name: 'ไส้สตรอว์เบอร์รี + สตรอว์เบอร์รีสด', items: [{ groupId: 'g_filling', optionId: 'f2' }, { groupId: 'g_topping', optionId: 'tp2' }], discount: sp(30, 50, 70, 100), types: [], typeDiscount: { t4: sp(40, 60, 90, 130) }, active: true },
  ],

  // ---------- การเชื่อมต่อ & แจ้งเตือน (จำลอง: ยังไม่ส่งจริง บันทึกลงคิวข้อความ) ----------
  // token จริงจะเก็บที่เซิร์ฟเวอร์ (Supabase secrets) ตอนต่อจริง ดู docs/integrations.md
  // status: not_connected | connected · accountName/accountId = เพจ/บอทที่เชื่อม · tokenHint = 4 ตัวท้าย (ไม่เก็บ token จริงในหน้าเว็บ)
  integrations: Object.fromEntries(Object.keys(CHANNELS).map((k) => [k, { enabled: true, status: 'not_connected', accountName: '', accountId: '', connectedAt: null, tokenHint: '' }])),
  // ข้อความสำเร็จรูปในแชท (ตัวอย่าง)
  cannedReplies: [
    { id: 'cr1', title: 'เลขบัญชีโอน', text: 'โอนเข้าบัญชี กสิกรไทย 123-4-56789-0 ชื่อบัญชี ร้านเค้กตัวอย่าง แล้วส่งสลิปในแชทได้เลยค่ะ' },
    { id: 'cr2', title: 'เวลาเปิดร้าน', text: 'ร้านเปิดทุกวัน 09:00–20:00 น. ค่ะ' },
    { id: 'cr3', title: 'ราคาเริ่มต้น', text: 'เค้กครีม 1 ปอนด์ เริ่มต้น 450 บาท สั่งล่วงหน้าอย่างน้อย 1 วันค่ะ' },
  ],
  // กฎแจ้งเตือน: event → ช่องทาง + ข้อความ (ตัวอย่าง)
  notifyRules: [
    rule('order_created', ['line', 'facebook', 'sms'], 'สวัสดีค่ะ {ชื่อลูกค้า} รับออร์เดอร์ {เลขออร์เดอร์} แล้ว ยอดรวม {ยอดรวม} นัด{ส่งมอบ} {วันนัด} {เวลานัด}'),
    rule('payment_requested', ['line', 'facebook', 'sms'], 'ออร์เดอร์ {เลขออร์เดอร์} ยอดที่ต้องชำระ {ยอดที่แจ้ง} (คงค้างทั้งหมด {คงค้าง}) ชำระก่อน {ชำระก่อน} ดู/ชำระที่ {ลิงก์ออร์เดอร์}'),
    rule('order_confirmed', ['line', 'facebook', 'sms'], 'ยืนยันการสั่งซื้อออร์เดอร์ {เลขออร์เดอร์} แล้วค่ะ คงค้าง {คงค้าง} ชำระได้ตอนรับสินค้า'),
    rule('payment_reminder', ['line', 'facebook', 'sms'], 'พรุ่งนี้มีนัดออร์เดอร์ {เลขออร์เดอร์} ({วันนัด} {เวลานัด}) ยังไม่ได้ชำระ คงค้าง {คงค้าง} ชำระก่อน {ชำระก่อน} ชำระที่ {ลิงก์ออร์เดอร์}'),
    rule('prepared', ['line', 'facebook', 'sms'], 'ออร์เดอร์ {เลขออร์เดอร์} เตรียมสินค้าเสร็จแล้วค่ะ นัด{ส่งมอบ} {วันนัด} {เวลานัด}'),
    rule('payment_confirmed', ['line', 'facebook', 'sms'], 'ได้รับชำระออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณค่ะ คงค้าง {คงค้าง}'),
    rule('pickup_reminder', ['line', 'facebook', 'sms'], 'เตือนนัด{ส่งมอบ}ออร์เดอร์ {เลขออร์เดอร์} วันที่ {วันนัด} เวลา {เวลานัด}'),
    rule('delivered', ['line', 'facebook'], 'ส่งมอบออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณที่อุดหนุนค่ะ'),
    rule('cancelled', ['line', 'facebook', 'sms'], 'ออร์เดอร์ {เลขออร์เดอร์} ถูกยกเลิกแล้ว หากมีข้อสงสัยติดต่อร้านได้เลยค่ะ'),
    rule('birthday', ['line', 'facebook'], 'สุขสันต์วันเกิดล่วงหน้า {ชื่อวันเกิด} สั่งเค้กกับเราได้เลยค่ะ'),
    rule('points_expiring', ['line', 'facebook'], '{ชื่อลูกค้า} มี {คะแนน} คะแนนใกล้หมดอายุ ใช้ก่อนหมดนะคะ'),
    rule('team_new_order', ['telegram'], '[ออร์เดอร์ใหม่] {เลขออร์เดอร์} {ชื่อลูกค้า} {ยอดรวม} นัด {วันนัด} {เวลานัด}'),
    rule('team_payment_confirmed', ['telegram'], '[ชำระแล้ว] {เลขออร์เดอร์} คงค้าง {คงค้าง}'),
    rule('team_due_soon', ['telegram'], '[ใกล้เวลา] {เลขออร์เดอร์} ต้องเสร็จภายใน 2 ชม. (นัด {เวลานัด})'),
    rule('team_cancelled', ['telegram'], '[ยกเลิก] {เลขออร์เดอร์} {ชื่อลูกค้า}'),
    rule('team_approval_request', ['telegram'], '[ขออนุมัติ] {เลขออร์เดอร์} {ชื่อลูกค้า} ยืนยันสั่งซื้อแบบยังไม่ชำระ คงค้าง {คงค้าง}'),
    rule('team_pay_overdue', ['telegram'], '[เกินกำหนดชำระ] {เลขออร์เดอร์} {ชื่อลูกค้า} ต้องชำระก่อน {ชำระก่อน} คงค้าง {คงค้าง}'),
    rule('team_customer_paid', ['telegram'], '[ลูกค้าแจ้งโอน] {เลขออร์เดอร์} {ชื่อลูกค้า} {ยอดที่แจ้ง} รอตรวจสลิป'),
    rule('team_pay_extend_request', ['telegram'], '[ขอขยายเวลาชำระ] {เลขออร์เดอร์} {ชื่อลูกค้า} เดิมกำหนด {ชำระก่อน}'),
  ],
  // คิวข้อความ (จำลอง) ล่าสุดอยู่หน้า · notifySent = key ที่ส่งแล้ว (กันส่งซ้ำของเหตุการณ์ตามเวลา)
  outbox: [],
  // orderLinks: [{ id, orderId, tokenHash, createdAt, lastOpenedAt, openCount, revokedAt }] เก็บเฉพาะ hash ของ token (token เต็มเห็นได้ครั้งเดียวตอนสร้าง)
  orderLinks: [],
  // บอทตอบแชท (ค่าเริ่มต้นปิด): rules = กฎคีย์เวิร์ด · learned = คู่ ถาม→ตอบ ที่เรียนจากพนักงาน (ตัดข้อมูลส่วนบุคคลแล้ว) · stats
  bot: JSON.parse(JSON.stringify(BOT_DEFAULTS)),
  // shortLinks: [{ id, code, target, kind: internal | external, clicks, createdAt, expiresAt, active, note }]
  shortLinks: [],
  notifySent: [],

  // ---------- ศูนย์รวมแชท LINE OA + Facebook (จำลอง) ----------
  // messages: { from: 'customer' | 'staff', kind: 'text' | 'order', text, orderId, at, by }
  chats: [],
  chatDrafts: {}, // ร่างออร์เดอร์ต่อแชท { [chatId]: form } สลับไปมาข้อมูลไม่หาย
  quotes: [], // ใบเสนอในแชท status: pending | accepted | revise | superseded

  // ---------- POS หน้าร้าน ----------
  // สินค้าหน้าร้าน/สินค้าสำเร็จ (ตัวอย่าง) stock = คงเหลือ (null = ไม่นับสต็อก)
  // ฟิลด์: images, recipe, pinned (ขายดีปักหมุด), showInPos (แสดงใน POS/สร้างออร์เดอร์), showOnStore (แสดงหน้าร้านเว็บ), description, typeId/flavorId/sizeId (ไม่บังคับ)
  retailItems: [
    { id: 'rt1', name: 'เค้กช็อกโกแลต (ชิ้น)', category: 'เค้กชิ้น', price: 75, stock: 12, active: true },
    { id: 'rt2', name: 'เค้กส้ม (ชิ้น)', category: 'เค้กชิ้น', price: 70, stock: 8, active: true },
    { id: 'rt3', name: 'คัพเค้กวานิลลา', category: 'คัพเค้ก', price: 45, stock: 20, active: true },
    { id: 'rt4', name: 'คัพเค้กเรดเวลเวท', category: 'คัพเค้ก', price: 55, stock: 0, active: true },
    { id: 'rt5', name: 'อเมริกาโน่เย็น', category: 'เครื่องดื่ม', price: 60, stock: null, active: true, modifierIds: ['md1', 'md2', 'md3'] },
    { id: 'rt6', name: 'ชาไทยเย็น', category: 'เครื่องดื่ม', price: 55, stock: null, active: true, modifierIds: ['md1', 'md2'] },
    { id: 'rt7', name: 'เทียนวันเกิด (แพ็ก)', category: 'ของเสริม', price: 20, stock: 50, active: true },
    // สินค้าสำเร็จ (ย้ายมาจากสินค้า "เค้กสำเร็จ" เดิม) ราคาคงที่ · typeId/flavorId/sizeId = ข้อมูลประกอบ (ขนาดใช้คิดราคาตัวเลือกตามขนาดของออร์เดอร์) · recipe = สูตรวัตถุดิบ (ตัวเลขตัวอย่าง)
    { id: 'rt8', name: 'เค้กช็อกโกแลตฟัดจ์', category: 'เค้กสำเร็จ', price: 480, stock: 3, active: true, showOnStore: true, typeId: 't1', flavorId: 'sp2', sizeId: 's1', recipe: [r('m1', 150), r('m2', 120), r('m3', 3), r('m4', 80), r('m6', 40), r('m8', 1, 'piece')] },
    { id: 'rt9', name: 'เค้กส้ม', category: 'เค้กสำเร็จ', price: 450, stock: null, active: true, showOnStore: true, typeId: 't1', flavorId: 'sp1', sizeId: 's1', recipe: [r('m1', 160), r('m2', 130), r('m3', 3), r('m4', 70), r('m8', 1, 'piece')] },
    { id: 'rt10', name: 'เค้กใบเตยมะพร้าวอ่อน', category: 'เค้กสำเร็จ', price: 1050, stock: null, active: true, showOnStore: true, typeId: 't3', flavorId: 'sp3', sizeId: 's2', recipe: [r('m1', 150), r('m2', 110), r('m3', 3), r('m5', 150), r('m8', 1, 'piece')] },
    { id: 'rt11', name: 'เรดเวลเวท', category: 'เค้กสำเร็จ', price: 550, stock: null, active: true, showOnStore: true, typeId: 't2', flavorId: 'sp4', sizeId: 's1', recipe: [r('m1', 150), r('m2', 130), r('m3', 3), r('m4', 80), r('m6', 10), r('m8', 1, 'piece')] },
  ],
  // ตัวเลือกสินค้าหน้าร้าน (กลุ่มกลาง ผูกกับสินค้าด้วย retailItems[].modifierIds) price = บาทที่บวกเพิ่ม
  posModifiers: [
    { id: 'md1', name: 'ความหวาน', type: 'single', required: true, active: true, options: [{ id: 'o1', name: 'ปกติ', price: 0 }, { id: 'o2', name: 'หวานน้อย', price: 0 }, { id: 'o3', name: 'ไม่หวาน', price: 0 }] },
    { id: 'md2', name: 'น้ำแข็ง', type: 'single', required: true, active: true, options: [{ id: 'o4', name: 'ปกติ', price: 0 }, { id: 'o5', name: 'แยกน้ำแข็ง', price: 0 }, { id: 'o6', name: 'ไม่ใส่น้ำแข็ง', price: 0 }] },
    { id: 'md3', name: 'เพิ่ม', type: 'multi', required: false, active: true, options: [{ id: 'o7', name: 'เพิ่มช็อต', price: 15 }, { id: 'o8', name: 'วิปครีม', price: 10 }] },
  ],
  // กะขาย: float = เงินทอนตั้งต้น, counted = เงินสดที่นับได้ตอนปิด
  shifts: [],
  // โปรโมชัน POS (ตัวอย่าง ปิดไว้ก่อน) schedule = { from, to, days[0-6], timeFrom, timeTo } ว่าง = ตลอดเวลา · ต่อสินค้า 1 ชิ้นใช้อันที่ลดมากสุด ไม่ซ้อนกัน (ท้ายบิลซ้อนได้)
  posDiscounts: [
    { id: 'pd1', name: 'เครื่องดื่มลด 10% (ตัวอย่าง)', type: 'percent', value: 10, scope: 'category', categories: ['เครื่องดื่ม'], itemIds: [], minSpend: 0, active: false, schedule: blankSchedule() },
  ],
  posBundles: [
    { id: 'pb1', name: 'อเมริกาโน่เย็น + คัพเค้กวานิลลา (ตัวอย่าง)', items: [{ itemId: 'rt5', qty: 1 }, { itemId: 'rt3', qty: 1 }], price: 89, active: false, schedule: blankSchedule() },
  ],
  // โปรคะแนนพิเศษ: multiplier = ตัวคูณคะแนนของยอดสินค้านั้น (หลายโปรซ้อน = ใช้ตัวสูงสุด)
  pointPromos: [
    { id: 'pt1', name: 'คะแนน x2 เค้กสำเร็จ (ตัวอย่าง)', multiplier: 2, scope: 'category', categories: ['เค้กสำเร็จ'], itemIds: [], active: false, schedule: blankSchedule() },
  ],

  // ---------- หน้าร้าน (สาธารณะ) · เนื้อหาตัวอย่าง แก้ได้ที่ /admin/manage/storefront ----------
  storefront: {
    heroTitle: 'เค้กทำสดใหม่ ทุกโอกาสพิเศษ',
    heroText: 'เค้กวันเกิดและเค้กสั่งทำ ออกแบบได้ตามใจ ทำสดใหม่ทุกออร์เดอร์',
    heroImage: '',
    about: 'ร้านเค้กทำสดใหม่ทุกวัน รับทำเค้กวันเกิด เค้กสั่งทำตามแบบ และเค้กสำเร็จรูป',
    address: 'ที่อยู่ร้าน (ตัวอย่าง)',
    mapUrl: '',
    phone: '',
    lineUrl: '',
    facebookUrl: '',
    hours: [{ days: 'ทุกวัน', time: '09:00–20:00' }],
    howToOrder: [
      { title: 'เลือกเค้ก', text: 'ดูเมนูในเว็บ เลือกเค้กสำเร็จหรือแบบที่อยากสั่งทำ' },
      { title: 'ทักแชท', text: 'กดปุ่มสั่งทาง LINE หรือ Facebook แจ้งวันเวลารับ' },
      { title: 'ยืนยัน + ชำระ', text: 'ร้านส่งใบเสนอราคาให้ยืนยัน แล้วชำระตามยอดที่แจ้ง' },
      { title: 'รับเค้ก', text: 'รับที่ร้านหรือจัดส่งตามวันเวลาที่นัด' },
    ],
    faq: [
      { q: 'สั่งล่วงหน้ากี่วัน?', a: 'แนะนำล่วงหน้าอย่างน้อย 2–3 วัน เค้กสั่งทำตามแบบควรแจ้งล่วงหน้ามากกว่านั้น' },
      { q: 'ชำระเงินอย่างไร?', a: 'โอนเงิน เงินสด หรือบัตร ร้านจะแจ้งยอดและงวดชำระทางแชท' },
    ],
    policies: [
      { title: 'การยกเลิก', text: 'แจ้งยกเลิกทางแชท เงื่อนไขการคืนเงินขึ้นกับสถานะการทำเค้ก' },
      { title: 'ความเป็นส่วนตัว', text: 'ร้านเก็บชื่อ เบอร์โทร และข้อมูลออร์เดอร์เพื่อรับและจัดส่งเค้กเท่านั้น ขอลบข้อมูลได้ที่หน้าบัญชีของฉัน' },
    ],
    gallery: [],
  },
  // รีวิว: source = admin (แอดมินกรอก อนุมัติทันที) | customer (ลูกค้าเขียนหลังรับสินค้า รออนุมัติ) status = pending | approved | rejected
  reviews: [],

  // ---------- ข้อความกฎหมาย (ร่าง แก้ได้ที่ /admin/manage/legal) + บันทึกการยินยอม ----------
  // docs[kind] = { version, title, text, updatedAt } · consents = [{ id, customerId|null, kind, version, detail, at, via }] (หลักฐาน เก็บแบบนิรนามเมื่อลบลูกค้า)
  legal: {
    contact: { ...DEFAULT_LEGAL_CONTACT },
    docs: {
      privacy: { version: 1, title: LEGAL_KINDS.privacy.label, text: DEFAULT_PRIVACY, updatedAt: new Date().toISOString() },
      terms: { version: 1, title: LEGAL_KINDS.terms.label, text: DEFAULT_TERMS, updatedAt: new Date().toISOString() },
      cookie: { version: 1, title: LEGAL_KINDS.cookie.label, text: DEFAULT_COOKIE, updatedAt: new Date().toISOString() },
    },
  },
  consents: [],

  // ---------- ระบบลูกค้า (จำลอง) ----------
  // customerAccounts: เบอร์ + PIN (เก็บเป็น hash + salt) · otps: รหัสยืนยัน (จำลองเก็บในหน่วยความจำ) · deletionRequests: คำขอลบข้อมูล
  customerAccounts: [],
  otps: [],
  deletionRequests: [],

  orders: [],
})

// ทุกรายการเริ่มต้นเป็น "ใช้งาน" + สมุดคะแนน / สิทธิ์หมุน
for (const o of db.optionGroups.find((g) => g.key === 'type')?.options || []) o.images = o.images || []
for (const r of db.retailItems) Object.assign(r, { modifierIds: r.modifierIds || [], images: r.images || [], recipe: r.recipe || [], pinned: !!r.pinned, showInPos: r.showInPos ?? true, showOnStore: r.showOnStore ?? false, description: r.description || '', typeId: r.typeId || null, flavorId: r.flavorId || null, sizeId: r.sizeId || null })
for (const u of db.users) u.perms = rolePreset(u.role) // ผู้ใช้ตัวอย่างเริ่มด้วยสิทธิ์ตามบทบาท
for (const c of db.customers) Object.assign(c, { active: true, ledger: [], spins: 0, lineUserId: '', fbPsid: '', promoOptIn: true, places: [] })
// ตัวอย่าง: ลูกค้าคนแรกผูก LINE แล้ว (จำลอง)
db.customers[0].lineUserId = 'U-demo-mali'
for (const g of db.optionGroups) g.active = true

// ---------- ฟังก์ชัน ----------
let orderNo = 0
const nextCode = () => `OR-${String(++orderNo).padStart(4, '0')}`

export const findOrder = (id) => db.orders.find((o) => o.id === id)
export const findCustomer = (id) => db.customers.find((c) => c.id === id)

export function addCustomer(data) {
  const c = { id: uid('c'), name: data.name.trim(), phone: phoneDigits(data.phone), line: data.line?.trim() || '', note: data.note?.trim() || '', active: true, ledger: [], spins: 0, lineUserId: '', fbPsid: '', promoOptIn: true, places: [] }
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
  const { places, ...rest } = d // สถานที่จัดการผ่าน savePlace/removePlace เท่านั้น (กันฟอร์มเก่าเขียนทับ)
  const c = upsert(db.customers, 'c', { ...rest, phone: phoneDigits(d.phone) })
  if (!c.ledger) Object.assign(c, { ledger: [], spins: 0 })
  if (!c.places) c.places = []
  return c
}
// ตารางราคา { [k]: { [sizeId]: ราคา } } ตัดช่องว่าง
const cleanTable = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, cleanSpecial(v)]))
export const savePriceList = (d) => upsert(db.priceLists, 'pl', { ...d, types: cleanSpecial(d.types), typeSizes: cleanTable(d.typeSizes), flavors: cleanSpecial(d.flavors) })
// ตารางราคาเค้กหลัก (หน้าการกำหนดราคา): types = { [typeId] }, typeSizes = { [typeId]: { [sizeId] } }, flavors = { [flavorId] }
export function saveMainPrices({ types = {}, typeSizes = {}, flavors = {} }) {
  const byKey = (k) => db.optionGroups.find((x) => x.key === k)?.options || []
  for (const o of byKey('type')) {
    if (types[o.id] !== undefined) o.price = Number(types[o.id]) || 0
    if (typeSizes[o.id]) o.sizePrices = { ...(o.sizePrices || {}), ...cleanSpecial(typeSizes[o.id]) }
  }
  for (const o of byKey('flavor')) if (flavors[o.id] !== undefined) o.price = Number(flavors[o.id]) || 0
}
export const saveIngredient = (d) => upsert(db.ingredients, 'm', { ...d, packSize: Number(d.packSize) || 0, packPrice: Number(d.packPrice) || 0 })
// ผู้ใช้ + สิทธิ์ที่ติ๊ก · คืน { ok, user } | { error } · ต้องมีอย่างน้อย 1 คนที่ใช้งานอยู่และมี manageUsers
export function saveUser(d) {
  if (!can('manageUsers')) return { error: 'ไม่มีสิทธิ์จัดการผู้ใช้' }
  if (!ROLES_OK.includes(d.role)) return { error: 'บทบาทไม่ถูกต้อง' }
  const cur = d.id ? db.users.find((x) => x.id === d.id) : null
  const perms = [...new Set((Array.isArray(d.perms) ? d.perms : rolePreset(d.role)).filter((k) => ALL_PERMS.includes(k)))]
  const next = { name: String(d.name ?? '').trim(), email: String(d.email ?? '').trim(), role: d.role, active: d.active !== false, perms }
  if (!next.name || !/^\S+@\S+\.\S+$/.test(next.email)) return { error: 'กรอกชื่อและอีเมลให้ถูกต้อง' }
  // กันล็อกตัวเอง: หลังบันทึกต้องเหลือผู้ใช้ที่ใช้งานอยู่ + มี manageUsers
  const after = db.users.map((x) => (cur && x.id === cur.id ? { ...x, ...next } : x)).concat(cur ? [] : [next])
  if (!after.some((x) => x.active !== false && x.perms?.includes('manageUsers'))) return { error: 'ต้องเหลือผู้ใช้ที่ใช้งานอยู่และมีสิทธิ์ "จัดการผู้ใช้และสิทธิ์" อย่างน้อย 1 คน' }
  const before = cur?.perms || []
  const added = perms.filter((k) => !before.includes(k))
  const removed = before.filter((k) => !perms.includes(k))
  const u = cur ? Object.assign(cur, next) : (db.users.push({ id: uid('u'), ...next }), db.users[db.users.length - 1])
  if (!cur || added.length || removed.length || cur.role !== d.role) db.permLog.unshift({ id: uid('pl'), at: now(), by: session.userId, userId: u.id, added, removed, isNew: !cur })
  if (db.permLog.length > 200) db.permLog.length = 200
  // ถ้าแก้สิทธิ์ของผู้ใช้ที่กำลังใช้งานอยู่ ให้บทบาทใน session ตาม
  if (u.id === session.userId) session.role = u.role
  return { ok: true, user: u }
}
const ROLES_OK = ['admin', 'sales', 'baker', 'driver']
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
  // ประเภท/เนื้อเค้ก: ราคาตั้งในหน้าการกำหนดราคา (ไม่แตะราคาที่นี่) · ขนาด: ปอนด์ · ตัวเลือกรอง: ราคาตามขนาด
  for (const k of ['price', 'priceType', 'special', 'sizePrices', 'pounds', 'types', 'typePrices', 'typePrice']) delete data[k]
  if (g.key === 'size') data.pounds = Number(d.pounds) || 1
  else if (g.key === 'type') {
    if (!d.id) Object.assign(data, { price: 0, sizePrices: {} })
  } else if (g.key === 'flavor') {
    if (!d.id) data.price = 0
  } else {
    const fixed = d.priceType === 'fixed'
    Object.assign(data, {
      priceType: fixed ? 'fixed' : 'size',
      price: fixed ? Number(d.price) || 0 : 0,
      sizePrices: fixed ? {} : cleanSpecial(d.sizePrices),
      typePrice: fixed ? cleanSpecial(d.typePrice) : {},
      typePrices: fixed ? {} : cleanTable(d.typePrices),
      types: [...(d.types || [])],
    })
  }
  return upsert(g.options, 'o', data)
}

// บันเดิ้ล (ตัวเลือกรอง ในกลุ่มเดียวกันหรือข้ามกลุ่ม ลดราคาตามขนาด)
export const saveBundle = (d) =>
  upsert(db.bundles, 'b', { ...d, items: d.items.map((x) => ({ groupId: x.groupId, optionId: x.optionId })), discount: cleanSpecial(d.discount), types: [...(d.types || [])], typeDiscount: cleanTable(d.typeDiscount) })

// จัดลำดับ: สลับกับตัวข้างเคียง (dir = -1 ขึ้น / 1 ลง)
export function moveItem(list, index, dir) {
  const j = index + dir
  if (j < 0 || j >= list.length) return
  const [x] = list.splice(index, 1)
  list.splice(j, 0, x)
}

// จำนวนออร์เดอร์ของลูกค้า
export const customerOrderCount = (id) => db.orders.filter((o) => o.customerId === id).length

// คิดราคาตามราคาพิเศษที่ใช้งาน ณ วันที่สร้างออร์เดอร์ (ค่าเริ่มต้น = วันนี้)
export const activeListsAt = (dateStr) => activeLists(db.priceLists, dateStr || toDateStr(new Date()))
export const orderDate = (order) => toDateStr(new Date(order.createdAt))

export function priceItem(item, dateStr) {
  return { ...item, ...priceDetail(item, db.optionGroups, db.retailItems, activeListsAt(dateStr), db.bundles) }
}

function log(order, text) {
  order.history.push({ at: now(), text, by: session.role })
}

// ฟิลด์จัดส่งของออร์เดอร์ (รับหน้าร้าน = ว่างหมด) · url ที่ไม่ผ่านตรวจถูกตัดทิ้ง
function deliveryFields(p) {
  if (p.fulfillment !== 'delivery') return { address: '', shippingFee: 0, placeName: '', mapUrl: '', detail: '', distanceKm: null, feeManual: false }
  const bad = (f) => cleanDelivery({ [f]: p[f] }).error
  const v = cleanDelivery({
    ...p, mapUrl: bad('mapUrl') ? '' : p.mapUrl, distanceKm: bad('distanceKm') ? '' : p.distanceKm, shippingFee: bad('shippingFee') ? 0 : p.shippingFee,
  }).value
  return { address: v.address, shippingFee: v.shippingFee, placeName: v.placeName, mapUrl: v.mapUrl, detail: v.detail, distanceKm: v.distanceKm, feeManual: v.feeManual }
}

// จำสถานที่จัดส่งไว้กับลูกค้า (อัตโนมัติ)
function rememberPlaceOf(customerId, d) {
  const c = findCustomer(customerId)
  if (!c || c.deleted || !d?.address) return
  c.places = rememberPlace(c.places, d, now(), () => uid('pl'))
}

export function createOrder(payload, asDraft = false) {
  const closed = pickupClosed(db.shop, payload.pickupAt)
  if (closed) return { error: closedMsg(closed) }
  const o = {
    id: uid('o'),
    code: nextCode(),
    customerId: payload.customerId,
    pickupAt: payload.pickupAt,
    fulfillment: payload.fulfillment,
    chatId: payload.chatId || null, // สร้างจากแชท
    birthday: payload.birthday?.md ? { name: payload.birthday.name || '', md: payload.birthday.md } : null, // { name, md: 'MM-DD' }
    ...deliveryFields(payload),
    items: payload.quoteItems ? payload.items : payload.items.map((i) => priceItem(i)), // จากใบเสนอ = ราคาตามใบเสนอ
    vat: payload.vat !== undefined ? payload.vat : vatNow(), // จากใบเสนอ = VAT ตามใบเสนอ
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
  if (o.fulfillment === 'delivery') rememberPlaceOf(o.customerId, o)
  if (!asDraft) notifyOrder('order_created', o)
  return o
}

export function setStatus(order, status, text) {
  // ส่งมอบไม่ได้ถ้ายังชำระไม่ครบ
  if (status === 'delivered' && orderTotals(order).balance > 0) return
  const prev = order.status
  order.status = status
  log(order, text)
  if (status === 'delivered') awardOrder(order)
  if (status === 'delivered') notifyOrder('delivered', order)
  if (status === 'prepared') notifyOrder('prepared', order)
  if (status === 'cancelled') notifyOrder('cancelled', order)
  // ร่าง → ส่งไปรอชำระ = เริ่มเป็นออร์เดอร์จริง
  if (prev === 'draft' && status === 'awaiting_payment') notifyOrder('order_created', order)
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
    dueAt: p.dueAt || quickDue(db.shop.payDueMin || 30), // ทุกงวดต้องมีกำหนดชำระ
    extension: null,
    createdAt: now(),
    status: 'reported',
    reportedBy: session.role,
    confirmedBy: null,
  })
  const due = order.payments[order.payments.length - 1].dueAt
  log(order, `แจ้งยอดชำระ ${money(Number(p.amount))} (${p.method}) ชำระก่อน ${dueText(due)}`)
  notifyOrder('payment_requested', order, { requested: Number(p.amount), dueAt: due })
  if (order.status === 'awaiting_payment') order.status = 'payment_reported'
}

const dueText = (iso) => (iso ? `${dateOnly(iso)} ${timeOnly(iso)} น.` : '')

const payFields = (p) => ({ method: p.method, paidAt: p.paidAt, slip: p.slip || '', note: p.note || '' })

export function updatePaymentRequest(order, paymentId, p) {
  const pay = order.payments.find((x) => x.id === paymentId)
  if (!pay || pay.status !== 'reported') return
  Object.assign(pay, { requested: Number(p.amount), amount: Number(p.amount), ...payFields(p) })
  if (p.dueAt) pay.dueAt = p.dueAt
  log(order, `แก้ยอดที่แจ้งเป็น ${money(Number(p.amount))}`)
}

export function cancelPaymentRequest(order, paymentId) {
  const pay = order.payments.find((x) => x.id === paymentId)
  if (!pay || pay.status !== 'reported') return
  pay.status = 'cancelled'
  log(order, `ยกเลิกยอดที่แจ้ง ${money(pay.requested)}`)
  if (order.status === 'payment_reported' && !order.payments.some((x) => x.status === 'reported')) order.status = 'awaiting_payment'
}

// ยกเลิกยอดที่ยืนยันแล้ว (แอดมิน) · ไม่เหลือยอดที่ยืนยัน → ถอยสถานะเป็น แจ้งยอดแล้ว (ถ้ามีงวดที่แจ้งค้าง) หรือ รอชำระ
export function cancelConfirmedPayment(order, paymentId) {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!p || p.status !== 'confirmed' || ['delivered', 'cancelled'].includes(order.status)) return
  Object.assign(p, { status: 'cancelled', cancelledAt: now(), cancelledBy: session.role })
  log(order, `ยกเลิกยอดที่ยืนยันแล้ว ${money(p.amount)}`)
  if (!order.payments.some((x) => x.status === 'confirmed') && ['payment_confirmed', 'preparing', 'prepared'].includes(order.status)) {
    order.status = order.payments.some((x) => x.status === 'reported') ? 'payment_reported' : 'awaiting_payment'
  }
}

// data = ยอดที่ได้รับจริง + รายละเอียด (ไม่ส่ง = ใช้ตามที่แจ้ง)
export function confirmPayment(order, paymentId, data = null) {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!p || p.status !== 'reported') return
  if (data) Object.assign(p, { amount: Number(data.amount), ...payFields(data) })
  p.status = 'confirmed'
  p.confirmedBy = session.role
  log(order, `ยืนยันชำระ ${money(p.amount)}${p.amount !== p.requested ? ` (แจ้ง ${money(p.requested)})` : ''}`)
  if (['awaiting_payment', 'payment_reported'].includes(order.status)) order.status = 'payment_confirmed'
  notifyOrder('payment_confirmed', order)
}

// ---------- ยืนยันการสั่งซื้อแบบยังไม่ชำระ (ต้องอนุมัติ) ----------
// พนักงานขายขออนุมัติ → แอดมินอนุมัติ/ปฏิเสธ · แอดมินกดยืนยันตรงได้ · ใช้ได้เฉพาะ รอชำระ/แจ้งยอดแล้ว
const canConfirmUnpaid = (o) => ['awaiting_payment', 'payment_reported'].includes(o.status)
export function requestConfirmUnpaid(order, note = '') {
  if (!can('requestConfirmUnpaid') || !canConfirmUnpaid(order) || order.approval?.status === 'pending') return false
  order.approval = { status: 'pending', by: session.role, at: now(), note: String(note).trim().slice(0, 200) }
  log(order, `ขออนุมัติยืนยันการสั่งซื้อ (ยังไม่ชำระ)${order.approval.note ? ` · ${order.approval.note}` : ''}`)
  notify('team_approval_request', { vars: orderVars(order), orderId: order.id })
  return true
}
export function confirmUnpaid(order) {
  if (!can('confirmUnpaid') || !canConfirmUnpaid(order)) return false
  const pending = order.approval?.status === 'pending'
  order.approval = { ...(order.approval || {}), status: 'approved', decidedBy: session.role, decidedAt: now() }
  setStatus(order, 'order_confirmed', pending ? 'อนุมัติ · ยืนยันการสั่งซื้อ (ยังไม่ชำระ)' : 'ยืนยันการสั่งซื้อ (ยังไม่ชำระ)')
  notifyOrder('order_confirmed', order)
  return true
}
export function rejectConfirmUnpaid(order, note = '') {
  if (!can('confirmUnpaid') || order.approval?.status !== 'pending') return false
  order.approval = { ...order.approval, status: 'rejected', decidedBy: session.role, decidedAt: now(), decisionNote: String(note).trim().slice(0, 200) }
  log(order, `ไม่อนุมัติยืนยันการสั่งซื้อ${order.approval.decisionNote ? ` · ${order.approval.decisionNote}` : ''}`)
  return true
}

// ---------- ขยายเวลาชำระ ----------
// ลูกค้าขอ (หน้าออร์เดอร์ลูกค้า) → พนักงานขยาย/ปฏิเสธ · ขอได้เมื่อเลยกำหนดและยังไม่มีคำขอรออยู่
export function requestPayExtension(order, paymentId, note = '') {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!p || p.status !== 'reported' || dueState(p) !== 'overdue' || p.extension?.status === 'pending') return false
  p.extension = { status: 'pending', at: now(), note: String(note).trim().slice(0, 200) }
  log(order, 'ลูกค้าขอขยายเวลาชำระ')
  notify('team_pay_extend_request', { vars: { ...orderVars(order), ชำระก่อน: dueText(p.dueAt) }, orderId: order.id })
  return true
}
export function grantPayExtension(order, paymentId, dueAt) {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!can('reportPayment') || !p || p.status !== 'reported' || !dueAt || Number.isNaN(new Date(dueAt).getTime())) return false
  const old = p.dueAt
  p.dueAt = dueAt
  p.extension = { ...(p.extension || {}), status: 'granted', decidedBy: session.role, decidedAt: now() }
  log(order, `ขยายเวลาชำระเป็น ${dueText(dueAt)}${old ? ` (เดิม ${dueText(old)})` : ''}`)
  return true
}
export function denyPayExtension(order, paymentId) {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!can('reportPayment') || !p || p.extension?.status !== 'pending') return false
  p.extension = { ...p.extension, status: 'denied', decidedBy: session.role, decidedAt: now() }
  log(order, 'ไม่อนุมัติขยายเวลาชำระ')
  return true
}

// ---------- ข้อมูลจัดส่งของออร์เดอร์ (แก้ได้ก่อนส่งมอบ/ยกเลิก) ----------
export function setDelivery(order, d) {
  if (!can('editPickup') || order.fulfillment !== 'delivery' || ['delivered', 'cancelled'].includes(order.status)) return { error: 'แก้ข้อมูลจัดส่งไม่ได้' }
  if (!String(d.address ?? '').trim()) return { error: 'กรอกที่อยู่จัดส่ง' }
  const r = cleanDelivery(d)
  if (r.error) return r
  const v = r.value
  const oldFee = Number(order.shippingFee) || 0
  Object.assign(order, { address: v.address, placeName: v.placeName, mapUrl: v.mapUrl, detail: v.detail, distanceKm: v.distanceKm, shippingFee: v.shippingFee, feeManual: v.feeManual })
  log(order, `แก้ข้อมูลจัดส่ง${v.placeName ? ` · ${v.placeName}` : ''}${v.distanceKm != null ? ` · ${v.distanceKm} กม.` : ''}${oldFee !== v.shippingFee ? ` · ค่าส่ง ${money(oldFee)} → ${money(v.shippingFee)}` : ''}`)
  rememberPlaceOf(order.customerId, order)
  return { ok: true }
}
// ค่าส่งที่แนะนำจากระยะทาง (null = ปิดใช้/ไม่มีเรต)
export const suggestShipping = (km) => deliveryFee(km, db.shop.delivery)

// ---------- สถานที่จัดส่งที่ลูกค้าเคยใช้ (พนักงานจัดการ) ----------
export function savePlace(customerId, place) {
  const c = findCustomer(customerId)
  if (!c || !can('createOrder')) return { error: 'ไม่พบลูกค้า' }
  const r = cleanDelivery({ ...place, shippingFee: 0 })
  if (r.error) return r
  if (!r.value.address) return { error: 'กรอกที่อยู่' }
  const list = c.places || (c.places = [])
  const cur = place.id ? list.find((x) => x.id === place.id) : null
  const v = r.value
  if (cur) Object.assign(cur, { name: v.placeName, address: v.address, mapUrl: v.mapUrl, detail: v.detail, distanceKm: v.distanceKm })
  else list.unshift({ id: uid('pl'), name: v.placeName, address: v.address, mapUrl: v.mapUrl, detail: v.detail, distanceKm: v.distanceKm, uses: 0, lastUsedAt: now() })
  if (list.length > 10) list.length = 10
  return { ok: true }
}
export function removePlace(customerId, placeId) {
  const c = findCustomer(customerId)
  if (!c || !can('createOrder') || !c.places) return false
  c.places = c.places.filter((x) => x.id !== placeId)
  return true
}
export function placeFirst(customerId, placeId) {
  const c = findCustomer(customerId)
  const i = c?.places?.findIndex((x) => x.id === placeId) ?? -1
  if (!c || i < 0 || !can('createOrder')) return false
  c.places.unshift(c.places.splice(i, 1)[0])
  return true
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
  log(order, `ปรับราคา ${money(Number(amount))} (${reason})`)
}

// ยกเลิกออร์เดอร์ + คืนเงิน: c = { reason, refunds: [{ method: cash | transfer | points, amount }], refundNote }
// (รูปแบบเก่า { refundAmount, refundMethod } ยังใช้ได้) · คืนเป็นคะแนน = ยอด ÷ มูลค่าต่อคะแนน (ต้องหารลงตัว) อายุตามค่าตั้งต้น
// ตรวจก่อนแก้ข้อมูลทุกอย่าง → คืน { ok } หรือ { error }
export function cancelOrder(order, c) {
  if (!order || order.status === 'cancelled') return { error: 'ออร์เดอร์นี้ยกเลิกแล้ว' }
  const paid = orderTotals(order).paid
  const refunds = normalizeRefunds(c, paid)
  const cu = findCustomer(order.customerId)
  const err = refundErrors(refunds, { paid, canPoints: !!cu && !cu.deleted, pointValue: db.loyalty.pointValue })
  if (err) return { error: err }
  undoLoyalty(order)
  for (const x of refunds) {
    if (x.method !== 'points') continue
    x.points = Math.round(x.amount / db.loyalty.pointValue)
    earnPoints(cu, x.points, `คืนเงินจากการยกเลิก ${order.code}`, order.id)
  }
  const refundAmount = round2(refunds.reduce((n, x) => n + x.amount, 0))
  const summary = refunds.map((x) => `${REFUND_METHODS[x.method]} ${money(x.amount)}${x.method === 'points' ? ` (${x.points} คะแนน)` : ''}`).join(' + ')
  order.cancel = { reason: c.reason, refunds, refundAmount, refundMethod: refunds.map((x) => REFUND_METHODS[x.method]).join(' + '), refundNote: c.refundNote || '', at: now() }
  setStatus(order, 'cancelled', `ยกเลิก: ${c.reason}${refundAmount ? ` / คืนเงิน ${summary}` : ''}`)
  return { ok: true }
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
  db.shop.name = (d.name || '').trim() || db.shop.name
  db.shop.slotMinutes = Math.max(5, Number(d.slotMinutes) || 30)
  db.shop.open = d.open || '09:00'
  db.shop.close = d.close || '20:00'
  db.shop.nearbyHours = Math.max(0, Number(d.nearbyHours) || 0)
  db.shop.leadPickup = Math.max(0, Number(d.leadPickup) || 0)
  db.shop.leadDelivery = Math.max(0, Number(d.leadDelivery) || 0)
  db.shop.depositPercent = Math.min(100, Math.max(0, Number(d.depositPercent) || 0))
  db.shop.birthdayDays = Math.max(0, Number(d.birthdayDays) || 0)
  if (d.payDueMin !== undefined) {
    const m = Math.round(Number(d.payDueMin))
    db.shop.payDueMin = m >= 1 ? Math.min(10080, m) : 30
  }
  if (d.payDueRule) {
    const r = d.payDueRule
    const h = Math.round(Number(r.hoursBefore)), dd = Math.round(Number(r.daysBefore))
    db.shop.payDueRule = {
      hoursBefore: h >= 1 && h <= 720 ? h : db.shop.payDueRule.hoursBefore,
      daysBefore: dd >= 0 && dd <= 30 ? dd : db.shop.payDueRule.daysBefore,
      atTime: isHHmm(r.atTime) ? r.atTime : db.shop.payDueRule.atTime,
    }
  }
  if (d.closures) {
    const r = cleanClosures(d.closures)
    if (r.error) return { error: r.error }
    db.shop.closures = r.value
  }
  if (d.delivery) db.shop.delivery = cleanDeliveryConfig(d.delivery)
  if (d.payment) {
    const t = (v, n) => String(v ?? '').trim().slice(0, n)
    const pid = digitsOf(d.payment.promptpayId)
    db.shop.payment = {
      promptpayId: promptPayKind(pid) ? pid : '', accountName: t(d.payment.accountName, 80), bank: t(d.payment.bank, 60),
      accountNo: digitsOf(d.payment.accountNo).slice(0, 20), note: t(d.payment.note, 200),
    }
  }
  if (d.payReminderTime !== undefined) db.shop.payReminderTime = isHHmm(d.payReminderTime) ? d.payReminderTime : db.shop.payReminderTime
  if (d.vat) {
    const rate = Math.round((Number(d.vat.rate) || 0) * 100) / 100
    db.shop.vat = {
      enabled: !!d.vat.enabled, rate: rate > 0 && rate <= 100 ? rate : db.shop.vat.rate, mode: d.vat.mode === 'exclusive' ? 'exclusive' : 'inclusive',
      taxId: String(d.vat.taxId ?? '').replace(/\D/g, '').slice(0, 13), legalName: String(d.vat.legalName ?? '').trim().slice(0, 120),
    }
  }
  return { ok: true }
}
// snapshot VAT ตอนสร้างออร์เดอร์ (ปิดอยู่ = null → ไม่คิด VAT) แก้ค่าตั้งภายหลังไม่กระทบออร์เดอร์เดิม
export const vatNow = () => (db.shop.vat?.enabled && Number(db.shop.vat.rate) > 0 ? { rate: Number(db.shop.vat.rate), mode: db.shop.vat.mode === 'exclusive' ? 'exclusive' : 'inclusive' } : null)

// แก้วันเวลานัด (หน้ารายละเอียด)
export function setPickup(order, pickupAt) {
  if (order.pickupAt === pickupAt) return { ok: true }
  const closed = pickupClosed(db.shop, pickupAt)
  if (closed) return { error: closedMsg(closed) }
  const fmt = (s) => s.replace('T', ' ')
  log(order, `เปลี่ยนวันนัด ${fmt(order.pickupAt)} → ${fmt(pickupAt)}`)
  order.pickupAt = pickupAt
  return { ok: true }
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
// pickupSlotsInfo = ทุกช่องที่ยังไม่ผ่านเวลา พร้อมสถานะปิดร้าน [{ t, closed, reason }] · pickupSlots = เฉพาะช่องที่เลือกได้
export function pickupSlotsInfo(dateStr) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const out = []
  const now = new Date()
  for (let m = toMin(db.shop.open); m <= toMin(db.shop.close); m += db.shop.slotMinutes) {
    const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
    if (new Date(`${dateStr}T${t}`) > now) {
      const c = slotClosed(db.shop, dateStr, t)
      out.push({ t, closed: !!c, reason: c?.reason || '' })
    }
  }
  return out
}
export const pickupSlots = (dateStr) => pickupSlotsInfo(dateStr).filter((s) => !s.closed).map((s) => s.t)
export const pickupClosure = (pickupAt) => pickupClosed(db.shop, pickupAt)
const closedMsg = (c) => `ร้านปิด (${c.reason}) เลือกวัน-เวลานัดอื่น`

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

// แอดมินปรับคะแนนลูกค้า (+เพิ่ม / −ลด) · ต้องมีเหตุผล · ลดได้ไม่เกินคะแนนที่ใช้ได้ (ตัดล็อตเก่าก่อน) · บันทึกผู้ทำใน ledger
export function adjustPoints(customerId, delta, reason) {
  if (!can('adjustPoints')) return { error: 'เฉพาะแอดมิน' }
  const c = findCustomer(customerId)
  if (!c || c.deleted) return { error: 'ไม่พบลูกค้า' }
  const n = Number(delta)
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 1000000) return { error: 'ใส่จำนวนคะแนนเป็นจำนวนเต็ม (ไม่เกิน 1,000,000)' }
  const why = String(reason ?? '').trim().slice(0, 120)
  if (!why) return { error: 'ใส่เหตุผลในการปรับคะแนน' }
  if (!c.ledger) c.ledger = []
  const label = `${n > 0 ? 'เพิ่ม' : 'ลด'}คะแนนโดยแอดมิน: ${why}`
  if (n > 0) {
    const lot = earnPoints(c, n, label)
    Object.assign(lot, { adjust: true, by: session.role })
  } else {
    const have = customerPoints(c)
    if (-n > have) return { error: `ลดได้ไม่เกิน ${have} คะแนน (คงเหลือของลูกค้า)` }
    const e = spendPoints(c, -n, label)
    if (!e) return { error: 'ตัดคะแนนไม่ได้' }
    Object.assign(e, { adjust: true, by: session.role })
  }
  return { ok: true, balance: customerPoints(c) }
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
  log(order, `ใช้ ${points} คะแนน ลด ${money(order.pointsUsed.amount)}`)
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
  if (Number(cp.minSpend) > 0 && orderTotals(order).subtotal < Number(cp.minSpend)) return false // ยอดสินค้าไม่ถึงขั้นต่ำของคูปอง
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

// คะแนน + สิทธิ์หมุนที่ออร์เดอร์นี้จะได้ จาก "ยอดสินค้าสุทธิ" (หลังส่วนลดทุกประเภท ไม่รวมค่าส่ง/VAT)
// โปรคะแนนพิเศษคูณรายสินค้า (ช่วงเวลานับตาม at = เวลาสร้างออร์เดอร์) · ใช้ทั้งตอนให้จริงและแสดงตัวอย่างใน POS
export function pointsFor(order, at = new Date(order.createdAt || Date.now())) {
  const nets = itemNets(order)
  let base = 0
  let weighted = 0
  order.items.forEach((it, i) => {
    const cat = it.kind === 'retail' ? db.retailItems.find((r) => r.id === it.retailId)?.category || '' : 'เค้กสั่งทำ'
    base += nets[i]
    weighted += nets[i] * pointMultiplier({ retailId: it.retailId, category: cat }, db.pointPromos, at)
  })
  const points = Math.floor(weighted / db.loyalty.earnPer + 1e-9)
  return { points, bonus: points - Math.floor(base / db.loyalty.earnPer + 1e-9), spins: Math.floor(base / db.loyalty.spinPer + 1e-9), base: round2(base) }
}
// ส่งมอบ: ได้คะแนน + สิทธิ์หมุน (ดู pointsFor)
function awardOrder(order) {
  const c = findCustomer(order.customerId)
  if (!c || order.loyalty) return
  const { points, bonus, spins, base } = pointsFor(order)
  const lot = earnPoints(c, points, `ออร์เดอร์ ${order.code}${bonus > 0 ? ' (รวมโบนัสโปรคะแนน)' : ''}`, order.id)
  c.spins += spins
  order.loyalty = { points, bonus, spins, base, lotId: lot?.id || null }
  if (points || spins) log(order, `ได้ ${points} คะแนน${bonus > 0 ? ` (โบนัสโปร +${bonus})` : ''}${spins ? ` + สิทธิ์หมุน ${spins} ครั้ง` : ''}`)
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

// ---------- ลิงก์ออร์เดอร์ (ดูอย่างเดียว ไม่ต้องล็อกอิน) ----------
// token สุ่ม 192 บิต เก็บเฉพาะ hash · หมดอายุตาม shop.linkPolicy · เพิกถอน/หมดอายุ = ลบแถว · ข้อความผิดพลาดเดียวกันทุกกรณี
// จำลอง: ข้อมูลอยู่ในหน่วยความจำของเบราว์เซอร์นี้ ลิงก์เปิดข้ามเครื่องไม่ได้จนกว่าจะต่อ Supabase
const linkFails = []

// ---------- มุมมองออร์เดอร์ของลูกค้า (หน้าลิงก์ + หน้าบัญชีที่ล็อกอิน ใช้ข้อมูลชุดเดียวกัน) ----------
// owner=false (ลิงก์): ปิดบางส่วนเบอร์ ไม่ส่งที่อยู่/url/รายละเอียด · owner=true (ล็อกอินเป็นเจ้าของ): เห็นเต็มของตัวเอง · ไม่มีต้นทุน/กำไร/โน้ตภายใน/ประวัติภายใน
export const CUSTOMER_PAY = { perHour: 5, slipMaxChars: 7000000, noteMax: 200 }
const pendingCustomerSum = (o) => round2(o.payments.filter((p) => p.status === 'reported' && p.customerSubmitted).reduce((x, p) => x + (Number(p.amount) || 0), 0))
const recentCustomerSubmits = (o) => o.payments.filter((p) => p.customerSubmitted && Date.now() - new Date(p.submittedAt || 0).getTime() < 3600e3).length
// เหตุผลที่ลูกค้าชำระไม่ได้ ('' = ชำระได้)
export function customerPayBlock(o) {
  if (o.status === 'cancelled') return 'ออร์เดอร์นี้ถูกยกเลิกแล้ว'
  if (o.status === 'draft') return 'ออร์เดอร์ยังไม่เปิดรับชำระ'
  const t = orderTotals(o)
  if (t.balance <= 0) return 'ชำระครบแล้ว'
  if (overduePayments(o).length) return 'เกินกำหนดชำระ กรุณากดขอขยายเวลาก่อน'
  if (t.balance - pendingCustomerSum(o) <= 0) return 'ร้านกำลังตรวจสอบสลิปที่ส่งแล้ว'
  if (recentCustomerSubmits(o) >= CUSTOMER_PAY.perHour) return 'ส่งสลิปบ่อยเกินไป กรุณารอสักครู่'
  return ''
}
export function publicOrderView(o, { owner = false } = {}) {
  const t = orderTotals(o)
  const cu = findCustomer(o.customerId)
  const alive = cu && !cu.deleted
  const rv = reviewOfOrder(o.id)
  const dv = o.fulfillment === 'delivery'
  const pays = o.payments.filter((p) => p.status !== 'cancelled').map((p) => ({
    id: p.id, status: p.status, method: p.method, paidAt: p.paidAt,
    amount: p.status === 'confirmed' ? p.amount : (p.requested ?? p.amount),
    dueAt: p.status === 'reported' ? p.dueAt || '' : '', due: dueState(p), remaining: remainingText(p),
    extension: p.status === 'reported' ? p.extension?.status || null : null,
    submitted: !!p.customerSubmitted, shopRequested: p.source !== 'customer',
  }))
  const room = Math.max(0, round2(t.balance - pendingCustomerSum(o)))
  return {
    id: o.id, code: o.code, channel: o.channel || 'web', status: o.status, createdAt: o.createdAt, pickupAt: o.pickupAt, fulfillment: o.fulfillment,
    customer: alive ? (owner ? { name: cu.name, phone: cu.phone } : { name: String(cu.name || '').trim().split(/\s+/)[0], phone: maskPhone(cu.phone) }) : null,
    delivery: dv ? { placeName: o.placeName || '', distanceKm: o.distanceKm ?? null, shippingFee: Number(o.shippingFee) || 0, ...(owner ? { address: o.address || '', mapUrl: o.mapUrl || '', detail: o.detail || '' } : {}) } : null,
    birthday: owner && o.birthday ? { ...o.birthday } : null,
    items: o.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, unitPrice: i.unitPrice, lines: describeSelections(i, db.optionGroups), note: owner ? i.note || '' : '' })),
    total: t.total, paid: t.paid, balance: Math.max(t.balance, 0), discountTotal: t.discountTotal, vat: t.vat, vatRate: t.vatRate, vatMode: t.vatMode,
    refunds: o.status === 'cancelled' ? refundList(o.cancel) : [],
    payments: pays, payDue: orderDue(o), unpaidApproved: o.status === 'order_confirmed',
    pay: { block: customerPayBlock(o), room, info: { ...db.shop.payment }, limitPerHour: CUSTOMER_PAY.perHour },
    review: owner && rv ? { rating: rv.rating, status: rv.status } : null,
  }
}

// ออร์เดอร์ตามสิทธิ์ลูกค้า: { token } (ลิงก์ที่ยังไม่หมดอายุ) หรือ { orderId } (ล็อกอินเป็นเจ้าของ) · ไม่เจอ/ไม่มีสิทธิ์ = null (ไม่บอกเหตุผล)
function ctxOrder(ctx) {
  if (ctx?.token != null) {
    const at = Date.now()
    while (linkFails.length && at - linkFails[0] >= 5 * 60e3) linkFails.shift()
    if (failBlocked(linkFails, at)) return null
    const token = String(ctx.token)
    const link = isTokenShape(token) ? db.orderLinks.find((l) => l.tokenHash === hashToken(token)) : null
    if (!link || link.revokedAt || !linkAlive(link, db.shop.linkPolicy, at)) { linkFails.push(at); return null }
    return findOrder(link.orderId) || null
  }
  if (ctx?.orderId) {
    const c = myCustomer()
    const o = c ? findOrder(ctx.orderId) : null
    return o && o.customerId === c.id && o.status !== 'draft' ? o : null
  }
  return null
}
const SLIP_OK = /^(data:image\/(png|jpe?g|webp|gif);base64,|blob:)/
// ลูกค้าแจ้งชำระเอง (ไม่ต้องรอร้านแจ้งยอด) · แนบสลิป · แอดมินยืนยันเหมือนเดิม
export function customerPay(ctx, { amount, slip, note = '', paymentId = null }) {
  const o = ctxOrder(ctx)
  if (!o) return { error: LINK_ERROR }
  const block = customerPayBlock(o)
  if (block) return { error: block }
  const t = orderTotals(o)
  const room = round2(t.balance - pendingCustomerSum(o))
  const amt = round2(Number(amount))
  if (!(amt > 0)) return { error: 'กรอกยอดที่โอน' }
  if (amt > room + 1e-9) return { error: `ยอดเกินคงค้าง (ชำระได้ไม่เกิน ${money(room)})` }
  if (typeof slip !== 'string' || !SLIP_OK.test(slip)) return { error: 'แนบสลิปเป็นรูปภาพ (PNG / JPG / WEBP)' }
  if (slip.length > CUSTOMER_PAY.slipMaxChars) return { error: 'ไฟล์สลิปใหญ่เกินไป (ไม่เกิน 5 MB)' }
  const nt = String(note).trim().slice(0, CUSTOMER_PAY.noteMax)
  let p = null
  if (paymentId) {
    p = o.payments.find((x) => x.id === paymentId)
    if (!p || p.status !== 'reported' || p.source === 'customer') return { error: 'ไม่พบยอดที่ร้านแจ้ง' }
    if (p.customerSubmitted) return { error: 'ส่งสลิปของยอดนี้แล้ว รอร้านตรวจสอบ' }
    if (dueState(p) === 'overdue') return { error: 'ยอดนี้เกินกำหนดชำระ กรุณากดขอขยายเวลาก่อน' }
    Object.assign(p, { amount: amt, slip, note: nt, customerSubmitted: true, submittedAt: now(), paidAt: localNow() })
  } else {
    p = { id: uid('pay'), requested: amt, amount: amt, method: 'โอนเงิน', paidAt: localNow(), slip, note: nt, dueAt: '', extension: null, status: 'reported', source: 'customer', customerSubmitted: true, submittedAt: now(), createdAt: now(), reportedBy: 'customer', confirmedBy: null }
    o.payments.push(p)
  }
  log(o, `ลูกค้าแจ้งชำระ ${money(amt)} ผ่านหน้าออร์เดอร์ (รอตรวจสลิป)`)
  if (o.status === 'awaiting_payment') o.status = 'payment_reported'
  notify('team_customer_paid', { vars: { ...orderVars(o), ยอดที่แจ้ง: money(amt) }, orderId: o.id })
  return { ok: true, paymentId: p.id }
}
// ลูกค้าขอขยายเวลาชำระ (เมื่องวดเกินกำหนด)
export function customerRequestExtension(ctx, paymentId, note = '') {
  const o = ctxOrder(ctx)
  if (!o) return { error: LINK_ERROR }
  const p = o.payments.find((x) => x.id === paymentId)
  if (!p || p.source === 'customer') return { error: 'ไม่พบยอดที่ร้านแจ้ง' }
  if (!requestPayExtension(o, paymentId, note)) return { error: 'ขอขยายเวลาไม่ได้ (ยังไม่เกินกำหนด หรือมีคำขอรออยู่)' }
  return { ok: true }
}
// มุมมองสำหรับหน้าลิงก์/บัญชี (รีเฟรชหลังทำรายการ)
export function customerOrderView(ctx) {
  const o = ctxOrder(ctx)
  return o ? publicOrderView(o, { owner: !!ctx.orderId }) : null
}
const localNow = () => {
  const d = new Date()
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function orderLinkUrl(token) {
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : ''
  return `${base}#/o/${token}`
}
export function purgeOrderLinks() {
  db.orderLinks = db.orderLinks.filter((l) => !l.revokedAt && linkAlive(l, db.shop.linkPolicy))
}
export function createOrderLink(order, { system = false } = {}) {
  if (!system && !can('createOrder')) return { error: 'ไม่มีสิทธิ์สร้างลิงก์' }
  if (!order || order.status === 'draft' || order.channel === 'pos') return { error: 'ออร์เดอร์นี้สร้างลิงก์ไม่ได้' }
  purgeOrderLinks()
  const token = genToken()
  const link = { id: uid('ol'), orderId: order.id, tokenHash: hashToken(token), createdAt: now(), lastOpenedAt: null, openCount: 0, revokedAt: null }
  db.orderLinks.push(link)
  if (!system) log(order, 'สร้างลิงก์ออร์เดอร์ให้ลูกค้า')
  return { ok: true, token, url: orderLinkUrl(token), link }
}
export function orderLinksOf(orderId) {
  purgeOrderLinks()
  return db.orderLinks.filter((l) => l.orderId === orderId).map((l) => ({ id: l.id, createdAt: l.createdAt, lastOpenedAt: l.lastOpenedAt, openCount: l.openCount, expiresAt: new Date(linkExpiresAt(l, db.shop.linkPolicy)).toISOString() }))
}
export function revokeOrderLinks(order) {
  if (!can('createOrder')) return { error: 'ไม่มีสิทธิ์' }
  const n = db.orderLinks.filter((l) => l.orderId === order.id).length
  db.orderLinks = db.orderLinks.filter((l) => l.orderId !== order.id)
  if (n) log(order, `เพิกถอนลิงก์ออร์เดอร์ ${n} ลิงก์`)
  return { ok: true, count: n }
}
export function sendOrderLinkToChat(order, url) {
  const chat = (order.chatId && findChat(order.chatId)) || chatFor(order.customerId)
  if (!chat) return { error: 'ลูกค้าคนนี้ยังไม่มีแชท' }
  sendChat(chat.id, 'staff', `ดูออร์เดอร์ ${order.code} ได้ที่ลิงก์นี้ค่ะ (ใช้ดูอย่างเดียว) ${url}`, { orderId: order.id, by: session.role })
  return { ok: true }
}
const maskPhone = (p) => (phoneDigits(p).length >= 6 ? `xxx-xxx-${phoneDigits(p).slice(-3)}` : '')
// เปิดลิงก์: ผ่าน → คืนข้อมูลที่ตัดแล้ว (ไม่มีต้นทุน/กำไร/บันทึกภายใน/ประวัติ/ที่อยู่/เบอร์เต็ม) และเลื่อนอายุ
export function openOrderLink(token) {
  const at = Date.now()
  while (linkFails.length && at - linkFails[0] >= 5 * 60e3) linkFails.shift()
  if (failBlocked(linkFails, at)) return { error: 'ลองบ่อยเกินไป กรุณารอสักครู่', blocked: true }
  const fail = () => { linkFails.push(at); return { error: LINK_ERROR } }
  if (!isTokenShape(token)) return fail()
  const h = hashToken(token)
  const link = db.orderLinks.find((l) => l.tokenHash === h)
  if (!link) return fail()
  if (link.revokedAt || !linkAlive(link, db.shop.linkPolicy, at)) {
    db.orderLinks = db.orderLinks.filter((l) => l !== link)
    return fail()
  }
  const o = findOrder(link.orderId)
  if (!o) return fail()
  link.lastOpenedAt = new Date(at).toISOString()
  link.openCount++
  return { ok: true, order: publicOrderView(o), expiresAt: new Date(linkExpiresAt(link, db.shop.linkPolicy)).toISOString() }
}
export function saveLinkSettings({ policy, allowlist }) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  db.shop.linkPolicy = cleanPolicy(policy)
  db.shop.linkAllowlist = cleanAllowlist(allowlist)
  return { ok: true }
}

// ---------- ลิงก์ย่อ (#/s/:code) ----------
// ภายใน = path ขึ้นต้น / · ภายนอก = https เฉพาะโฮสต์ใน linkAllowlist (ตรวจซ้ำตอนคลิก)
export function saveShortLink(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const chk = checkTarget(d.target, db.shop.linkAllowlist)
  if (chk.error) return chk
  let code = String(d.code ?? '').trim().toLowerCase()
  if (code && !isCodeShape(code)) return { error: 'รหัสใช้ได้เฉพาะ a-z 0-9 และ - (3–32 ตัว)' }
  const cur = d.id ? db.shortLinks.find((x) => x.id === d.id) : null
  if (!code) do code = genCode() 
  while (db.shortLinks.some((x) => x.code === code))
  if (db.shortLinks.some((x) => x.code === code && x !== cur)) return { error: 'รหัสนี้ถูกใช้แล้ว' }
  const expiresAt = d.expiresAt ? new Date(`${d.expiresAt}T23:59:59`).toISOString() : null
  const row = { code, target: chk.target, kind: chk.kind, expiresAt, active: d.active !== false, note: String(d.note ?? '').trim().slice(0, 120) }
  if (cur) Object.assign(cur, row)
  else db.shortLinks.unshift({ id: uid('sl'), clicks: 0, createdAt: now(), ...row })
  return { ok: true, code }
}
export function removeShortLink(id) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  db.shortLinks = db.shortLinks.filter((x) => x.id !== id)
  return { ok: true }
}
export const shortLinkUrl = (code) => orderLinkUrl('').replace('#/o/', `#/s/${code}`)
export function resolveShortLink(code) {
  const l = db.shortLinks.find((x) => x.code === String(code ?? '').toLowerCase())
  if (!l || !l.active || (l.expiresAt && Date.now() > new Date(l.expiresAt).getTime())) return { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' }
  const chk = checkTarget(l.target, db.shop.linkAllowlist) // allowlist อาจถูกเอาออกหลังสร้าง
  if (chk.error) return { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' }
  l.clicks++
  return { ok: true, kind: chk.kind, target: chk.target }
}

// ---------- เปลี่ยนผู้ซื้อ ----------
// ดูผลก่อนยืนยัน: ส่วนลดจากคะแนน/คูปองที่ใช้ในออร์เดอร์จะถูกนำออก (คืนผู้ซื้อเดิม) → ยอดรวมเพิ่ม · ส่งมอบแล้ว: คะแนน/สิทธิ์หมุนที่ได้โอนไปผู้ซื้อใหม่
export function changeBuyerPreview(order, newId) {
  if (!order || order.status === 'cancelled') return { error: 'ออร์เดอร์ที่ยกเลิกแล้วเปลี่ยนผู้ซื้อไม่ได้' }
  const to = findCustomer(newId)
  if (!to || to.deleted || to.active === false) return { error: 'ไม่พบลูกค้า' }
  if (to.id === order.customerId) return { error: 'เป็นผู้ซื้อคนเดิมอยู่แล้ว' }
  if (!phoneValid(to.phone)) return { error: 'ลูกค้าใหม่ต้องมีเบอร์โทร' }
  const t = orderTotals(order)
  const after = orderTotals({ ...order, pointsUsed: null, couponsUsed: [] })
  return {
    ok: true, from: findCustomer(order.customerId) || null, to,
    removedPoints: order.pointsUsed?.points || 0, removedCoupons: (order.couponsUsed || []).map((x) => x.name), removedAmount: t.pointsDiscount + t.couponDiscount,
    oldTotal: t.total, newTotal: after.total, newBalance: after.balance, transfer: order.loyalty ? { points: order.loyalty.points, spins: order.loyalty.spins } : null,
  }
}
export function changeBuyer(order, newId, reason = '') {
  if (!can('changeBuyer')) return { error: 'ไม่มีสิทธิ์เปลี่ยนผู้ซื้อ' }
  const pv = changeBuyerPreview(order, newId)
  if (pv.error) return pv
  const { from, to } = pv
  if (order.pointsUsed) removePoints(order)
  for (const u of [...(order.couponsUsed || [])]) removeCoupon(order, u.couponId)
  const l = order.loyalty
  if (l && from) {
    const lot = from.ledger.find((x) => x.id === l.lotId)
    if (lot) {
      const cut = lot.remaining
      lot.remaining = 0
      if (cut) from.ledger.push({ id: uid('pt'), at: now(), delta: -cut, reason: `โอนคะแนน ${order.code} ไปผู้ซื้อใหม่`, orderId: order.id })
    }
    from.spins = Math.max(0, from.spins - l.spins)
    const lot2 = earnPoints(to, l.points, `โอนมาจากออร์เดอร์ ${order.code}`, order.id)
    to.spins += l.spins
    order.loyalty = { ...l, lotId: lot2?.id || null }
  } else if (l) {
    order.loyalty = null // ไม่มีผู้ซื้อเดิมให้โอนจาก → คำนวณให้ผู้ซื้อใหม่ด้านล่าง
  }
  order.customerId = to.id
  if (order.chatId && findChat(order.chatId)?.customerId !== to.id) order.chatId = null
  log(order, `เปลี่ยนผู้ซื้อ ${from?.name || 'ไม่ระบุ'} → ${to.name}${reason ? ` (${String(reason).trim()})` : ''}${pv.removedAmount ? ` · นำส่วนลดคะแนน/คูปอง ${money(pv.removedAmount)} ออก` : ''}`)
  if (order.status === 'delivered' && !order.loyalty) awardOrder(order) // บิลที่ไม่เคยมีสมาชิก
  return { ok: true, ...pv }
}

// ---------- ฝั่งลูกค้า: แลกของ / หมุนกาชา ----------
export function redeemReward(c, rewardId) {
  const rw = db.rewards.find((x) => x.id === rewardId && x.active !== false)
  if (!rw || !spendPoints(c, rw.points, `แลก ${rw.name}`)) return null
  // คูปองส่วนลด: นำไปใช้ที่ POS/ออร์เดอร์ (มีขั้นต่ำ/อายุตามที่ตั้ง) · ของรางวัล: รับที่ร้าน
  if (rw.kind === 'coupon') {
    return newCoupon(c, { type: 'discount', rewardId: rw.id, name: rw.name, amount: Number(rw.amount) || 0, minSpend: Number(rw.minSpend) || 0, source: 'redeem', ...(Number(rw.validDays) > 0 ? { expiresAt: addDays(today(), Number(rw.validDays)) } : {}) })
  }
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

export const saveReward = (d) =>
  upsert(db.rewards, 'rw', { ...d, kind: d.kind === 'coupon' ? 'coupon' : 'item', points: Number(d.points) || 0, amount: Number(d.amount) || 0, minSpend: Number(d.minSpend) || 0, validDays: Number(d.validDays) || 0 })
export const savePrize = (d) => upsert(db.gachaPrizes, 'gp', { ...d, chance: Number(d.chance) || 0, value: Number(d.value) || 0 })
export function saveLoyaltySettings(d) {
  for (const k of Object.keys(db.loyalty)) db.loyalty[k] = Math.max(Number(d[k]) || 0, 0)
}

// ---------- ออร์เดอร์ตัวอย่าง ----------
function seed() {
  const o1 = createOrder({
    customerId: 'c1', pickupAt: at(1, 14), fulfillment: 'pickup', birthday: { name: 'แม่', md: at(5, 0).slice(5, 10) },
    items: [{ id: uid('i'), kind: 'custom', name: 'เค้กครีม · ช็อกโกแลต · 2 ปอนด์', qty: 1, note: 'ตามรูปตัวอย่าง', images: [],
      tiers: [{ selections: { g_size: 's2', g_sponge: 'sp2', g_filling: ['f2'], g_type: 't1', g_shape: 'sh3', g_color: 'ชมพูพาสเทล', g_topping: ['tp2'] } }],
      selections: { g_message: 'HBD แม่ 60 ปี', g_extra: ['x2'] } }],
  })
  reportPayment(o1, { amount: 600, method: 'โอนเงิน', paidAt: at(0, 9) })
  confirmPayment(o1, o1.payments[0].id)

  const o2 = createOrder({
    customerId: 'c2', pickupAt: at(1, 14, 30), fulfillment: 'delivery', address: '99/9 ซ.สุขุมวิท 50 กรุงเทพฯ', shippingFee: 120,
    items: [{ id: uid('i'), kind: 'retail', retailId: 'rt8', retailPrice: 430, sizeId: 's1', typeId: 't1', name: 'เค้กช็อกโกแลตฟัดจ์', qty: 1, note: '', images: [], selections: { g_message: 'Happy Birthday', g_diet: ['dt1'] } }],
  })
  reportPayment(o2, { amount: 540, method: 'โอนเงิน', paidAt: at(0, 10) })

  createOrder({
    customerId: 'c3', pickupAt: at(3, 10), fulfillment: 'pickup',
    items: [{ id: uid('i'), kind: 'retail', retailId: 'rt10', retailPrice: 1050, sizeId: 's2', typeId: 't3', name: 'เค้กใบเตยมะพร้าวอ่อน', qty: 3, note: '', images: [], selections: { g_extra: ['x6'] } }],
  })

  const o4 = createOrder({
    customerId: 'c1', pickupAt: at(0, 17), fulfillment: 'delivery', address: '12 ถ.พระราม 9 กรุงเทพฯ', shippingFee: 80,
    items: [{ id: uid('i'), kind: 'retail', retailId: 'rt11', retailPrice: 550, sizeId: 's1', typeId: 't2', name: 'เรดเวลเวท', qty: 1, note: '', images: [], selections: {} }],
  })
  reportPayment(o4, { amount: 530, method: 'เงินสด', paidAt: at(-1, 15) })
  confirmPayment(o4, o4.payments[0].id)
  setStatus(o4, 'preparing', 'เริ่มเตรียมสินค้า')

  createOrder({
    customerId: 'c2', pickupAt: at(5, 13), fulfillment: 'pickup',
    items: [{ id: uid('i'), kind: 'retail', retailId: 'rt9', retailPrice: 400, sizeId: 's1', typeId: 't1', name: 'เค้กส้ม', qty: 1, note: '', images: [], selections: {} }],
  }, true)
}

// คะแนนตัวอย่าง
earnPoints(db.customers[0], 120, 'คะแนนตัวอย่าง')
db.customers[0].spins = 2
const nearLot = earnPoints(db.customers[1], 40, 'คะแนนตัวอย่าง')
nearLot.expiresAt = addDays(today(), 10)

// ---------- การเชื่อมต่อ & แจ้งเตือน (จำลอง) ----------
// ทีม = Telegram · ลูกค้า = ช่องทางแรกตามลำดับ LINE → Facebook → SMS ที่ (เปิดในกฎ + เปิดใช้ช่องทาง + ลูกค้ามีข้อมูล)
const TEAM_OF = { order_created: 'team_new_order', payment_confirmed: 'team_payment_confirmed', cancelled: 'team_cancelled' }
const customerAddr = (c, ch) => (ch === 'line' ? c?.lineUserId : ch === 'facebook' ? c?.fbPsid : ch === 'sms' ? c?.phone : '')
export function fillTemplate(tpl, vars) {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v ?? ''), tpl || '')
}
function orderVars(order, extra = {}) {
  const c = findCustomer(order.customerId)
  const t = orderTotals(order)
  return {
    ชื่อลูกค้า: c?.name || '',
    เลขออร์เดอร์: order.code,
    ยอดรวม: money(t.total),
    คงค้าง: money(Math.max(t.balance, 0)),
    ยอดที่แจ้ง: extra.requested != null ? money(extra.requested) : '',
    ชำระก่อน: extra.dueAt ? dueText(extra.dueAt) : 'ไม่กำหนด',
    วันนัด: dateOnly(order.pickupAt),
    เวลานัด: timeOnly(order.pickupAt),
    ส่งมอบ: order.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับ',
    ชื่อวันเกิด: order.birthday?.name || c?.name || '',
    คะแนน: '',
    ลิงก์ออร์เดอร์: '',
  }
}
function pushOut(event, channel, to, text, orderId = null, customer = null) {
  // ส่งทาง LINE/Facebook: ลงเธรดของช่องทางนั้นในศูนย์รวมแชทด้วย (สร้างออร์เดอร์ = การ์ดสรุป)
  const chat = customer && (channel === 'line' || channel === 'facebook') ? chatFor(customer.id, channel) : null
  if (chat) {
    const order = orderId ? findOrder(orderId) : null
    if (event === 'order_created' && order) postOrderCard(order, chat)
    else sendChat(chat.id, 'staff', text, { orderId, by: 'ระบบ' })
  }
  db.outbox.unshift({ id: uid('msg'), at: now(), event, channel, to, text, orderId, status: channel ? 'simulated' : 'no_channel' })
}
// ส่งตามกฎของ event (คืนจำนวนข้อความที่เข้าคิว)
export function notify(event, { customer = null, vars = {}, orderId = null } = {}) {
  const r = db.notifyRules.find((x) => x.event === event)
  const ev = NOTIFY_EVENTS[event]
  if (!r || !r.enabled || !ev) return 0
  const text = fillTemplate(r.template, vars)
  if (ev.audience === 'team') {
    if (!r.channels.includes('telegram') || !db.integrations.telegram.enabled) return 0
    pushOut(event, 'telegram', 'กลุ่มทีม', text, orderId)
    return 1
  }
  if (ev.marketing && customer && customer.promoOptIn === false) return 0
  const ch = CUSTOMER_CHANNEL_ORDER.find((k) => r.channels.includes(k) && db.integrations[k]?.enabled && customerAddr(customer, k))
  const to = ch ? `${CHANNELS[ch].label}: ${customer?.name || ''}${ch === 'sms' ? ` (${formatPhone(customer.phone)})` : ''}` : customer?.name || '-'
  pushOut(event, ch || null, to, text, orderId, customer)
  return 1
}
// เหตุการณ์ของออร์เดอร์ → ลูกค้า + ทีม (ถ้ามีคู่ของทีม)
export function notifyOrder(event, order, extra = {}) {
  if (order.channel === 'pos') return // บิลหน้าร้านไม่แจ้งเตือน
  const vars = orderVars(order, extra)
  const rule = db.notifyRules.find((x) => x.event === event)
  if (rule?.enabled && rule.template.includes('{ลิงก์ออร์เดอร์}')) vars.ลิงก์ออร์เดอร์ = createOrderLink(order, { system: true }).url || ''
  const customer = findCustomer(order.customerId)
  notify(event, { customer, vars, orderId: order.id })
  if (TEAM_OF[event]) notify(TEAM_OF[event], { vars, orderId: order.id })
}
// เตือนลูกค้าที่เคยถูกแจ้งชำระแต่ยังไม่ชำระเลย เมื่อออร์เดอร์เป็นของพรุ่งนี้ ตั้งแต่เวลา payReminderTime (ครั้งเดียวต่อออร์เดอร์)
function payReminder(o, nowD, once) {
  if (['draft', 'cancelled', 'delivered', 'order_confirmed'].includes(o.status)) return
  const hm = `${pad(nowD.getHours())}:${pad(nowD.getMinutes())}`
  if (hm < db.shop.payReminderTime) return
  const tmr = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() + 1)
  const tmrStr = toDateStr(tmr)
  if (String(o.pickupAt).slice(0, 10) !== tmrStr) return
  const asked = o.payments.filter((p) => p.source !== 'customer')
  if (!asked.length) return // ไม่เคยแจ้งชำระ
  if (o.payments.some((p) => p.status === 'confirmed')) return // มีชำระแล้ว
  if (o.payments.some((p) => p.status === 'reported' && (p.slip || p.source === 'customer'))) return // ลูกค้าแจ้งโอนแล้ว รอตรวจ
  if (orderTotals(o).balance <= 0) return
  const open = asked.filter((p) => p.status === 'reported').sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0]
  once(`payrem|${o.id}|${tmrStr}`, () => { notifyOrder('payment_reminder', o, { dueAt: open?.dueAt || '' }); return 1 })
}
// จำลองรอบตรวจตามเวลา (ของจริงใช้ cron): เตือนนัดรับ 24 ชม., งานใกล้เวลา 2 ชม., วันเกิด, คะแนนใกล้หมดอายุ · ส่งครั้งเดียวต่อ key
export function runScheduledChecks() {
  let n = 0
  const nowMs = Date.now()
  const once = (key, fn) => {
    if (db.notifySent.includes(key)) return
    db.notifySent.push(key)
    n += fn()
  }
  for (const o of db.orders) {
    if (['draft', 'delivered', 'cancelled'].includes(o.status)) continue
    const toPickup = new Date(o.pickupAt).getTime() - nowMs
    if (toPickup > 0 && toPickup <= 24 * 3600e3) once(`pickup|${o.id}`, () => notify('pickup_reminder', { customer: findCustomer(o.customerId), vars: orderVars(o), orderId: o.id }))
    for (const p of overduePayments(o, new Date(nowMs))) once(`overdue|${p.id}|${p.dueAt}`, () => notify('team_pay_overdue', { vars: { ...orderVars(o), ชำระก่อน: dueText(p.dueAt) }, orderId: o.id }))
    payReminder(o, new Date(nowMs), once)
    const toDue = dueAt(o).getTime() - nowMs
    if (toDue <= 2 * 3600e3) once(`due|${o.id}`, () => notify('team_due_soon', { vars: orderVars(o), orderId: o.id }))
  }
  for (const b of upcomingBirthdays()) {
    const c = findCustomer(b.customerId)
    once(`bd|${b.customerId}|${b.name}|${b.md}|${b.year}`, () => notify('birthday', { customer: c, vars: { ...orderVars(b.order), ชื่อวันเกิด: b.name || c?.name || '' }, orderId: b.order.id }))
  }
  const today = toDateStr(new Date())
  for (const c of db.customers) {
    const soon = expiringSoon(c.ledger || [], today)
    if (soon?.points > 0) once(`pts|${c.id}|${soon.date}`, () => notify('points_expiring', { customer: c, vars: { ชื่อลูกค้า: c.name, คะแนน: String(soon.points) } }))
  }
  return n
}
export const saveNotifyRule = (event, d) => {
  const r = db.notifyRules.find((x) => x.event === event)
  if (r) Object.assign(r, { channels: [...d.channels], template: d.template.trim(), enabled: d.enabled !== false })
}
export const clearOutbox = () => db.outbox.splice(0)

// ---------- ศูนย์รวมแชท LINE OA + Facebook (จำลอง: ของจริงรับผ่าน webhook ส่งผ่าน Reply/Push/Send API) ----------
// chat: { channel: 'line' | 'facebook', externalId (LINE userId / FB PSID), profileName, customerId (null = ยังไม่ผูก), lastInboundAt }
export const findChat = (id) => db.chats.find((c) => c.id === id)
const idField = (channel) => (channel === 'line' ? 'lineUserId' : 'fbPsid')
export const chatsOfCustomer = (customerId) => db.chats.filter((c) => c.customerId === customerId)
// แชทของลูกค้าในช่องทางนั้น (หรือแชทล่าสุดถ้าไม่ระบุช่องทาง)
export const chatFor = (customerId, channel = null) => db.chats.find((c) => c.customerId === customerId && (!channel || c.channel === channel)) || null
// Facebook ตอบข้อความทั่วไปได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด
export const fbWindowLeft = (chat) => (chat?.lastInboundAt ? 24 * 3600e3 - (Date.now() - new Date(chat.lastInboundAt).getTime()) : 0)
export const fbWindowOpen = (chat) => chat?.channel !== 'facebook' || fbWindowLeft(chat) > 0
function newChat(channel, externalId, profileName) {
  const owner = db.customers.find((c) => c[idField(channel)] && c[idField(channel)] === externalId)
  const c = { id: uid('ch'), channel, externalId, profileName: profileName || 'ไม่ทราบชื่อ', customerId: owner?.id || null, messages: [], unreadStaff: 0, lastInboundAt: null, updatedAt: now(), pendingAsk: null }
  db.chats.unshift(c)
  return c
}
export function sendChat(chatId, from, text, extra = {}) {
  const c = findChat(chatId)
  const t = (text || '').trim()
  if (!c || (!t && !['order', 'quote'].includes(extra.kind))) return null
  const at = extra.at || now()
  const m = { id: uid('cm'), from, kind: extra.kind || 'text', text: t, orderId: extra.orderId || null, quoteId: extra.quoteId || null, replyTo: extra.replyTo || null, ask: extra.ask || null, answerFor: extra.answerFor || null, filled: extra.filled || null, at, by: extra.by || (from === 'staff' ? session.role : 'ลูกค้า'), delivery: from === 'staff' ? 'simulated' : null }
  c.messages.push(m)
  c.updatedAt = at
  if (from === 'customer') {
    c.unreadStaff++
    c.lastInboundAt = at
  }
  // แชทล่าสุดขึ้นบนสุด
  db.chats.splice(db.chats.indexOf(c), 1)
  db.chats.unshift(c)
  return m
}
// ข้อความเข้าจาก LINE/Facebook (ของจริงมาจาก webhook) · ผูกอัตโนมัติถ้า userId/PSID ตรงกับลูกค้า
// ถ้ามีคำถามค้าง (ปุ่มถาม) ข้อความนี้ = คำตอบ → ผูกกับคำถามและกรอกลงร่างอัตโนมัติ
export function receiveMessage(channel, externalId, profileName, text, at = null) {
  const c = db.chats.find((x) => x.channel === channel && x.externalId === externalId) || newChat(channel, externalId, profileName)
  if (profileName) c.profileName = profileName
  const ask = c.pendingAsk
  const parsed = ask ? parseAnswer(ask.field, text) : null
  const m = sendChat(c.id, 'customer', text, { at, ...(ask ? { replyTo: ask.messageId, answerFor: ask.field } : {}) })
  if (ask && parsed) {
    m.filled = applyToDraft(c.id, parsed)
    c.pendingAsk = null
  } else runBot(c, m)
  return c
}

// ---------- บอทตอบแชท ----------
// ทำงานเมื่อมีข้อความจากลูกค้า (LINE/Facebook): suggest = เก็บร่างให้พนักงานกดส่ง · auto = ส่งเองหลังหน่วงเวลา (Facebook ต้องอยู่ในหน้าต่าง 24 ชม.)
// ไม่แน่ใจ/เรื่องเงิน/ร้องเรียน/ยืนยันตัวตนไม่ได้ → ส่งต่อพนักงาน + แจ้ง Telegram · ข้อความลูกค้าประมวลผลในเบราว์เซอร์เท่านั้น
const botOn = (c) => db.bot.enabled && db.bot.mode !== 'off' && !!db.bot.channels[c.channel] && !c.botOff
function botDeliver(c, res) {
  if (res.prefix) sendChat(c.id, 'staff', res.prefix, { by: 'บอท' }) // ข้อความแจ้งร้านปิด (ส่งก่อนคำตอบ)
  if (res.askField) askCustomer(c.id, res.askField)
  else sendChat(c.id, 'staff', res.reply, { by: 'บอท' })
  db.bot.stats.answered++
}
// ข้อความแจ้งร้านปิด: เฉพาะข้อความแรกของวัน (ของแชทนี้) ที่ทักมาตอนร้านปิด · คืน null ถ้าไม่ต้องแจ้ง
function closedNoticeFor(c, m, at = new Date()) {
  const cn = db.bot.closedNotice
  if (!cn?.enabled) return null
  const closure = isClosedNow(db.shop, at)
  if (!closure) return null
  const day = toDateStr(at)
  if (c.closedNoticeDay === day) return null
  const earlier = c.messages.some((x) => x.from === 'customer' && x.id !== m.id && toDateStr(new Date(x.at)) === day)
  if (earlier) return null
  c.closedNoticeDay = day
  const nx = nextOpen(db.shop, at)
  return fillTemplate(cn.text, { เหตุผล: closure.reason || 'ตามเวลาทำการ', เปิดอีกครั้ง: nx ? `${dateOnly(nx)} ${pad(nx.getHours())}:${pad(nx.getMinutes())} น.` : 'ตามที่ร้านแจ้ง' })
}
export function runBot(c, m) {
  if (!m || m.kind !== 'text' || !botOn(c)) return null
  const notice = closedNoticeFor(c, m)
  const auto = db.bot.mode === 'auto' && fbWindowOpen(c)
  let noticeDone = !notice
  const sendNotice = () => { if (!noticeDone) { noticeDone = true; sendChat(c.id, 'staff', notice, { by: 'บอท' }) } }
  const prefixOf = () => { if (!noticeDone && !auto) { noticeDone = true; return notice } return null }
  // ไม่มีข้อความตอบ (ส่งต่อ/ความมั่นใจต่ำ) → ยังแจ้งร้านปิดให้ลูกค้า (ส่งเอง หรือเป็นร่างให้พนักงานกดส่ง)
  const flushNotice = () => {
    if (noticeDone) return
    if (auto) sendNotice()
    else { noticeDone = true; c.botDraft = c.botDraft || { text: notice, source: 'closed', confidence: 1, reason: 'ร้านปิด — แจ้งครั้งแรกของวัน', at: now() } }
  }
  const res = botReply(String(m.text).replace(CODE_RE, ' '), { db, chat: c, draft: db.chatDrafts[c.id] || null })
  c.botDraft = null
  c.botHandoff = false
  if (res.handoff) {
    db.bot.stats.handoff++
    c.botHandoff = true
    if (db.bot.handoff.notifyTelegram && db.integrations.telegram.enabled) pushOut('bot_handoff', 'telegram', 'กลุ่มทีม', `[บอทส่งต่อ] ${c.profileName || 'ลูกค้า'} (${c.channel}): "${String(m.text).slice(0, 80)}" · ${res.reason}`)
    if (res.source === 'order_unverified' || res.source === 'handoff') {
      if (auto) { sendNotice(); sendChat(c.id, 'staff', res.reply, { by: 'บอท' }) }
      else c.botDraft = { text: res.reply, source: res.source, confidence: res.confidence, reason: res.reason, handoff: true, prefix: prefixOf(), at: now() }
    }
    flushNotice()
    return res
  }
  if (res.confidence < db.bot.confidence) {
    db.bot.stats.handoff++
    c.botHandoff = true
    flushNotice()
    return { ...res, handoff: true, reason: `ความมั่นใจ ${Math.round(res.confidence * 100)}% ต่ำกว่าที่ตั้งไว้` }
  }
  if (res.ruleId) {
    const r = db.bot.rules.find((x) => x.id === res.ruleId)
    if (r) r.hits = (r.hits || 0) + 1
  }
  if (res.learnedId) {
    const l = db.bot.learned.find((x) => x.id === res.learnedId)
    if (l) { l.uses++; l.lastAt = now() }
  }
  if (auto) {
    sendNotice()
    const fire = () => { if (botOn(c) && findChat(c.id)) botDeliver(c, res) }
    if (db.bot.delaySec > 0) setTimeout(fire, db.bot.delaySec * 1000)
    else fire()
  } else {
    c.botDraft = { text: res.reply, source: res.source, confidence: res.confidence, reason: res.reason, askField: res.askField || null, prefix: prefixOf(), at: now() }
    db.bot.stats.suggested++
  }
  return res
}
// แนะนำสินค้า: ส่งข้อความแนะนำเข้าแชท / เพิ่มสินค้าสำเร็จลงร่างออร์เดอร์ของแชท (เค้กสั่งทำต้องเลือกตัวเลือกเอง จึงเพิ่มลงร่างอัตโนมัติไม่ได้)
export function recommendText(recs) {
  const lines = recs.map((r) => `• ${r.name} ${r.kind === 'custom' && r.from ? 'เริ่มต้น ' : ''}${money(r.price)}`)
  return `แนะนำสำหรับคุณลูกค้าค่ะ\n${lines.join('\n')}\nดูเมนูทั้งหมดได้ที่เว็บร้านนะคะ`
}
export function addRecommendToDraft(chatId, rec) {
  if (!findChat(chatId) || rec.kind !== 'ready') return { error: 'เพิ่มลงร่างอัตโนมัติได้เฉพาะสินค้าสำเร็จ' }
  const p = db.retailItems.find((x) => x.id === rec.id)
  if (!p || p.active === false) return { error: 'ไม่พบสินค้า' }
  const d = draftOf(chatId)
  d.items.push(priceItem({ id: uid('i'), kind: 'retail', retailId: p.id, retailPrice: Number(p.price) || 0, sizeId: p.sizeId || null, typeId: p.typeId || null, name: p.name, qty: 1, note: '', images: [], selections: {}, tiers: [] }))
  return { ok: true }
}
export function sendBotDraft(chatId) {
  const c = findChat(chatId)
  if (!c?.botDraft || !fbWindowOpen(c)) return { error: 'ส่งไม่ได้' }
  const d = c.botDraft
  c.botDraft = null
  c.botHandoff = false
  botDeliver(c, { reply: d.text, askField: d.askField, prefix: d.prefix || null })
  return { ok: true }
}
export function dismissBotDraft(chatId) {
  const c = findChat(chatId)
  if (c) c.botDraft = null
}
export function setChatBot(chatId, on) {
  const c = findChat(chatId)
  if (c) { c.botOff = !on; if (!on) c.botDraft = null }
}
// เรียกหลังพนักงานพิมพ์ตอบเอง: เรียนรู้คู่ ถาม→ตอบ (ตัดข้อมูลส่วนบุคคล) · แก้ร่างบอท = เก็บคำตอบของพนักงานเป็นคำตอบที่ดีกว่า
export function staffReplied(chatId, text) {
  const c = findChat(chatId)
  const a = String(text ?? '').trim()
  if (!c || !a) return null
  const draft = c.botDraft
  c.botDraft = null
  c.botHandoff = false
  const msgs = c.messages.filter((x) => x.kind === 'text')
  let q = ''
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].from === 'staff' && msgs[i].text === a) continue
    if (msgs[i].from === 'customer') q = msgs[i].text
    break
  }
  if (draft && !draft.handoff) {
    if (similarity(a, draft.text) < 0.98) db.bot.stats.staffEdited++
    else db.bot.stats.answered++
  }
  if (!q || isSensitive(q) || isSensitive(a) || a.length < 4) return null
  const cu = findCustomer(c.customerId)
  const names = [c.profileName, cu?.name, cu?.name?.split(/\s+/)[0]]
  const qq = scrubPII(q, names).slice(0, 200)
  const aa = scrubPII(a, names).slice(0, 500)
  if (qq.replace(/\{[^}]+\}/g, '').trim().length < 4) return null
  const ex = db.bot.learned.find((l) => similarity(l.q, qq) >= 0.85)
  if (ex) { ex.a = aa; ex.lastAt = now(); return ex }
  const row = { id: uid('bl'), q: qq, a: aa, uses: 0, createdAt: now(), lastAt: now() }
  db.bot.learned.unshift(row)
  if (db.bot.learned.length > LEARN_MAX) db.bot.learned.length = LEARN_MAX
  return row
}
export function saveBotSettings(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const b = db.bot
  b.enabled = !!d.enabled
  b.mode = ['suggest', 'auto'].includes(d.mode) ? d.mode : 'suggest'
  b.channels = { line: !!d.channels?.line, facebook: !!d.channels?.facebook }
  b.confidence = Math.min(0.95, Math.max(0.3, Number(d.confidence) || 0.6))
  b.delaySec = Math.min(60, Math.max(0, Math.round(Number(d.delaySec) || 0)))
  b.offHours = { enabled: !!d.offHours?.enabled, text: String(d.offHours?.text ?? '').trim().slice(0, 300) || BOT_DEFAULTS.offHours.text }
  b.closedNotice = { enabled: !!d.closedNotice?.enabled, text: String(d.closedNotice?.text ?? '').trim().slice(0, 300) || BOT_DEFAULTS.closedNotice.text }
  b.handoff = { notifyTelegram: !!d.handoff?.notifyTelegram, text: String(d.handoff?.text ?? '').trim().slice(0, 300) || BOT_DEFAULTS.handoff.text }
  return { ok: true }
}
export function saveBotRule(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const keywords = String(Array.isArray(d.keywords) ? d.keywords.join(',') : d.keywords ?? '').split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20)
  const name = String(d.name ?? '').trim().slice(0, 60)
  const reply = String(d.reply ?? '').trim().slice(0, 500)
  if (!name || !keywords.length || !reply) return { error: 'กรอกชื่อ คีย์เวิร์ด และคำตอบ' }
  if (keywords.some((k) => k.length < 2)) return { error: 'คีย์เวิร์ดสั้นเกินไป (อย่างน้อย 2 ตัวอักษร)' }
  const cur = d.id ? db.bot.rules.find((x) => x.id === d.id) : null
  if (cur) Object.assign(cur, { name, keywords, reply, active: d.active !== false })
  else db.bot.rules.push({ id: uid('br'), name, keywords, reply, active: d.active !== false, hits: 0 })
  return { ok: true }
}
export function removeBotRule(id) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  db.bot.rules = db.bot.rules.filter((x) => x.id !== id)
  return { ok: true }
}
export function removeLearned(id) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  db.bot.learned = db.bot.learned.filter((x) => x.id !== id)
  return { ok: true }
}
// ยืนยันคู่ที่เรียนมาเป็นกฎ (คีย์เวิร์ด = ข้อความคำถามเดิม) แล้วเอาออกจากรายการเรียนรู้
export function promoteLearned(id, keywords) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const l = db.bot.learned.find((x) => x.id === id)
  if (!l) return { error: 'ไม่พบรายการ' }
  const r = saveBotRule({ name: `จากการเรียนรู้: ${l.q.slice(0, 30)}`, keywords: keywords || l.q, reply: l.a })
  if (r.error) return r
  db.bot.learned = db.bot.learned.filter((x) => x.id !== id)
  return { ok: true }
}
// ทดสอบในหน้าตั้งค่า: ไม่ส่งจริง ไม่นับสถิติ · customerId = จำลองว่าแชทผูกกับลูกค้านี้
export function testBot(text, { customerId = null, at = null } = {}) {
  const chat = { channel: 'line', customerId, profileName: 'ลูกค้าทดสอบ', messages: [] }
  return botReply(text, { db, chat, now: at || new Date() })
}

// ---------- ถามลูกค้า / กรอกร่างจากแชท ----------
export const ASK_FIELDS = {
  phone: { label: 'ขอเบอร์', text: 'รบกวนขอเบอร์โทรติดต่อด้วยค่ะ' },
  datetime: { label: 'ขอวันเวลารับ', text: 'ต้องการรับเค้กวันไหน เวลากี่โมงคะ' },
  address: { label: 'ขอที่อยู่', text: 'รบกวนขอที่อยู่จัดส่งด้วยค่ะ' },
  message: { label: 'ขอข้อความบนเค้ก', text: 'ต้องการเขียนข้อความบนเค้กว่าอะไรคะ' },
  name: { label: 'ขอชื่อ', text: 'รบกวนขอชื่อผู้สั่งด้วยค่ะ' },
}
export function askCustomer(chatId, field) {
  const c = findChat(chatId)
  if (!c || !ASK_FIELDS[field]) return null
  const m = sendChat(chatId, 'staff', ASK_FIELDS[field].text, { ask: field })
  c.pendingAsk = { field, messageId: m.id }
  return m
}
export function cancelAsk(chatId) {
  const c = findChat(chatId)
  if (c) c.pendingAsk = null
}
// เพิ่มสินค้าสั่งทำจากรหัสที่ลูกค้าคัดลอกมา (#CK1…) ลงร่างออร์เดอร์ของแชท · คืน { added: [ชื่อ], warnings: [], errors: [] }
export function addCakeCodesToDraft(chatId, rawText) {
  const c = findChat(chatId)
  const out = { added: [], warnings: [], errors: [] }
  if (!c) return { ...out, errors: ['ไม่พบแชท'] }
  const codes = findCodes(rawText)
  if (!codes.length) return { ...out, errors: ['ไม่พบรหัสสินค้า (#CK1…) ในข้อความ'] }
  const d = draftOf(chatId)
  for (const code of codes) {
    const r = decodeCake(code, { groups: db.optionGroups, products: db.retailItems, active: activeListsAt(''), bundles: db.bundles })
    if (r.error) { out.errors.push(r.error); continue }
    d.items.push(r.item)
    out.added.push(`${r.item.name} × ${r.item.qty}`)
    out.warnings.push(...r.warnings.map((w) => w.text))
  }
  return out
}
// กรอกข้อมูลลงร่างของแชท (หรือเบอร์ลูกค้าที่ผูกแล้ว) → คืนรายการที่กรอก [{ label, value }] + suggest (ลูกค้าที่เบอร์ตรง)
export function applyToDraft(chatId, data) {
  const c = findChat(chatId)
  if (!c) return null
  const d = draftOf(chatId)
  const done = []
  let suggest = null
  if (data.phone) {
    const cu = findCustomer(c.customerId)
    if (cu && !phoneValid(cu.phone)) {
      cu.phone = data.phone
      done.push({ label: 'เบอร์ลูกค้า', value: formatPhone(data.phone) })
    } else if (!cu) {
      d.contactPhone = data.phone
      done.push({ label: 'เบอร์ (ร่าง)', value: formatPhone(data.phone) })
      const match = db.customers.find((x) => x.phone === data.phone)
      if (match) suggest = match.id
    } else done.push({ label: 'เบอร์', value: `${formatPhone(data.phone)} (ลูกค้ามีเบอร์แล้ว ไม่เปลี่ยน)` })
  }
  if (data.date) {
    d.date = data.date
    done.push({ label: 'วันนัด', value: dateOnly(data.date) })
  }
  if (data.time) {
    d.time = data.time
    done.push({ label: 'เวลา', value: data.time })
  }
  if (data.address) {
    d.address = data.address
    d.fulfillment = 'delivery'
    done.push({ label: 'ที่อยู่จัดส่ง', value: data.address })
  }
  if (data.message) {
    d.cakeMessage = data.message
    const g = db.optionGroups.find((x) => x.type === 'text' && x.name.includes('ข้อความ'))
    if (g) for (const it of d.items) if (!it.selections?.[g.id]) it.selections = { ...(it.selections || {}), [g.id]: data.message }
    done.push({ label: 'ข้อความบนเค้ก', value: data.message })
  }
  if (data.name) {
    d.contactName = data.name
    done.push({ label: 'ชื่อ (ร่าง)', value: data.name })
  }
  return { done, suggest }
}
export const saveCanned = (d) => upsert(db.cannedReplies, 'cr', { ...d, title: d.title.trim(), text: d.text.trim() })
export function removeCanned(id) {
  const i = db.cannedReplies.findIndex((x) => x.id === id)
  if (i >= 0) db.cannedReplies.splice(i, 1)
}

// ---------- เชื่อมบัญชี LINE OA / Facebook (จำลอง: ของจริง Facebook OAuth / LINE วาง token แล้วตั้ง webhook อัตโนมัติ) ----------
export function connectIntegration(key, info) {
  Object.assign(db.integrations[key], { status: 'connected', enabled: true, connectedAt: now(), accountName: info.accountName || '', accountId: info.accountId || '', tokenHint: info.tokenHint || '' })
}
export function disconnectIntegration(key) {
  Object.assign(db.integrations[key], { status: 'not_connected', accountName: '', accountId: '', connectedAt: null, tokenHint: '', url: '', sender: '' })
}
// Telegram: bot token + chat id (จำลอง ไม่ยิง API จริง · เก็บเฉพาะ 4 ตัวท้ายของ token) · SMS: URL (https) + ชื่อผู้ส่ง + คีย์ (เก็บ 4 ตัวท้าย)
export function connectTelegram({ token, chatId }) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const c = checkTelegram(token, chatId)
  if (c.error) return c
  connectIntegration('telegram', { accountName: 'บอททีม', accountId: c.chatId, tokenHint: c.token.slice(-4) })
  return { ok: true }
}
export function connectSms({ url, sender, key }) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const u = checkSmsUrl(url)
  if (u.error) return u
  const sd = checkSmsSender(sender)
  if (sd.error) return sd
  const k = String(key ?? '').trim()
  if (k.length < 8) return { error: 'คีย์ (API key) สั้นเกินไป' }
  connectIntegration('sms', { accountName: sd.sender, accountId: u.host, tokenHint: k.slice(-4) })
  db.integrations.sms.url = u.url
  db.integrations.sms.sender = sd.sender
  return { ok: true }
}
// ส่งข้อความทดสอบ (จำลอง: ลงคิวข้อความ ไม่ส่งจริง)
export function sendIntegrationTest(key, to = '') {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const it = db.integrations[key]
  if (!it || it.status !== 'connected') return { error: 'ยังไม่ได้เชื่อม' }
  let text
  let toLabel
  if (key === 'telegram') {
    text = `[ทดสอบ] ข้อความทดสอบจาก ${db.shop.name} · ${dateOnly(now())} ${timeOnly(now())}`
    toLabel = 'กลุ่มทีม'
  } else if (key === 'sms') {
    if (!phoneValid(to)) return { error: 'กรอกเบอร์โทร 9–10 หลัก' }
    text = `[ทดสอบ] ข้อความทดสอบจาก ${it.sender || db.shop.name}`
    toLabel = `SMS: ${formatPhone(to)}`
  } else return { error: 'ช่องทางนี้ไม่มีปุ่มทดสอบ' }
  db.outbox.unshift({ id: uid('msg'), at: now(), event: 'test', channel: key, to: toLabel, text, orderId: null, status: 'simulated' })
  return { ok: true, text, to: toLabel }
}
export function markRead(chatId) {
  const c = findChat(chatId)
  if (c) c.unreadStaff = 0
}
// ผูกแชทกับลูกค้า (จำ LINE userId / FB PSID ไว้กับลูกค้า)
export function linkChat(chatId, customerId) {
  const c = findChat(chatId)
  const cu = findCustomer(customerId)
  if (!c || !cu) return
  c.customerId = cu.id
  cu[idField(c.channel)] = c.externalId
  const d = db.chatDrafts[c.id]
  if (d) d.customerId = cu.id
}
// ลูกค้าทุกคนต้องมีเบอร์โทร
export function createCustomerFromChat(chatId, phone, name = '') {
  const c = findChat(chatId)
  if (!c || !phoneValid(phone)) return null
  const cu = addCustomer({ name: (name || c.profileName).trim(), phone, line: '', note: `จาก ${c.channel === 'line' ? 'LINE OA' : 'Facebook'}` })
  linkChat(chatId, cu.id)
  return cu
}
// การ์ดสรุปออร์เดอร์ในแชท (แชทของออร์เดอร์ ถ้าไม่มีใช้แชทล่าสุดของลูกค้า)
export function postOrderCard(order, chat = null) {
  const c = chat || (order.chatId ? findChat(order.chatId) : chatFor(order.customerId))
  if (!c) return
  if (!order.chatId) order.chatId = c.id
  sendChat(c.id, 'staff', '', { kind: 'order', orderId: order.id, by: 'ระบบ' })
}
// ---------- ร่างออร์เดอร์ต่อแชท ----------
export function draftOf(chatId) {
  if (!db.chatDrafts[chatId]) {
    const c = findChat(chatId)
    db.chatDrafts[chatId] = {
      customerId: c?.customerId || null, date: toDateStr(new Date()), time: '', fulfillment: 'pickup', address: '', shippingFee: 0, placeName: '', mapUrl: '', detail: '', distanceKm: '', feeManual: false,
      items: [], birthday: { name: '', day: '', month: '' }, step: 1,
    }
  }
  return db.chatDrafts[chatId]
}
export const hasDraft = (chatId) => !!db.chatDrafts[chatId] && (db.chatDrafts[chatId].items.length > 0 || !!db.chatDrafts[chatId].time)
export function clearDraft(chatId) {
  delete db.chatDrafts[chatId]
}

// ---------- ใบเสนอในแชท ----------
let quoteNo = 0
export const findQuote = (id) => db.quotes.find((q) => q.id === id)
// ส่งใบเสนอจากร่าง: ราคาล็อก ณ ตอนส่ง · ใบเดิมที่ยังรออยู่ในแชทเดียวกัน → superseded
export function sendQuote(chatId, draft) {
  const c = findChat(chatId)
  if (!c) return null
  if (pickupClosed(db.shop, draft.pickupAt)) return null // วัน-เวลานัดตรงช่วงปิดร้าน
  for (const old of db.quotes) if (old.chatId === chatId && old.status === 'pending') old.status = 'superseded'
  const payload = JSON.parse(JSON.stringify({
    customerId: c.customerId, pickupAt: draft.pickupAt, fulfillment: draft.fulfillment,
    ...deliveryFields(draft),
    birthday: draft.birthday || null, items: draft.items.map((i) => priceItem(i)), vat: vatNow(),
  }))
  const q = { id: uid('qt'), code: `QT-${String(++quoteNo).padStart(4, '0')}`, chatId, customerId: c.customerId, payload, status: 'pending', orderId: null, createdAt: now(), respondedAt: null }
  db.quotes.unshift(q)
  sendChat(chatId, 'staff', '', { kind: 'quote', quoteId: q.id })
  return q
}
// ลูกค้ายืนยัน → สร้างออร์เดอร์ (รอชำระ) จากใบเสนอ
// แชทพร้อมสร้างออร์เดอร์ไหม: ผูกลูกค้าแล้ว + ลูกค้ามีเบอร์ (คืนเหตุผลถ้ายังไม่พร้อม)
export function chatOrderBlock(chatId) {
  const c = findChat(chatId)
  const cu = c ? findCustomer(c.customerId) : null
  if (!cu) return 'ยังไม่ได้ผูกบัญชีลูกค้า'
  if (!phoneValid(cu.phone)) return 'ลูกค้ายังไม่มีเบอร์โทร'
  return ''
}
function quoteToOrder(q) {
  const c = findChat(q.chatId)
  const o = createOrder({ ...JSON.parse(JSON.stringify(q.payload)), customerId: c.customerId, chatId: q.chatId, quoteItems: true })
  if (o.error) return o
  Object.assign(q, { status: 'accepted', orderId: o.id })
  clearDraft(q.chatId)
  return o
}
// ลูกค้ากดยืนยัน (postback) · ถ้ายังไม่ผูก/ไม่มีเบอร์ → ขอเบอร์ และรอพนักงานสร้างออร์เดอร์
export function acceptQuote(quoteId) {
  const q = findQuote(quoteId)
  if (!q || q.status !== 'pending') return { error: 'ใบเสนอนี้ใช้ไม่ได้แล้ว' }
  if (new Date(q.payload.pickupAt) <= new Date()) return { error: 'เวลานัดผ่านแล้ว กรุณาขอใบเสนอใหม่' }
  sendChat(q.chatId, 'customer', `ยืนยันใบเสนอ ${q.code}`)
  q.respondedAt = now()
  if (chatOrderBlock(q.chatId)) {
    q.status = 'need_phone'
    sendChat(q.chatId, 'staff', 'ขอบคุณค่ะ รบกวนแจ้งชื่อและเบอร์โทรเพื่อยืนยันออร์เดอร์นะคะ', { by: 'ระบบ' })
    return { needPhone: true }
  }
  const o = quoteToOrder(q)
  return o.error ? { error: o.error } : { order: o }
}
// พนักงานสร้างออร์เดอร์จากใบเสนอที่ลูกค้ายืนยันแล้ว (หลังผูก/ได้เบอร์)
export function convertQuote(quoteId) {
  const q = findQuote(quoteId)
  if (!q || q.status !== 'need_phone') return { error: 'ใบเสนอนี้ใช้ไม่ได้แล้ว' }
  const block = chatOrderBlock(q.chatId)
  if (block) return { error: block }
  if (new Date(q.payload.pickupAt) <= new Date()) return { error: 'เวลานัดผ่านแล้ว ส่งใบเสนอใหม่' }
  const o = quoteToOrder(q)
  return o.error ? { error: o.error } : { order: o }
}
export function reviseQuote(quoteId, note = '') {
  const q = findQuote(quoteId)
  if (!q || q.status !== 'pending') return
  Object.assign(q, { status: 'revise', respondedAt: now(), note })
  sendChat(q.chatId, 'customer', `ขอแก้ไขใบเสนอ ${q.code}${note ? `: ${note}` : ''}`)
}

export const unreadChats = () => db.chats.filter((c) => c.unreadStaff > 0).length

// ---------- POS หน้าร้าน ----------
let posNo = 0
export const currentShift = () => db.shifts.find((s) => !s.closedAt) || null
export function openShift(float) {
  if (currentShift()) return currentShift()
  const s = { id: uid('sh'), openedAt: now(), openedBy: session.role, float: Number(float) || 0, closedAt: null, counted: null, note: '' }
  db.shifts.unshift(s)
  return s
}
export const shiftBills = (shiftId) => db.orders.filter((o) => o.channel === 'pos' && o.shiftId === shiftId)
// สรุปกะ: ยอดตามช่องทาง (ไม่นับบิลยกเลิก) · เงินสดที่ควรมี = ตั้งต้น + ขายเงินสด
export function shiftSummary(shift) {
  const bills = shiftBills(shift.id)
  const live = bills.filter((o) => o.status !== 'cancelled')
  const byMethod = {}
  for (const o of live) for (const p of o.payments) if (p.status === 'confirmed') byMethod[p.posMethod || 'cash'] = (byMethod[p.posMethod || 'cash'] || 0) + p.amount
  const total = Object.values(byMethod).reduce((a, b) => a + b, 0)
  return { bills: bills.length, cancelled: bills.length - live.length, byMethod, total, expectedCash: shift.float + (byMethod.cash || 0) }
}
export function closeShift(counted, note = '') {
  const s = currentShift()
  if (!s) return null
  Object.assign(s, { closedAt: now(), closedBy: session.role, counted: Number(counted) || 0, note, summary: shiftSummary(s) })
  return s
}
// ตัวเลือกที่เลือก [{ groupId, optionId }] → สำเนา { group, name, price } (เก็บในรายการ ไม่เปลี่ยนตามการแก้ภายหลัง)
export function modsOf(sel = []) {
  return sel
    .map((x) => {
      const g = db.posModifiers.find((m) => m.id === x.groupId)
      const o = g?.options.find((y) => y.id === x.optionId)
      return o ? { groupId: g.id, optionId: o.id, group: g.name, name: o.name, price: Number(o.price) || 0 } : null
    })
    .filter(Boolean)
}
export const modsText = (mods) => (mods || []).map((m) => m.name).join(' · ')
// key ของบรรทัดตะกร้า: สินค้า + ชุดตัวเลือก
export const lineKey = (l) => `${l.kind}|${l.refId}|${(l.mods || []).map((m) => `${m.groupId}:${m.optionId}`).sort().join(',')}`
export const saveModifier = (d) =>
  upsert(db.posModifiers, 'md', { ...d, options: (d.options || []).filter((o) => o.name?.trim()).map((o) => ({ id: o.id || uid('mo'), name: o.name.trim(), price: Number(o.price) || 0 })) })

// ตะกร้า → รายการออร์เดอร์ (ราคาตามปัจจุบัน + โปรโมชัน POS ที่ใช้อยู่ ณ เวลานั้น)
// บรรทัดเดียวอาจแตกเป็นหลายรายการ ถ้าชิ้นได้ส่วนลดไม่เท่ากัน (เช่น บันเดิ้ลใช้แค่ 1 ใน 3 ชิ้น) · ส่วนลดเก็บใน item.discounts (kind promo | bundle)
export function posItems(cart, at = new Date()) {
  const raws = cart.map((l) => {
    const r = db.retailItems.find((x) => x.id === l.refId)
    const mods = modsOf(l.mods)
    return { l, r, mods, price: (r?.price || 0) + mods.reduce((s, m) => s + m.price, 0) }
  })
  const res = applyPosPromos(
    raws.map((x) => ({ retailId: x.l.refId, category: x.r?.category || '', price: x.price, qty: x.l.qty })),
    { discounts: db.posDiscounts, bundles: db.posBundles, now: at },
  )
  return raws.flatMap((x, i) =>
    res.lines[i].map((seg) => {
      const it = priceItem({ id: uid('i'), kind: 'retail', retailId: x.l.refId, retailPrice: x.price, sizeId: x.r?.sizeId || null, typeId: x.r?.typeId || null, mods: x.mods, name: x.r?.name || '', qty: seg.qty, selections: {}, note: '', images: [] })
      return seg.entries.length ? { ...it, unitPrice: round2(it.unitPrice - seg.perUnit), discounts: [...(it.discounts || []), ...seg.entries] } : it
    }),
  )
}
const stockOf = (l) => db.retailItems.find((x) => x.id === l.refId)
// ขาย: สร้างบิล (ออร์เดอร์ channel 'pos') ส่งมอบทันที + ตัดสต็อก + คะแนน
export function posSale({ cart, customerId = null, couponIds = [], discount = 0, method = 'cash', received = null }) {
  const shift = currentShift()
  if (!shift || !cart.length) return null
  const ts = now()
  const o = {
    id: uid('o'), code: `POS-${String(++posNo).padStart(4, '0')}`, channel: 'pos', shiftId: shift.id, chatId: null,
    customerId, pickupAt: ts.slice(0, 16), fulfillment: 'pickup', birthday: null, address: '', shippingFee: 0,
    items: posItems(cart, new Date(ts)), adjustment: { amount: discount ? -Math.abs(Number(discount)) : 0, reason: discount ? 'ส่วนลดหน้าร้าน' : '' },
    pointsUsed: null, couponsUsed: [], loyalty: null, vat: vatNow(), status: 'payment_confirmed', payments: [], cancel: null, history: [], createdAt: ts,
  }
  db.orders.unshift(o)
  log(o, 'ขายหน้าร้าน (POS)')
  // POS ไม่ใช้คะแนนตรง ๆ แล้ว: ลูกค้าแลกคะแนนเป็นคูปองส่วนลดที่หน้าเว็บ แล้วนำมาใช้ที่นี่
  if (customerId) for (const id of couponIds) applyCoupon(o, id)
  const total = Math.max(orderTotals(o).total, 0)
  const got = method === 'cash' ? Math.max(Number(received) || 0, total) : total
  o.payments.push({ id: uid('pay'), requested: total, amount: total, method: POS_METHODS[method], posMethod: method, received: got, change: got - total, paidAt: ts.slice(0, 16), slip: '', note: '', status: 'confirmed', reportedBy: session.role, confirmedBy: session.role })
  for (const l of cart) {
    const it = stockOf(l)
    if (it && it.stock != null) it.stock = Math.max(0, it.stock - l.qty)
  }
  o.status = 'delivered'
  log(o, `รับชำระ ${money(total)} (${POS_METHODS[method]}) · ส่งมอบ`)
  awardOrder(o)
  return o
}
// ยกเลิกบิล (แอดมิน): คืนสต็อก + คืนคะแนน/คูปองที่ใช้ + ตัดคะแนนที่ได้ + คืนเงินตาม refunds (ไม่ส่ง = คืนเต็มช่องทางที่จ่ายมา)
export function voidPosSale(order, reason = 'ยกเลิกบิล', refunds = null, refundNote = '') {
  if (order.channel !== 'pos' || order.status === 'cancelled') return { error: 'บิลนี้ยกเลิกแล้ว' }
  const pay = order.payments.find((p) => p.status === 'confirmed')
  const rows = refunds || (pay ? [{ method: defaultRefundMethod(pay.posMethod), amount: pay.amount }] : [])
  const r = cancelOrder(order, { reason, refunds: rows, refundNote })
  if (r.error) return r
  for (const it of order.items) {
    const src = it.kind === 'retail' ? db.retailItems.find((x) => x.id === it.retailId) : null
    if (src && src.stock != null) src.stock += it.qty
  }
  return r
}
export const saveRetailItem = (d) =>
  upsert(db.retailItems, 'rt', {
    ...d, modifierIds: [...(d.modifierIds || [])], price: Number(d.price) || 0, stock: d.stock === '' || d.stock == null ? null : Math.max(0, Number(d.stock) || 0),
    images: [...(d.images || [])], recipe: cleanRecipe(d.recipe), pinned: !!d.pinned, showInPos: d.showInPos !== false, showOnStore: !!d.showOnStore,
    description: String(d.description ?? '').trim().slice(0, 300), typeId: d.typeId || null, flavorId: d.flavorId || null, sizeId: d.sizeId || null,
  })
// ---------- โปรโมชัน POS (เฉพาะแอดมิน) ----------
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const cleanSchedule = (x) => ({
  from: /^\d{4}-\d{2}-\d{2}$/.test(x?.from || '') ? x.from : '', to: /^\d{4}-\d{2}-\d{2}$/.test(x?.to || '') ? x.to : '',
  days: [...new Set((x?.days || []).map(Number).filter((n) => n >= 0 && n <= 6))].sort(), timeFrom: HHMM.test(x?.timeFrom || '') ? x.timeFrom : '', timeTo: HHMM.test(x?.timeTo || '') ? x.timeTo : '',
})
const ids = (a) => [...new Set(a || [])]
// คืน { error } ถ้าไม่ผ่าน · ผ่าน = { ok, item }
export function savePosDiscount(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const type = d.type === 'amount' ? 'amount' : 'percent'
  const value = Number(d.value)
  if (!String(d.name ?? '').trim()) return { error: 'กรอกชื่อโปร' }
  if (!(value > 0) || (type === 'percent' && value > 100)) return { error: type === 'percent' ? 'เปอร์เซ็นต์ต้องอยู่ระหว่าง 1–100' : 'จำนวนเงินต้องมากกว่า 0' }
  const scope = ['items', 'category', 'all', 'bill'].includes(d.scope) ? d.scope : 'items'
  if (scope === 'items' && !(d.itemIds || []).length) return { error: 'เลือกสินค้าอย่างน้อย 1 รายการ' }
  if (scope === 'category' && !(d.categories || []).length) return { error: 'เลือกหมวดอย่างน้อย 1 หมวด' }
  return { ok: true, item: upsert(db.posDiscounts, 'pd', { ...d, name: d.name.trim(), type, value, scope, itemIds: ids(d.itemIds), categories: ids(d.categories), minSpend: Math.max(0, Number(d.minSpend) || 0), schedule: cleanSchedule(d.schedule) }) }
}
export function savePosBundle(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const items = (d.items || []).filter((x) => x.itemId && Number(x.qty) >= 1).map((x) => ({ itemId: x.itemId, qty: Math.floor(Number(x.qty)) }))
  if (!String(d.name ?? '').trim()) return { error: 'กรอกชื่อบันเดิ้ล' }
  if (!items.length || items.reduce((n, x) => n + x.qty, 0) < 2) return { error: 'บันเดิ้ลต้องมีสินค้าอย่างน้อย 2 ชิ้น' }
  const price = Number(d.price)
  if (!(price >= 0) || d.price === '' || d.price == null) return { error: 'กรอกราคาชุด' }
  const regular = items.reduce((sum, x) => sum + (db.retailItems.find((r) => r.id === x.itemId)?.price || 0) * x.qty, 0)
  if (price >= regular) return { error: `ราคาชุดต้องต่ำกว่าราคาปกติรวม (${regular} บาท)` }
  return { ok: true, item: upsert(db.posBundles, 'pb', { ...d, name: d.name.trim(), items, price, schedule: cleanSchedule(d.schedule) }) }
}
export function savePointPromo(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const multiplier = Number(d.multiplier)
  if (!String(d.name ?? '').trim()) return { error: 'กรอกชื่อโปร' }
  if (!(multiplier > 1) || multiplier > 100) return { error: 'ตัวคูณต้องมากกว่า 1 (เช่น 2 = คะแนนสองเท่า)' }
  const scope = ['items', 'category', 'all'].includes(d.scope) ? d.scope : 'items'
  if (scope === 'items' && !(d.itemIds || []).length) return { error: 'เลือกสินค้าอย่างน้อย 1 รายการ' }
  if (scope === 'category' && !(d.categories || []).length) return { error: 'เลือกหมวดอย่างน้อย 1 หมวด' }
  return { ok: true, item: upsert(db.pointPromos, 'pt', { ...d, name: d.name.trim(), multiplier, scope, itemIds: ids(d.itemIds), categories: ids(d.categories), schedule: cleanSchedule(d.schedule) }) }
}
export function removePromo(list, id) {
  if (!can('manage')) return
  const a = { discount: db.posDiscounts, bundle: db.posBundles, point: db.pointPromos }[list]
  const i = a ? a.findIndex((x) => x.id === id) : -1
  if (i >= 0) a.splice(i, 1)
}
export function addStock(item, n) {
  item.stock = Math.max(0, (Number(item.stock) || 0) + (Number(n) || 0))
}

// ตัวอย่างแชท (LINE ผูกแล้ว / LINE ยังไม่ผูก / Facebook ผูกแล้ว / Facebook เกิน 24 ชม.)
function seedChats() {
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString()
  const c1 = receiveMessage('line', 'U-demo-mali', 'Mali', 'สวัสดีค่ะ อยากสั่งเค้กวันเกิดคุณแม่ 2 ปอนด์ค่ะ', ago(3))
  sendChat(c1.id, 'staff', 'ได้เลยค่ะ ต้องการรับวันไหน เวลากี่โมงคะ', { by: 'sales', at: ago(2.9) })
  const o1 = db.orders.find((o) => o.customerId === 'c1' && o.code === 'OR-0001')
  if (o1) postOrderCard(o1, c1)
  receiveMessage('line', 'U-demo-mali', 'Mali', 'ขอบคุณค่ะ เดี๋ยวโอนให้นะคะ')
  receiveMessage('line', 'U-demo-ploy', 'Ploy', 'มีเค้กหน้านิ่ม 1 ปอนด์ พรุ่งนี้ไหมคะ')
  db.customers.find((c) => c.id === 'c3').fbPsid = 'PSID-sweetco'
  receiveMessage('facebook', 'PSID-sweetco', 'Sweet Co.', 'สอบถามเค้กสำหรับงานบริษัท 5 ปอนด์ ราคาเท่าไหร่คะ', ago(1))
  const old = receiveMessage('facebook', 'PSID-old', 'Nok Nok', 'ยังรับออร์เดอร์อยู่ไหมคะ', ago(30))
  old.unreadStaff = 0
}

// ---------- หน้าร้าน: เนื้อหา + รีวิว (หลังบ้านแก้ ที่ /admin/manage/storefront) ----------
const pairs = (list, keys) =>
  (list || []).map((x) => Object.fromEntries(keys.map((k) => [k, String(x[k] ?? '').trim()]))).filter((x) => keys.some((k) => x[k]))
export function saveStorefront(d) {
  Object.assign(db.storefront, {
    heroTitle: String(d.heroTitle ?? '').trim(), heroText: String(d.heroText ?? '').trim(), heroImage: d.heroImage || '',
    about: String(d.about ?? '').trim(), address: String(d.address ?? '').trim(), mapUrl: String(d.mapUrl ?? '').trim(),
    phone: phoneDigits(d.phone), lineUrl: String(d.lineUrl ?? '').trim(), facebookUrl: String(d.facebookUrl ?? '').trim(),
    hours: pairs(d.hours, ['days', 'time']), howToOrder: pairs(d.howToOrder, ['title', 'text']),
    faq: pairs(d.faq, ['q', 'a']), policies: pairs(d.policies, ['title', 'text']),
    gallery: (d.gallery || []).filter((g) => g.image).map((g) => ({ image: g.image, caption: String(g.caption ?? '').trim() })),
  })
}
const clampRating = (v) => Math.min(5, Math.max(1, Math.round(Number(v) || 0)))
// แอดมินกรอกรีวิวเอง (อนุมัติทันที) · มี id = แก้
export function saveReview(d) {
  const name = String(d.name ?? '').trim()
  const text = String(d.text ?? '').trim()
  if (!name || !text) return null
  const data = { name: name.slice(0, 60), text: text.slice(0, 500), rating: clampRating(d.rating) }
  const cur = d.id ? db.reviews.find((x) => x.id === d.id) : null
  if (cur) return Object.assign(cur, data)
  const r = { id: uid('rv'), customerId: null, orderId: null, source: 'admin', status: 'approved', createdAt: now(), ...data }
  db.reviews.unshift(r)
  return r
}
export function setReviewStatus(id, status) {
  const r = db.reviews.find((x) => x.id === id)
  if (r && ['pending', 'approved', 'rejected'].includes(status)) r.status = status
}
export function removeReview(id) {
  const i = db.reviews.findIndex((x) => x.id === id)
  if (i >= 0) db.reviews.splice(i, 1)
}

// ---------- ระบบลูกค้า (จำลอง) ----------
// ทุกฟังก์ชันฝั่งลูกค้าอ่าน/เขียนผ่าน customerSession.customerId เท่านั้น (เลียน RLS: เห็น/แก้ได้เฉพาะของตัวเอง)
// ของจริง: ตาราง customer_accounts / otps + Edge Function + RLS (ดู docs/customer-auth.md)
export const customerSession = reactive({ customerId: null })
const liveCustomerByPhone = (phone) => db.customers.find((c) => !c.deleted && phone && phoneDigits(c.phone) === phone) || null
const accountByPhone = (phone) => db.customerAccounts.find((a) => a.phone === phone) || null
const myAccount = () => db.customerAccounts.find((a) => a.customerId === customerSession.customerId) || null
export const myCustomer = () => db.customers.find((c) => c.id === customerSession.customerId && !c.deleted) || null
export const customerLogout = () => {
  customerSession.customerId = null
}
const NEEDS_LOGIN = ['change_pin', 'change_phone', 'delete']

// ขอ OTP (จำลอง: คืน simCode ให้แสดงบนจอ · ของจริงส่ง SMS ผ่านระบบ SMS ของร้านและไม่คืนรหัส)
export function requestOtp(phoneRaw, purpose) {
  if (!OTP_PURPOSE[purpose]) return { error: 'ไม่รู้จักประเภทรหัส' }
  let phone = phoneDigits(phoneRaw)
  const me = myAccount()
  if (NEEDS_LOGIN.includes(purpose)) {
    if (!me) return { error: 'กรุณาเข้าสู่ระบบก่อน' }
    if (purpose !== 'change_phone') phone = me.phone // ส่งไปเบอร์ของบัญชีเสมอ
  }
  if (!phoneValid(phone)) return { error: 'กรอกเบอร์โทรให้ถูกต้อง' }
  if (purpose === 'register' && accountByPhone(phone)) return { error: 'เบอร์นี้สมัครแล้ว กรุณาเข้าสู่ระบบ' }
  if (purpose === 'reset' && !accountByPhone(phone)) return { error: 'ไม่พบบัญชีของเบอร์นี้' }
  if (purpose === 'change_phone') {
    if (phone === me.phone) return { error: 'เป็นเบอร์เดิมของคุณ' }
    const owner = liveCustomerByPhone(phone)
    if (accountByPhone(phone) || (owner && owner.id !== me.customerId)) return { error: 'เบอร์นี้ถูกใช้แล้ว' }
  }
  const last = db.otps.filter((o) => o.phone === phone && o.purpose === purpose).sort((a, b) => b.sentAt - a.sentAt)[0]
  if (last && Date.now() - last.sentAt < OTP.resendMs) {
    const wait = Math.ceil((OTP.resendMs - (Date.now() - last.sentAt)) / 1000)
    return { error: `ขอรหัสใหม่ได้ในอีก ${wait} วินาที`, wait }
  }
  for (let i = db.otps.length - 1; i >= 0; i--) if (db.otps[i].phone === phone && db.otps[i].purpose === purpose) db.otps.splice(i, 1)
  const o = { id: uid('otp'), phone, purpose, code: genOtp(), sentAt: Date.now(), expiresAt: Date.now() + OTP.ttlMs, attempts: 0, verifiedUntil: 0, used: false, accountId: NEEDS_LOGIN.includes(purpose) ? me.customerId : null }
  db.otps.push(o)
  return { ok: true, phone, simCode: o.code }
}
// ตรวจรหัส OTP → คืน token ไปใช้ในขั้นถัดไป (register: knownCustomer = เบอร์นี้มีลูกค้าในระบบแล้ว ไม่ต้องกรอกชื่อ)
export function verifyOtp(phoneRaw, purpose, code) {
  const me = myAccount()
  const phone = NEEDS_LOGIN.includes(purpose) && purpose !== 'change_phone' ? me?.phone : phoneDigits(phoneRaw)
  const o = db.otps.filter((x) => x.phone === phone && x.purpose === purpose && !x.used).sort((a, b) => b.sentAt - a.sentAt)[0]
  if (!o) return { error: 'ยังไม่ได้ขอรหัส กรุณาขอรหัสก่อน', expired: true }
  if (o.accountId && o.accountId !== customerSession.customerId) return { error: 'ไม่มีสิทธิ์ใช้รหัสนี้' }
  if (Date.now() > o.expiresAt) return { error: 'รหัสหมดอายุ กรุณาขอรหัสใหม่', expired: true }
  if (o.attempts >= OTP.maxTries) return { error: 'กรอกผิดเกินกำหนด กรุณาขอรหัสใหม่', expired: true }
  if (!isOtpCode(code) || !safeEqual(code, o.code)) {
    o.attempts++
    const left = OTP.maxTries - o.attempts
    return left > 0 ? { error: `รหัสไม่ถูกต้อง (เหลือ ${left} ครั้ง)` } : { error: 'กรอกผิดเกินกำหนด กรุณาขอรหัสใหม่', expired: true }
  }
  o.verifiedUntil = Date.now() + OTP.verifiedMs
  return { ok: true, token: o.id, knownCustomer: purpose === 'register' ? !!liveCustomerByPhone(phone) : undefined }
}
// token ที่ยืนยันแล้วและยังไม่หมดเวลา/ยังไม่ถูกใช้ (ผูกกับ purpose, เบอร์ และเจ้าของบัญชี)
function findVerified(token, purpose, phone = null) {
  const o = db.otps.find((x) => x.id === token && x.purpose === purpose && !x.used && x.verifiedUntil > Date.now())
  if (!o) return null
  if (phone != null && o.phone !== phone) return null
  if (o.accountId && o.accountId !== customerSession.customerId) return null
  return o
}
const NEED_OTP = { error: 'กรุณายืนยัน OTP ก่อน (รหัสอาจหมดเวลา)' }
async function makeCredential(pin) {
  const salt = randomHex()
  return { salt, pinHash: await hashPin(pin, salt) }
}
// สมัคร: เบอร์ที่มีลูกค้าอยู่แล้ว (พนักงานสร้างไว้) → ผูกกับลูกค้าเดิม · เบอร์ใหม่ → สร้างลูกค้า (ต้องมีชื่อ)
export async function registerAccount({ token, phone: phoneRaw, name = '', pin, consent = false }) {
  const phone = phoneDigits(phoneRaw)
  const o = findVerified(token, 'register', phone)
  if (!o) return NEED_OTP
  if (!consent) return { error: 'ต้องยอมรับนโยบายความเป็นส่วนตัวและเงื่อนไขการใช้งานก่อนสมัคร' }
  const weak = weakPin(pin, phone)
  if (weak) return { error: weak }
  if (accountByPhone(phone)) return { error: 'เบอร์นี้สมัครแล้ว กรุณาเข้าสู่ระบบ' }
  let cu = liveCustomerByPhone(phone)
  const linked = !!cu
  if (cu && db.customerAccounts.some((a) => a.customerId === cu.id)) return { error: 'ลูกค้านี้มีบัญชีอยู่แล้ว' }
  if (!cu) {
    const n = String(name).trim().slice(0, 100)
    if (!n) return { error: 'กรอกชื่อ' }
    cu = addCustomer({ name: n, phone, line: '', note: 'สมัครเองจากหน้าร้าน' })
    cu.promoOptIn = false
  }
  db.customerAccounts.push({ customerId: cu.id, phone, ...(await makeCredential(pin)), failed: 0, lockedUntil: 0, createdAt: now() })
  o.used = true
  addConsents(cu.id, ACCOUNT_CONSENT_KINDS, 'register')
  customerSession.customerId = cu.id
  return { ok: true, linked }
}
// เข้าสู่ระบบ: เบอร์ + PIN · ผิด 5 ครั้งล็อก 15 นาที (ข้อความผิดทั่วไปไม่บอกว่าเบอร์มีในระบบไหม)
export async function loginPin(phoneRaw, pin) {
  const phone = phoneDigits(phoneRaw)
  const bad = { error: 'เบอร์โทรหรือ PIN ไม่ถูกต้อง' }
  const a = accountByPhone(phone)
  if (!a || !isPin(pin)) return bad
  if (a.lockedUntil > Date.now()) return { error: `ลองผิดเกินกำหนด ล็อกอีก ${Math.ceil((a.lockedUntil - Date.now()) / 60e3)} นาที หรือใช้ "ลืม PIN"`, locked: true }
  if (!safeEqual(await hashPin(pin, a.salt), a.pinHash)) {
    a.failed++
    if (a.failed >= PIN.maxFails) {
      Object.assign(a, { failed: 0, lockedUntil: Date.now() + PIN.lockMs })
      return { error: `ใส่ PIN ผิดครบ ${PIN.maxFails} ครั้ง ล็อก ${PIN.lockMs / 60e3} นาที หรือใช้ "ลืม PIN"`, locked: true }
    }
    return { error: `เบอร์โทรหรือ PIN ไม่ถูกต้อง (เหลือ ${PIN.maxFails - a.failed} ครั้ง)` }
  }
  a.failed = 0
  customerSession.customerId = a.customerId
  return { ok: true }
}
// ลืม PIN (ยังไม่ล็อกอิน): ยืนยัน OTP แล้วตั้ง PIN ใหม่ ปลดล็อกบัญชี
export async function resetPin({ token, phone: phoneRaw, pin }) {
  const phone = phoneDigits(phoneRaw)
  const o = findVerified(token, 'reset', phone)
  const a = accountByPhone(phone)
  if (!o || !a) return NEED_OTP
  const weak = weakPin(pin, phone)
  if (weak) return { error: weak }
  Object.assign(a, await makeCredential(pin), { failed: 0, lockedUntil: 0 })
  o.used = true
  return { ok: true }
}
// เปลี่ยน PIN (ล็อกอินอยู่): ต้องยืนยัน OTP ก่อน
export async function changePin({ token, pin }) {
  const a = myAccount()
  const o = findVerified(token, 'change_pin', a?.phone)
  if (!a || !o) return NEED_OTP
  const weak = weakPin(pin, a.phone)
  if (weak) return { error: weak }
  Object.assign(a, await makeCredential(pin), { failed: 0, lockedUntil: 0 })
  o.used = true
  return { ok: true }
}
// เปลี่ยนเบอร์: OTP ส่งไปเบอร์ใหม่
export function changePhone({ token, phone: phoneRaw }) {
  const phone = phoneDigits(phoneRaw)
  const a = myAccount()
  const cu = myCustomer()
  const o = findVerified(token, 'change_phone', phone)
  if (!a || !cu || !o) return NEED_OTP
  const owner = liveCustomerByPhone(phone)
  if (accountByPhone(phone) || (owner && owner.id !== cu.id)) return { error: 'เบอร์นี้ถูกใช้แล้ว' }
  a.phone = phone
  cu.phone = phone
  o.used = true
  return { ok: true }
}
// ข้อมูลของฉัน (เฉพาะช่องที่ลูกค้าเห็นได้ ไม่รวมหมายเหตุของพนักงาน)
export function myProfile() {
  const c = myCustomer()
  return c ? { id: c.id, name: c.name, phone: c.phone, line: c.line || '', promoOptIn: !!c.promoOptIn, spins: c.spins || 0, points: customerPoints(c) } : null
}
// แก้ได้เฉพาะ ชื่อ / LINE ID / รับข่าว-โปร (เบอร์แก้ผ่าน changePhone ที่ต้องยืนยัน OTP)
export function updateMyProfile({ name, line, promoOptIn }) {
  const c = myCustomer()
  if (!c) return { error: 'กรุณาเข้าสู่ระบบ' }
  const n = String(name ?? c.name).trim()
  if (!n) return { error: 'กรอกชื่อ' }
  c.name = n.slice(0, 100)
  c.line = String(line ?? '').trim().slice(0, 50)
  c.promoOptIn = !!promoOptIn
  return { ok: true }
}
const reviewOfOrder = (id) => db.reviews.find((r) => r.orderId === id)
// ออร์เดอร์ของฉัน (รวมบิลหน้าร้านที่ผูกสมาชิก) · ไม่รวมประวัติภายใน/ต้นทุน/กำไร
export function myOrders() {
  const id = customerSession.customerId
  if (!id || !myCustomer()) return []
  return db.orders
    .filter((o) => o.customerId === id && o.status !== 'draft')
    .map((o) => publicOrderView(o, { owner: true }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export function myOrder(orderId) {
  const o = ctxOrder({ orderId })
  return o ? publicOrderView(o, { owner: true }) : null
}
export const myBirthdays = () => (myCustomer() ? birthdayList(customerSession.customerId).map((b) => ({ name: b.name, md: b.md })) : [])
// เขียนรีวิว: เฉพาะออร์เดอร์ของตัวเองที่ส่งมอบแล้ว 1 รีวิวต่อออร์เดอร์ → รอแอดมินอนุมัติ
export function submitReview({ orderId, rating, text }) {
  const c = myCustomer()
  const o = db.orders.find((x) => x.id === orderId && x.customerId === c?.id)
  if (!c || !o) return { error: 'ไม่พบออร์เดอร์' }
  if (o.status !== 'delivered') return { error: 'รีวิวได้หลังรับสินค้าแล้ว' }
  if (reviewOfOrder(o.id)) return { error: 'ออร์เดอร์นี้รีวิวแล้ว' }
  const t = String(text ?? '').trim()
  if (!t) return { error: 'กรอกข้อความรีวิว' }
  db.reviews.unshift({ id: uid('rv'), customerId: c.id, orderId: o.id, source: 'customer', status: 'pending', name: c.name.trim().split(/\s+/)[0].slice(0, 60), rating: clampRating(rating), text: t.slice(0, 500), createdAt: now() })
  return { ok: true }
}

export const findCustomerByPhone = (phone) => liveCustomerByPhone(phoneDigits(phone))
// POS: พนักงานสมัครสมาชิกให้ลูกค้าหน้าเคาน์เตอร์ (ชื่อ + เบอร์ ต้องยืนยันว่าลูกค้ารับทราบนโยบาย/เงื่อนไขคะแนน) · เบอร์ซ้ำ = ใช้ลูกค้าเดิม
// ไม่ได้ตั้ง PIN (ลูกค้ายังสมัครเข้าเว็บทีหลังได้ด้วยเบอร์เดิม) · รับข่าว/โปร = ปิดไว้ก่อน
export function quickMember({ name, phone, agreed }) {
  const ph = phoneDigits(phone)
  if (!phoneValid(ph)) return { error: 'กรอกเบอร์โทรให้ถูกต้อง' }
  const old = findCustomerByPhone(ph)
  if (old) return { ok: true, customer: old, existing: true }
  const n = String(name ?? '').trim().slice(0, 100)
  if (!n) return { error: 'กรอกชื่อ' }
  if (!agreed) return { error: 'ต้องยืนยันว่าลูกค้ารับทราบนโยบายความเป็นส่วนตัวและเงื่อนไขคะแนนสะสม' }
  const c = addCustomer({ name: n, phone: ph, line: '', note: 'สมัครที่หน้าร้าน (POS)' })
  c.promoOptIn = false
  addConsents(c.id, ACCOUNT_CONSENT_KINDS, 'pos')
  return { ok: true, customer: c, existing: false }
}

// ---------- ข้อความกฎหมาย + การยินยอม ----------
export const legalDoc = (kind) => db.legal.docs[kind]
// ค่าที่แทนตัวแปร {ชื่อ} ในข้อความ (ดู LEGAL_VARS ใน legalDefaults.js)
export function legalVars() {
  const c = db.legal.contact
  const l = db.loyalty
  return {
    ชื่อร้าน: db.shop.name, ผู้ควบคุมข้อมูล: c.controller, ที่อยู่: c.address, อีเมลติดต่อ: c.email, เบอร์ติดต่อ: phoneDigits(c.phone) ? formatPhone(c.phone) : '',
    ระยะเก็บบัญชี: c.retentionAccount, ระยะเก็บบัญชีภาษี: c.retentionAccounting, ระยะเก็บแชท: c.retentionChat,
    อัตราสะสม: l.earnPer, มูลค่าคะแนน: l.pointValue, อายุคะแนน: l.pointExpireDays, อายุคูปอง: l.couponExpireDays,
  }
}
// แก้ข้อความ (แอดมิน) · bump = ขึ้นเวอร์ชัน → ลูกค้าที่ล็อกอินอยู่ต้องกดยอมรับใหม่ · ไม่ bump = แก้คำผิดเฉพาะข้อความ
export function saveLegal(kind, { title, text, bump = true }) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const d = db.legal.docs[kind]
  if (!d) return { error: 'ไม่พบเอกสาร' }
  const t = String(text ?? '').trim()
  if (!t) return { error: 'ข้อความต้องไม่ว่าง' }
  const changed = t !== d.text
  Object.assign(d, { title: String(title ?? d.title).trim() || d.title, text: t })
  if (changed && bump) Object.assign(d, { version: d.version + 1, updatedAt: now() })
  else if (changed) d.updatedAt = now()
  return { ok: true, version: d.version }
}
export function saveLegalContact(c) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const n = (v, def) => (Number(v) >= 0 && v !== '' && v != null ? Number(v) : def)
  const cur = db.legal.contact
  Object.assign(cur, {
    controller: String(c.controller ?? '').trim(), address: String(c.address ?? '').trim(), email: String(c.email ?? '').trim(), phone: phoneDigits(c.phone),
    retentionAccount: n(c.retentionAccount, cur.retentionAccount), retentionAccounting: n(c.retentionAccounting, cur.retentionAccounting), retentionChat: n(c.retentionChat, cur.retentionChat),
  })
  return { ok: true }
}
function addConsents(customerId, kinds, via) {
  for (const kind of kinds) {
    const version = db.legal.docs[kind].version
    if (db.consents.some((x) => x.customerId === customerId && x.kind === kind && x.version === version)) continue
    db.consents.push({ id: uid('cs'), customerId, kind, version, detail: null, at: now(), via })
  }
}
// คุกกี้: บันทึกหลักฐานการเลือก (ไม่ระบุตัวตน) · ค่าจริงเก็บใน localStorage ของลูกค้า (lib/consent.js)
export function recordCookieConsent({ analytics = false, marketing = false } = {}) {
  const version = db.legal.docs.cookie.version
  db.consents.push({ id: uid('cs'), customerId: null, kind: 'cookie', version, detail: { analytics: !!analytics, marketing: !!marketing }, at: now(), via: 'banner' })
  return version
}
// เวอร์ชันล่าสุดที่ลูกค้ายอมรับ (0 = ยังไม่เคย)
const consentedVersion = (customerId, kind) => db.consents.filter((x) => x.customerId === customerId && x.kind === kind).reduce((m, x) => Math.max(m, x.version), 0)
// เอกสารที่ลูกค้าต้องยอมรับ (ยังไม่เคย หรือเวอร์ชันใหม่กว่า) · คืน [] = ใช้บัญชีได้
export function needsConsent(customerId = customerSession.customerId) {
  if (!customerId) return []
  return ACCOUNT_CONSENT_KINDS.filter((k) => consentedVersion(customerId, k) < db.legal.docs[k].version)
}
// ลูกค้าที่ล็อกอินอยู่กดยอมรับเวอร์ชันปัจจุบัน
export function acceptConsent(via = 'reconsent') {
  const id = customerSession.customerId
  if (!id || !myCustomer()) return { error: 'กรุณาเข้าสู่ระบบ' }
  addConsents(id, ACCOUNT_CONSENT_KINDS, via)
  return { ok: true }
}
// สถิติหน้าแอดมิน: บัญชีที่ยอมรับเวอร์ชันปัจจุบัน / ทั้งหมด
export function consentStats(kind) {
  const v = db.legal.docs[kind].version
  if (kind === 'cookie') return { accepted: db.consents.filter((x) => x.kind === 'cookie' && x.version === v).length, total: null }
  return { accepted: db.customerAccounts.filter((a) => consentedVersion(a.customerId, kind) >= v).length, total: db.customerAccounts.length }
}

// ---------- คำขอลบข้อมูล ----------
// ลูกค้าส่งคำขอ (ต้องยืนยัน OTP) → แอดมินอนุมัติ/ปฏิเสธ · อนุมัติ = ลบตัวตน เก็บออร์เดอร์/การชำระแบบนิรนาม
export const myDeletionRequest = () => db.deletionRequests.find((r) => r.customerId === customerSession.customerId && r.status === 'pending') || db.deletionRequests.filter((r) => r.customerId === customerSession.customerId)[0] || null
export function requestDeletion({ token, note = '' }) {
  const a = myAccount()
  const o = findVerified(token, 'delete', a?.phone)
  if (!a || !o) return NEED_OTP
  if (db.deletionRequests.some((r) => r.customerId === a.customerId && r.status === 'pending')) return { error: 'มีคำขอที่รอตรวจสอบอยู่แล้ว' }
  db.deletionRequests.unshift({ id: uid('dr'), customerId: a.customerId, status: 'pending', customerNote: String(note).trim().slice(0, 300), reason: '', createdAt: now(), decidedAt: null, decidedBy: '' })
  o.used = true
  return { ok: true }
}
// สิ่งที่ทำให้ยังอนุมัติลบไม่ได้: ออร์เดอร์ที่ยังไม่จบ / ยอดค้างชำระ
export function deletionBlockers(customerId) {
  const mine = db.orders.filter((o) => o.customerId === customerId && o.status !== 'cancelled')
  const out = []
  const open = mine.filter((o) => o.status !== 'delivered')
  if (open.length) out.push(`มีออร์เดอร์ที่ยังไม่จบ ${open.length} รายการ (${open.map((o) => o.code).join(', ')})`)
  const owing = mine.filter((o) => orderTotals(o).balance > 0)
  if (owing.length) out.push(`มียอดค้างชำระ ${owing.length} ออร์เดอร์ (${owing.map((o) => o.code).join(', ')})`)
  return out
}
export const pendingDeletions = () => db.deletionRequests.filter((r) => r.status === 'pending').length
// ลบตัวตน: ข้อมูลส่วนตัว บัญชี/PIN แชท ใบเสนอ คะแนน/คูปอง รีวิว คิวข้อความ และรายละเอียดส่วนตัวในออร์เดอร์
// เก็บ: ออร์เดอร์ รายการ ยอดเงินและการชำระ (ตัดชื่อ/ที่อยู่/วันเกิด/รูป/สลิป/ข้อความบนเค้ก) ผูกกับ "ลูกค้าที่ลบแล้ว"
function scrubCustomer(id) {
  const cu = findCustomer(id)
  const orderIds = new Set(db.orders.filter((o) => o.customerId === id).map((o) => o.id))
  const addrs = new Set([cu.phone, cu.lineUserId, cu.fbPsid].filter(Boolean))
  cu.places = []
  const chatIds = new Set(db.chats.filter((c) => c.customerId === id).map((c) => c.id))
  const textGroups = new Set(db.optionGroups.filter((g) => g.type === 'text').map((g) => g.id))
  for (const o of db.orders) {
    if (o.customerId !== id) continue
    Object.assign(o, { birthday: null, address: '', chatId: null, placeName: '', mapUrl: '', detail: '' })
    for (const it of o.items) {
      it.note = ''
      it.images = []
      for (const k of Object.keys(it.selections || {})) if (textGroups.has(k)) delete it.selections[k]
      for (const t of it.tiers || []) for (const k of Object.keys(t.selections || {})) if (textGroups.has(k)) delete t.selections[k]
    }
    for (const p of o.payments) Object.assign(p, { slip: '', note: '' })
    if (o.cancel) o.cancel.refundNote = ''
  }
  db.orderLinks = db.orderLinks.filter((l) => !orderIds.has(l.orderId)) // ลิงก์ออร์เดอร์ของลูกค้านี้ใช้ไม่ได้อีก
  for (let i = db.chats.length - 1; i >= 0; i--) if (chatIds.has(db.chats[i].id)) db.chats.splice(i, 1)
  for (const k of chatIds) delete db.chatDrafts[k]
  for (let i = db.quotes.length - 1; i >= 0; i--) if (chatIds.has(db.quotes[i].chatId)) db.quotes.splice(i, 1)
  for (let i = db.coupons.length - 1; i >= 0; i--) if (db.coupons[i].customerId === id) db.coupons.splice(i, 1)
  for (let i = db.reviews.length - 1; i >= 0; i--) if (db.reviews[i].customerId === id) db.reviews.splice(i, 1)
  for (let i = db.outbox.length - 1; i >= 0; i--) if (orderIds.has(db.outbox[i].orderId) || addrs.has(db.outbox[i].to)) db.outbox.splice(i, 1)
  db.birthdayGreeted = db.birthdayGreeted.filter((k) => !k.startsWith(`${id}|`))
  db.notifySent = db.notifySent.filter((k) => !k.includes(`|${id}|`))
  db.customerAccounts = db.customerAccounts.filter((a) => a.customerId !== id)
  // OTP: ลบของเจ้าของบัญชีนี้ + ที่ใช้แล้ว/หมดอายุทั้งหมด (กันเบอร์เก่าตกค้างหลังเปลี่ยนเบอร์)
  db.otps = db.otps.filter((o) => !addrs.has(o.phone) && o.accountId !== id && !o.used && o.expiresAt > Date.now())
  Object.assign(cu, { name: 'ลูกค้าที่ลบแล้ว', phone: '', line: '', note: '', lineUserId: '', fbPsid: '', promoOptIn: false, active: false, deleted: true, deletedAt: now(), ledger: [], spins: 0 })
  if (customerSession.customerId === id) customerSession.customerId = null
}
export function approveDeletion(requestId) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const r = db.deletionRequests.find((x) => x.id === requestId)
  if (!r || r.status !== 'pending') return { error: 'คำขอนี้ดำเนินการแล้ว' }
  const blockers = deletionBlockers(r.customerId)
  if (blockers.length) return { error: blockers.join(' · '), blockers }
  scrubCustomer(r.customerId)
  Object.assign(r, { status: 'approved', decidedAt: now(), decidedBy: session.role })
  return { ok: true }
}
export function rejectDeletion(requestId, reason) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const r = db.deletionRequests.find((x) => x.id === requestId)
  if (!r || r.status !== 'pending') return { error: 'คำขอนี้ดำเนินการแล้ว' }
  if (!String(reason ?? '').trim()) return { error: 'ใส่เหตุผลที่ปฏิเสธ' }
  Object.assign(r, { status: 'rejected', reason: String(reason).trim().slice(0, 300), decidedAt: now(), decidedBy: session.role })
  return { ok: true }
}

// ข้อมูลตัวอย่าง (เรียกท้ายไฟล์ หลังประกาศฟังก์ชันทั้งหมด)
seed()
seedChats()
