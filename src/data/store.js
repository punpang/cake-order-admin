// ข้อมูลตัวอย่าง (เก็บในหน่วยความจำ รีเฟรชแล้วหาย)
// ขั้นต่อไปจะเปลี่ยนฟังก์ชันในไฟล์นี้ให้เรียก Supabase แทน
import { reactive } from 'vue'
import { BELL_MAX, BELL_STAFF, BELL_CUSTOMER, bellText, visibleToStaff, visibleToCustomer, unreadStaff, unreadCustomer, isReadStaff } from '../lib/bell'
import { ensureStyleGroup, STATUS, PERMISSIONS, ALL_PERMS, rolePreset, CHANNELS, CUSTOMER_CHANNEL_ORDER, NOTIFY_EVENTS, POS_METHODS } from '../lib/constants'
import { activeLists, priceDetail, orderTotals, itemNets, describeSelections } from '../lib/pricing'
import { orderCardMsg, quoteCardMsg, linkCardMsg, payCard, viewCard } from '../lib/chatCards'
import { applyPosPromos, pointMultiplier, round2, blankSchedule } from '../lib/posPromo'
import { prevStatus } from '../lib/orderFlow'
import { REFUND_METHODS, normalizeRefunds, refundErrors, defaultRefundMethod, refundList, returnedByMethod } from '../lib/refund'
import { addDays, pointBalance, takePoints, returnPoints, couponUsable, couponPhase, pickPrize, expiringSoon } from '../lib/loyalty'
import { pad, toDateStr, money, phoneDigits, phoneValid, formatPhone, dateOnly, timeOnly } from '../lib/format'
import { showToast } from '../lib/toast'
import { nextBirthday, daysBetween } from '../lib/birthday'
import { parseAnswer } from '../lib/chatParse'
import { LEGAL_KINDS, ACCOUNT_CONSENT_KINDS, DEFAULT_PRIVACY, DEFAULT_TERMS, DEFAULT_COOKIE, DEFAULT_LEGAL_CONTACT } from '../lib/legalDefaults'
import { BOT_DEFAULTS, botReply, scrubPII, similarity, isSensitive, LEARN_MAX, AUTO_SOURCES, LOCKED_SOURCES } from '../lib/chatBot'
import { checkTelegram } from '../lib/integrationCheck'
import { genToken, isTokenShape, hashToken, genCode, isCodeShape, cleanPolicy, cleanAllowlist, checkTarget, linkAlive, linkExpiresAt, failBlocked, DEFAULT_LINK_POLICY, LINK_ERROR } from '../lib/orderLink'
import { digitsOf, promptPayKind } from '../lib/promptpay'
import { DEFAULT_ACCOUNTS } from '../lib/acct/chart'
import { cleanClosures, emptyClosures, slotClosed, pickupClosed, isClosedNow, nextOpen } from '../lib/shopHours'
import { decodeCake, findCodes, CODE_RE } from '../lib/cakeCode'
import { deliveryFee, cleanDelivery, cleanDeliveryConfig, rememberPlace, DEFAULT_DELIVERY } from '../lib/delivery'
import { dueState, overduePayments, orderDue, quickDue, isHHmm, remainingText } from '../lib/payDue'
import { supabaseEnabled, getSupabase } from '../lib/supabase'
import { sendClick } from '../lib/clicksSync'
import { createNumbering } from '../lib/docNo'
import { staffState } from '../lib/staffAuth'
import { remoteOrderAction } from '../lib/customerOrderRemote'
import { callAuth, callLoyalty, readSessionToken, saveSessionToken, clearSessionToken, injectBundle, clearBundle } from '../lib/customerRemote'
import { OTP, PIN, OTP_PURPOSE, isPin, isOtpCode, weakPin, randomHex, hashPin, safeEqual, genOtp } from '../lib/customerAuth'

let seq = 1000
// โหมด Supabase: ไอดีต้องไม่ซ้ำข้ามเซสชัน (ตัวนับเริ่มใหม่ทุกครั้งที่โหลดหน้า จะชนกับแถวที่เก็บไว้แล้วและเขียนทับ)
const uid = (p) => (supabaseEnabled ? `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` : `${p}${++seq}`)
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
  if (supabaseEnabled) return staffState.staff?.perms || [] // โหมด Supabase: สิทธิ์จริงจาก punpang_staff
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
  if (can('viewDeliveryOrders') && o.fulfillment === 'delivery' && ['preparing', 'prepared', 'ready_to_ship', 'shipping', 'delivered'].includes(o.status)) return true
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
// ข้อความ "ได้รับชำระ": ยอดที่ชำระครั้งนี้ · ยอดรวม · ชำระแล้ว · คงค้าง · นัดส่งมอบ · ลิงก์ดูออร์เดอร์ (กฎเดิมที่ยังเป็นข้อความเริ่มต้นเก่าจะถูกใช้ข้อความนี้แทนอัตโนมัติ — กฎที่ร้านแก้เองไม่แตะ)
const PAY_CONFIRMED_OLD = 'ได้รับชำระออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณค่ะ คงค้าง {คงค้าง}'
const PAY_CONFIRMED_TPL = 'ได้รับชำระ {ยอดที่ชำระ} ออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณค่ะ\nยอดรวม {ยอดรวม} · ชำระแล้ว {ชำระแล้ว} · คงค้าง {คงค้าง}\nนัด{ส่งมอบ} {วันนัด} {เวลานัด}\nดูออร์เดอร์: {ลิงก์ออร์เดอร์}'
// เตรียมสินค้าเสร็จ: รับที่ร้านได้ทันที แต่ต้องไม่เกินเวลาปิดร้าน (บรรทัดท้ายใส่เฉพาะรับที่ร้าน ส่วนจัดส่งว่าง)
const PREPARED_OLD = 'ออร์เดอร์ {เลขออร์เดอร์} เตรียมสินค้าเสร็จแล้วค่ะ นัด{ส่งมอบ} {วันนัด} {เวลานัด}'
const PREPARED_TPL = 'ออร์เดอร์ {เลขออร์เดอร์} เตรียมสินค้าเสร็จแล้วค่ะ นัด{ส่งมอบ} {วันนัด} {เวลานัด}\n{ข้อความรับสินค้า}'
// ส่งมอบแล้ว: ขอบคุณ + (ถ้ามีรูปงาน) ขออนุญาตใช้ภาพสินค้า หากไม่ยินยอมแจ้งได้ + ลิงก์ดูออร์เดอร์ (ปุ่มบนการ์ด)
const DELIVERED_OLD = 'ส่งมอบออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณที่อุดหนุนค่ะ'
const DELIVERED_TPL = 'ส่งมอบออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณที่อุดหนุนค่ะ\n{ข้อความขอใช้ภาพ}\nดูออร์เดอร์: {ลิงก์ออร์เดอร์}'
// เตือนชำระ: ครั้งเดียวตอน 9 โมงเช้า ของออร์เดอร์พรุ่งนี้ที่แจ้งชำระแล้วแต่ยังไม่ชำระเลย (ยกเว้นยืนยันโดยไม่ชำระ) · ข้อความตามที่ร้านกำหนด + ลิงก์ดูออร์เดอร์
const PAY_REMINDER_OLD = 'พรุ่งนี้มีนัดออร์เดอร์ {เลขออร์เดอร์} ({วันนัด} {เวลานัด}) ยังไม่ได้ชำระ คงค้าง {คงค้าง} ชำระก่อน {ชำระก่อน} ชำระที่ {ลิงก์ออร์เดอร์}'
const PAY_REMINDER_TPL = 'โปรดชำระเงินก่อน {ชำระก่อน} เพื่อยืนยันการสั่งซื้อ {เลขออร์เดอร์} {วันนัด} {เวลานัด} เพื่อยืนยันการสั่งซื้อ หากชำระแล้ว ต้องขออภัย และสามารถแจ้งเพื่อตรวจสอบอีกครั้ง ขอบคุณค่ะ\nดูออร์เดอร์: {ลิงก์ออร์เดอร์}'
const DEFAULT_UPGRADES = { payment_confirmed: [PAY_CONFIRMED_OLD, PAY_CONFIRMED_TPL], prepared: [PREPARED_OLD, PREPARED_TPL], delivered: [DELIVERED_OLD, DELIVERED_TPL], payment_reminder: [PAY_REMINDER_OLD, PAY_REMINDER_TPL] }
const tplOf = (r) => { const u = DEFAULT_UPGRADES[r.event]; return u && String(r.template || '').trim() === u[0] ? u[1] : r.template }

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
    vat: { enabled: false, rate: 7, mode: 'inclusive', taxId: '', legalName: '', address: '', branch: '00000' },
    // ลิงก์ออร์เดอร์: หมดอายุ = เปิดล่าสุด + idleDays (เลื่อนทุกครั้งที่เปิด) · ไม่เคยเปิด = สร้าง + neverOpenedDays · linkAllowlist = โฮสต์ภายนอกที่ลิงก์ย่อชี้ไปได้ (https)
    linkPolicy: { ...DEFAULT_LINK_POLICY }, linkAllowlist: ['lin.ee', 'line.me', 'facebook.com', 'fb.me', 'maps.app.goo.gl', 'maps.google.com'] },
  // เตือนวันเกิด: key ที่กด "ทักแล้ว" (ลูกค้า|ชื่อ|MM-DD|ปี)
  birthdayGreeted: [],

  // ---------- คะแนนสะสม / แลกของ / กาชา ----------
  // earnPer = ทุกกี่บาทได้ 1 คะแนน, pointValue = 1 คะแนนลดได้กี่บาท, spinCost = คะแนนต่อการหมุน 1 ครั้ง, spinPer = ทุกกี่บาทได้สิทธิ์หมุน 1 ครั้ง
  loyalty: { earnPer: 100, pointValue: 1, pointExpireDays: 365, couponExpireDays: 30, spinCost: 50, spinPer: 500, activationMin: 15 },
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
  // คลังรูปเค้กสั่งทำ (หน้าเว็บ): รูปติดแท็กตัวเลือก (optionId) ใช้เลือกรูปตามที่ลูกค้าเลือก · { id, image, tags[], caption, active }
  cakeGallery: [],
  // การคลิกดูแบบเค้กสั่งทำ (นิรนาม ใช้แนะนำแบบ): { v: รหัสผู้เยี่ยมชม, photoId, at }
  cakeClicks: [],
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

  // ระบบบัญชี: บันทึกเอง (entries) · รายการดึงอัตโนมัติที่ปิดงวดแล้วแช่แข็ง (frozen) · closedThrough = ปิดงวดถึงวันที่ (YYYY-MM-DD)
  acct: { settings: { entityType: 'juristic', fiscalYearStartMonth: 1, assetMinCost: 500, paidInCapital: 0, taxDeprRates: { building: 5, equipment: 20, furniture: 20, vehicle: 20, computer: 33.33, other: 20 } }, accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })), entries: [], frozen: [], closedThrough: '', seq: {}, taxInvoices: [], vatFilings: {}, recurring: [], recurringSkips: [], deferrals: [], assets: [], installments: [], taxYears: {}, taxTables: {}, taxFilings: {} },
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
    { id: 'g_shape', key: 'shape', name: 'รูปทรง', perTier: true, type: 'single', required: true, appliesTo: ['custom'], options: [
      fix('sh1', 'กลม'), fix('sh2', 'สี่เหลี่ยม'), fix('sh3', 'หัวใจ', 100), fix('sh4', 'ตัวเลข/ตัวอักษร', 200),
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
    { id: 'g_allergy', name: 'แพ้อาหาร (ระบุ)', type: 'text', sensitive: true, required: false, appliesTo: ['custom', 'ready'], placeholder: 'ถ้ามี' },
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
    rule('payment_reminder', ['line', 'facebook', 'sms'], PAY_REMINDER_TPL),
    rule('prepared', ['line', 'facebook', 'sms'], PREPARED_TPL),
    rule('payment_confirmed', ['line', 'facebook', 'sms'], PAY_CONFIRMED_TPL),
    rule('pickup_reminder', ['line', 'facebook', 'sms'], 'เตือนนัด{ส่งมอบ}ออร์เดอร์ {เลขออร์เดอร์} วันที่ {วันนัด} เวลา {เวลานัด}'),
    rule('shipping', ['line', 'facebook', 'sms'], 'ออร์เดอร์ {เลขออร์เดอร์} ออกจัดส่งแล้วค่ะ กำหนดถึง {วันนัด} {เวลานัด}'),
    rule('delivered', ['line', 'facebook'], DELIVERED_TPL),
    rule('cancelled', ['line', 'facebook', 'sms'], 'ออร์เดอร์ {เลขออร์เดอร์} ถูกยกเลิกแล้ว หากมีข้อสงสัยติดต่อร้านได้เลยค่ะ'),
    rule('order_refund_cancelled', ['line', 'facebook', 'sms'], 'ร้านยกเลิกการคืนเงินออร์เดอร์ {เลขออร์เดอร์} จำนวน {ยอดที่แจ้ง} (ปรับรายการแล้ว) หากสงสัยติดต่อร้านได้เลยค่ะ'),
    rule('order_refunded', ['line', 'facebook', 'sms'], 'ร้านคืนเงินออร์เดอร์ {เลขออร์เดอร์} จำนวน {ยอดที่แจ้ง} แล้วค่ะ'),
    rule('birthday', ['line', 'facebook'], 'สุขสันต์วันเกิดล่วงหน้า {ชื่อวันเกิด} สั่งเค้กกับเราได้เลยค่ะ'),
    rule('points_expiring', ['line', 'facebook'], '{ชื่อลูกค้า} มี {คะแนน} คะแนนใกล้หมดอายุ ใช้ก่อนหมดนะคะ'),
    rule('team_new_order', ['telegram'], '[ออร์เดอร์ใหม่] {เลขออร์เดอร์} {ชื่อลูกค้า} {ยอดรวม} นัด {วันนัด} {เวลานัด}'),
    rule('team_payment_confirmed', ['telegram'], '[ชำระแล้ว] {เลขออร์เดอร์} คงค้าง {คงค้าง}'),
    rule('team_due_soon', ['telegram'], '[ใกล้เวลา] {เลขออร์เดอร์} ต้องเสร็จภายใน 2 ชม. (นัด {เวลานัด})'),
    rule('team_cancelled', ['telegram'], '[ยกเลิก] {เลขออร์เดอร์} {ชื่อลูกค้า}'),
    rule('team_approval_request', ['telegram'], '[ขออนุมัติ] {เลขออร์เดอร์} {ชื่อลูกค้า} ยืนยันสั่งซื้อแบบยังไม่ชำระ คงค้าง {คงค้าง}'),
    rule('team_pay_overdue', ['telegram'], '[เกินกำหนดชำระ] {เลขออร์เดอร์} {ชื่อลูกค้า} ต้องชำระก่อน {ชำระก่อน} คงค้าง {คงค้าง}'),
    rule('team_customer_paid', ['telegram'], '[ลูกค้าแจ้งโอน] {เลขออร์เดอร์} {ชื่อลูกค้า} {ยอดที่แจ้ง} รอตรวจสลิป'),
    rule('team_expense_missing', ['telegram'], '[ค่าใช้จ่ายประจำ] {รายการ} เดือน {เดือนภาษี} ยังไม่ได้บันทึก (ครบกำหนด {วันที่})'),
    rule('team_installment_due', ['telegram'], '[ผ่อนชำระ] {รายการ} งวดที่ {งวด} ครบกำหนด {วันที่} ยอด {ยอดรวม}'),
    rule('team_vat_due', ['telegram'], '[ภ.พ.30] เดือนภาษี {เดือนภาษี} ครบกำหนดยื่น {ชำระก่อน} ยังไม่ได้บันทึกว่ายื่นแล้ว'),
    rule('photo_ready', ['line', 'facebook', 'sms'], 'ออร์เดอร์ {เลขออร์เดอร์} มีรูปงานเสร็จให้ดูแล้วค่ะ ดูได้ที่ {ลิงก์ออร์เดอร์}'),
    rule('photo_optout_done', ['line', 'facebook', 'sms'], 'ร้านลบรูปงานของออร์เดอร์ {เลขออร์เดอร์} ออกจากทุกที่ตามที่แจ้งแล้วค่ะ'),
    rule('photo_optout_rejected', ['line', 'facebook', 'sms'], 'ร้านขอคุยเรื่องการใช้รูปงานของออร์เดอร์ {เลขออร์เดอร์} เพิ่มเติม รายละเอียดดูที่ {ลิงก์ออร์เดอร์}'),
    rule('team_coupon_shown', ['telegram'], '[ลูกค้าแสดงคูปอง] {ชื่อลูกค้า} {รายการ} (ภายใน {นาที} นาที)'),
    rule('coupon_refunded', ['line', 'facebook', 'sms'], '{ชื่อลูกค้า} ร้านคืน {คะแนน} คะแนนจาก {รายการ} ให้แล้วค่ะ'),
    rule('team_photo_optout', ['telegram'], '[ขอไม่เผยแพร่รูป] {เลขออร์เดอร์} {ชื่อลูกค้า} รอร้านตรวจสอบ'),
    rule('team_pay_extend_request', ['telegram'], '[ขอขยายเวลาชำระ] {เลขออร์เดอร์} {ชื่อลูกค้า} เดิมกำหนด {ชำระก่อน}'),
  ],
  // คิวข้อความ (จำลอง) ล่าสุดอยู่หน้า · notifySent = key ที่ส่งแล้ว (กันส่งซ้ำของเหตุการณ์ตามเวลา)
  outbox: [],
  // กระดิ่งแจ้งเตือนในแอป (แยกจาก outbox) ล่าสุดอยู่หน้า ≤ BELL_MAX · staff: readBy = userId ที่อ่านแล้ว · customer: read
  bell: [],
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
  // ดีล (kind): bogo ซื้อ X แถม Y · nth ชิ้นที่ N ลด % · spend_off ครบ X ลด (ขั้นบันได) · spend_free ครบ X ฟรีสินค้า · spend_addon ครบ X ซื้อสินค้าราคาพิเศษ · free_ship ส่งฟรีเมื่อครบ X
  // ใช้ได้ทั้ง POS และออร์เดอร์ (สินค้าสำเร็จ + ยอดทั้งบิล) · lib/posPromo.js applyPosPromos
  posDeals: [
    { id: 'dl1', kind: 'bogo', name: 'ซื้อคัพเค้ก 3 แถม 1 (ตัวอย่าง)', active: false, schedule: blankSchedule(), scope: 'category', categories: ['คัพเค้ก'], itemIds: [], buyQty: 3, giftItemId: '', giftQty: 1, repeat: true, maxGifts: 0 },
    { id: 'dl2', kind: 'spend_off', name: 'ครบ 500 ลด 50 · ครบ 1,000 ลด 150 (ตัวอย่าง)', active: false, schedule: blankSchedule(), tiers: [{ min: 500, type: 'amount', value: 50 }, { min: 1000, type: 'amount', value: 150 }] },
    { id: 'dl3', kind: 'spend_free', name: 'ครบ 800 ฟรีเทียนวันเกิด (ตัวอย่าง)', active: false, schedule: blankSchedule(), min: 800, giftItemId: 'rt7', giftQty: 1 },
  ],
  // โปรคะแนนพิเศษ: multiplier = ตัวคูณคะแนนของยอดสินค้านั้น (หลายโปรซ้อน = ใช้ตัวสูงสุด)
  pointPromos: [
    { id: 'pt1', name: 'คะแนน x2 เค้กสำเร็จ (ตัวอย่าง)', multiplier: 2, scope: 'category', categories: ['เค้กสำเร็จ'], itemIds: [], active: false, schedule: blankSchedule() },
  ],

  // ---------- หน้าร้าน (สาธารณะ) · เนื้อหาตัวอย่าง แก้ได้ที่ /admin/settings/storefront ----------
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

  // ---------- ข้อความกฎหมาย (ร่าง แก้ได้ที่ /admin/settings/legal) + บันทึกการยินยอม ----------
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
  // คำขอ "ไม่ให้ใช้รูปงานเผยแพร่" ของลูกค้า (ร้านอนุมัติก่อนลบ) { id, orderId, customerId, status: pending|approved|rejected|cancelled, note, createdAt, decidedAt, decidedBy, decisionNote }
  photoRequests: [],

  orders: [],
})

// ทุกรายการเริ่มต้นเป็น "ใช้งาน" + สมุดคะแนน / สิทธิ์หมุน
for (const o of db.optionGroups.find((g) => g.key === 'type')?.options || []) o.images = o.images || []
for (const r of db.retailItems) Object.assign(r, { modifierIds: r.modifierIds || [], images: r.images || [], recipe: r.recipe || [], pinned: !!r.pinned, showInPos: r.showInPos ?? true, showOnStore: r.showOnStore ?? false, description: r.description || '', typeId: r.typeId || null, flavorId: r.flavorId || null, sizeId: r.sizeId || null })
for (const u of db.users) u.perms = rolePreset(u.role) // ผู้ใช้ตัวอย่างเริ่มด้วยสิทธิ์ตามบทบาท
for (const c of db.customers) Object.assign(c, { active: true, ledger: [], spins: 0, lineUserId: '', fbPsid: '', promoOptIn: true, places: [] })
// ตัวอย่าง: ลูกค้าคนแรกผูก LINE แล้ว (จำลอง)
db.customers[0].lineUserId = 'U-demo-mali'
ensureStyleGroup(db.optionGroups)
for (const g of db.optionGroups) g.active = true

// ---------- ฟังก์ชัน ----------
// เลขที่เอกสาร: OR-ddmmyy-xxxxxx / POS-ddmmyy-xxxxx / QT-ddmmyy-xxxxx / PAY-ddmmyy-xxxxx (รันใหม่ทุกวัน) — ดู lib/docNo.js
export const numbering = createNumbering()
const nextCode = () => numbering.next('OR')

export const findOrder = (id) => db.orders.find((o) => o.id === id)
export const findCustomer = (id) => db.customers.find((c) => c.id === id)

// เบอร์ห้ามซ้ำในลูกค้าที่ยังใช้งาน (เทียบเฉพาะตัวเลข) · คืนลูกค้าที่ใช้เบอร์นี้อยู่ ถ้ามี
export const phoneOwner = (phone, exceptId = null) => {
  const p = phoneDigits(phone)
  return p ? db.customers.find((c) => !c.deleted && c.id !== exceptId && phoneDigits(c.phone) === p) || null : null
}
const dupPhoneError = (cu) => ({ error: `เบอร์นี้เป็นของลูกค้า "${cu.name}" แล้ว` })

export function addCustomer(data) {
  const dup = phoneOwner(data.phone)
  if (dup) return dupPhoneError(dup)
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

// ข้อมูลออกใบกำกับภาษีของลูกค้า (ไม่บังคับ · เก็บเท่าที่กรอก ตรวจเลขภาษีตอนออกใบ)
const cleanTax = (t) => ({
  name: String(t?.name ?? '').trim().slice(0, 120), taxId: String(t?.taxId ?? '').replace(/\D/g, '').slice(0, 13),
  branch: String(t?.branch ?? '00000').replace(/\D/g, '').slice(0, 5) || '00000', address: String(t?.address ?? '').trim().slice(0, 300),
})
export function saveCustomer(d) {
  // ตรวจเบอร์ซ้ำเฉพาะตอนสร้างใหม่ หรือเปลี่ยนเบอร์ (ข้อมูลเดิมที่ซ้ำอยู่แล้วไม่ทำให้การแก้ส่วนอื่นพัง)
  const cur = d.id ? db.customers.find((x) => x.id === d.id) : null
  if (!cur || phoneDigits(cur.phone) !== phoneDigits(d.phone)) {
    const dup = phoneOwner(d.phone, d.id || null)
    if (dup) return dupPhoneError(dup)
  }
  const { places, ...rest } = d // สถานที่จัดการผ่าน savePlace/removePlace เท่านั้น (กันฟอร์มเก่าเขียนทับ)
  const tax = d.tax === undefined ? {} : { tax: cleanTax(d.tax) }
  const c = upsert(db.customers, 'c', { ...rest, ...tax, phone: phoneDigits(d.phone) })
  if (!c.ledger) Object.assign(c, { ledger: [], spins: 0 })
  if (!c.places) c.places = []
  return c
}
// ตารางราคา { [k]: { [sizeId]: ราคา } } ตัดช่องว่าง
const cleanTable = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, cleanSpecial(v)]))
export const savePriceList = (d) => upsert(db.priceLists, 'pl', { ...d, types: cleanSpecial(d.types), typeSizes: cleanTable(d.typeSizes), flavors: cleanSpecial(d.flavors), styles: cleanSpecial(d.styles), shapes: cleanSpecial(d.shapes), flavorSizes: cleanTable(d.flavorSizes), styleSizes: cleanTable(d.styleSizes), shapeSizes: cleanTable(d.shapeSizes) })
// ตารางราคาเค้กหลัก (หน้าการกำหนดราคา): types = { [typeId] }, typeSizes = { [typeId]: { [sizeId] } }, flavors = { [flavorId] }
export function saveMainPrices({ types = {}, typeSizes = {}, flavors = {}, styles = {}, shapes = {}, flavorSizes = {}, styleSizes = {}, shapeSizes = {} }) {
  const byKey = (k) => db.optionGroups.find((x) => x.key === k)?.options || []
  for (const o of byKey('type')) {
    if (types[o.id] !== undefined) o.price = Number(types[o.id]) || 0
    if (typeSizes[o.id]) o.sizePrices = { ...(o.sizePrices || {}), ...cleanSpecial(typeSizes[o.id]) }
  }
  // เนื้อเค้ก/รูปแบบตกแต่ง/รูปทรง: ตัวเลือกโหมดคงที่ → price · โหมดตามขนาด → sizePrices
  for (const [k, fixed, bySize] of [['flavor', flavors, flavorSizes], ['style', styles, styleSizes], ['shape', shapes, shapeSizes]]) {
    for (const o of byKey(k)) {
      if (o.priceType === 'size') { if (bySize[o.id]) o.sizePrices = { ...(o.sizePrices || {}), ...cleanSpecial(bySize[o.id]) } }
      else if (fixed[o.id] !== undefined) o.price = Number(fixed[o.id]) || 0
    }
  }
}
// ---------- คลังรูปเค้กสั่งทำ (แอดมิน) ----------
const optionIdSet = () => new Set(db.optionGroups.flatMap((g) => (g.options || []).map((o) => o.id)))
export function saveGalleryImage(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const image = String(d.image || '')
  if (!image) return { error: 'ไม่มีรูป' }
  const ok = optionIdSet()
  const tags = [...new Set((d.tags || []).filter((t) => ok.has(t)))].slice(0, 12)
  if (!tags.length) return { error: 'ติ๊กตัวเลือกที่รูปนี้เป็นตัวแทนอย่างน้อย 1 อย่าง' }
  const row = { image, tags, caption: String(d.caption ?? '').trim().slice(0, 120), active: d.active !== false, ...(d.source ? { source: d.source } : {}) }
  const cur = d.id ? db.cakeGallery.find((x) => x.id === d.id) : null
  if (d.id && !cur) return { error: 'ไม่พบรูป' }
  if (cur) { Object.assign(cur, row); return { ok: true, item: cur } }
  const it = { id: uid('cg'), createdAt: now(), ...row }
  db.cakeGallery.push(it)
  return { ok: true, item: it }
}
export function recordCakeClick(photoId, visitor) {
  if (!photoId || !visitor) return
  if (db.cakeClicks.some((c) => c.v === visitor && c.photoId === photoId)) return
  db.cakeClicks.push({ v: String(visitor), photoId, at: now() })
  if (db.cakeClicks.length > 5000) db.cakeClicks.splice(0, db.cakeClicks.length - 5000)
  if (supabaseEnabled) getSupabase().then((c) => sendClick(c, photoId, visitor)).catch(() => {}) // เก็บที่เซิร์ฟเวอร์ด้วย (ล้มเหลวไม่กระทบหน้า)
}
export function removeGalleryImage(id) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const i = db.cakeGallery.findIndex((x) => x.id === id)
  if (i < 0) return { error: 'ไม่พบรูป' }
  const [gone] = db.cakeGallery.splice(i, 1)
  for (const h of trashHooks) h(gone.image) // สำเนาสาธารณะที่ระบบคัดลอกไว้ (published/) → ลบไฟล์ · รูปอื่นไม่แตะ
  return { ok: true }
}
// ---------- รูปงานเสร็จ (ส่งให้ลูกค้าดู · เผยแพร่บนเว็บเมนูเมื่อลูกค้าไม่ปฏิเสธ) ----------
// order.items[].workPhotos = [{ id, image, at, by, publish, galleryId }] · order.photoConsent = { status: ok | requested | revoked, ... }
export const photoStatusOf = (o) => o?.photoConsent?.status || 'ok'
const hasWorkPhotos = (o) => (o?.items || []).some((i) => (i.workPhotos || []).length)
export const photoAllowed = (o) => !!o && photoStatusOf(o) === 'ok'
const MAX_WORK_PHOTOS = 10
const photoBlock = (order) => {
  if (!order) return 'ไม่พบออร์เดอร์'
  if (order.channel === 'pos') return 'บิลหน้าร้าน (POS) ไม่มีรูปงานเสร็จ'
  if (['draft', 'cancelled'].includes(order.status)) return 'ออร์เดอร์นี้อัปโหลดรูปงานไม่ได้'
  if (photoStatusOf(order) !== 'ok') return photoStatusOf(order) === 'requested' ? 'ลูกค้าขอไม่ให้ใช้รูป (รอร้านตรวจสอบ) อัปโหลดรูปใหม่ไม่ได้' : 'ลูกค้าไม่อนุญาตให้ใช้รูปในออร์เดอร์นี้ อัปโหลดรูปใหม่ไม่ได้'
  return ''
}
// แท็กตัวเลือกอัตโนมัติของรายการ (ประเภท/เนื้อ/ขนาด/ตกแต่ง — ไม่รวมกลุ่มข้อความ) ใช้เป็นค่าเริ่มต้นตอนเผยแพร่เข้าคลังรูป
export function autoTagsOf(item) {
  const ok = optionIdSet()
  const textGroups = new Set(db.optionGroups.filter((g) => g.type === 'text').map((g) => g.id))
  const ids = new Set()
  const add = (sels) => { for (const [gid, v] of Object.entries(sels || {})) { if (textGroups.has(gid) || v == null || v === '') continue; for (const id of Array.isArray(v) ? v : [v]) if (ok.has(id)) ids.add(id) } }
  add(item.selections)
  for (const t of item.tiers || []) add(t.selections)
  for (const k of ['typeId', 'flavorId', 'sizeId']) if (item[k] && ok.has(item[k])) ids.add(item[k])
  return [...ids]
}
// ถอนรูปออกจากที่เผยแพร่ (คลังรูป/รูปสินค้า) — ไม่ลบรูปในออร์เดอร์
export const trashHooks = [] // ฟังก์ชันที่ถูกเรียกเมื่อมีสำเนาสาธารณะที่ต้องลบไฟล์ (ตั้งโดยชั้นเชื่อม Supabase)
function unpublishPhoto(order, item, photo) {
  if (photo.publicImage) { for (const h of trashHooks) h(photo.publicImage); photo.publicImage = null }
  if (photo.galleryId) {
    const gi = db.cakeGallery.findIndex((g) => g.id === photo.galleryId)
    if (gi >= 0) db.cakeGallery.splice(gi, 1)
  }
  const p = item.retailId ? db.retailItems.find((r) => r.id === item.retailId) : null
  if (p?.workImages) p.workImages = p.workImages.filter((w) => w.photoId !== photo.id)
  photo.publish = false
  photo.galleryId = null
}
const findItem = (order, itemId) => order?.items.find((i) => i.id === itemId)
export function addWorkPhotos(order, itemId, images, opts = {}) {
  if (!can('workPhoto')) return { error: 'ไม่มีสิทธิ์อัปโหลดรูปงาน' }
  const b = photoBlock(order)
  if (b) return { error: b }
  const it = findItem(order, itemId)
  if (!it) return { error: 'ไม่พบรายการสินค้า' }
  const list = (images || []).filter((x) => typeof x === 'string' && x)
  if (!list.length) return { error: 'ไม่มีรูป' }
  it.workPhotos ||= []
  if (it.workPhotos.length + list.length > MAX_WORK_PHOTOS) return { error: `รูปงานต่อรายการได้ไม่เกิน ${MAX_WORK_PHOTOS} รูป` }
  const added = list.map((image) => ({ id: uid('wp'), image, at: now(), by: session.role, publish: false, galleryId: null }))
  it.workPhotos.push(...added)
  log(order, `อัปโหลดรูปงานเสร็จ ${added.length} รูป (${it.name})`)
  notifyOrder('photo_ready', order, { skip: opts.notify === false, noSms: opts.sms === false })
  return { ok: true, photos: added }
}
export function removeWorkPhoto(order, itemId, photoId) {
  if (!can('workPhoto')) return { error: 'ไม่มีสิทธิ์' }
  const it = findItem(order, itemId)
  const p = it?.workPhotos?.find((x) => x.id === photoId)
  if (!p) return { error: 'ไม่พบรูป' }
  unpublishPhoto(order, it, p)
  it.workPhotos = it.workPhotos.filter((x) => x.id !== photoId)
  log(order, `ลบรูปงานเสร็จ (${it.name})`)
  return { ok: true }
}
// เผยแพร่รูปขึ้นเว็บเมนู (ต้องสิทธิ์ manage · ลูกค้าไม่ได้ปฏิเสธ): เค้กสั่งทำ → คลังรูปตามแท็ก · สินค้าสำเร็จ → รูปของสินค้านั้น
export function publishWorkPhoto(order, itemId, photoId, { tags = [], caption = '', image = null } = {}) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const b = photoBlock(order)
  if (b) return { error: b }
  const it = findItem(order, itemId)
  const p = it?.workPhotos?.find((x) => x.id === photoId)
  if (!p) return { error: 'ไม่พบรูป' }
  if (p.publish) return { error: 'เผยแพร่อยู่แล้ว' }
  if (it.kind === 'retail' && it.retailId) {
    const prod = db.retailItems.find((r) => r.id === it.retailId)
    if (!prod) return { error: 'สินค้านี้ถูกลบแล้ว' }
    ;(prod.workImages ||= []).push({ id: uid('wi'), photoId: p.id, image: image || p.image, orderId: order.id, itemId: it.id })
    p.publish = true
    if (image) p.publicImage = image
    log(order, `เผยแพร่รูปงานเป็นรูปสินค้า ${prod.name}`)
    return { ok: true }
  }
  const r = saveGalleryImage({ image: image || p.image, tags, caption, source: { orderId: order.id, itemId: it.id, photoId: p.id } })
  if (r.error) return r
  p.publish = true
  if (image) p.publicImage = image
  p.galleryId = r.item.id
  log(order, 'เผยแพร่รูปงานเข้าคลังรูปเว็บเมนู')
  return { ok: true, gallery: r.item }
}
export function unpublishWorkPhoto(order, itemId, photoId) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const it = findItem(order, itemId)
  const p = it?.workPhotos?.find((x) => x.id === photoId)
  if (!p) return { error: 'ไม่พบรูป' }
  unpublishPhoto(order, it, p)
  log(order, 'ถอนรูปงานออกจากเว็บเมนู')
  return { ok: true }
}
// รูปสินค้าสำเร็จที่แสดงหน้าเว็บ = รูปเดิม + รูปงานที่เผยแพร่ (ตัดรูปของออร์เดอร์ที่ลูกค้าขอไม่เผยแพร่)
export function productImages(p, d = db) {
  const extra = (p.workImages || []).filter((w) => photoAllowed(d.orders.find((o) => o.id === w.orderId))).map((w) => w.image)
  return [...(p.images || []), ...extra]
}
// ---- ลูกค้าขอไม่ให้ใช้รูปเผยแพร่ (ทั้งลิงก์และล็อกอิน ผ่าน ctxOrder) → ร้านอนุมัติก่อนลบ ----
const hasPhotos = (o) => o.items.some((i) => (i.workPhotos || []).length)
export function customerRequestPhotoOptOut(ctx, note = '') {
  const o = ctxOrder(ctx)
  if (!o) return { error: 'ไม่พบออร์เดอร์' }
  if (!hasPhotos(o)) return { error: 'ยังไม่มีรูปงานในออร์เดอร์นี้' }
  if (photoStatusOf(o) === 'requested') return { error: 'ส่งคำขอไว้แล้ว รอร้านตรวจสอบ' }
  if (photoStatusOf(o) === 'revoked') return { error: 'ร้านลบรูปตามคำขอไว้แล้ว' }
  if (o._remote) return remoteOrderAction(db, ctx, 'photo_optout', { note }) // Promise · เซิร์ฟเวอร์บันทึก
  const req = { id: uid('pr'), orderId: o.id, customerId: o.customerId, status: 'pending', note: String(note ?? '').trim().slice(0, 300), createdAt: now(), decidedAt: null, decidedBy: null, decisionNote: '' }
  db.photoRequests.unshift(req)
  o.photoConsent = { status: 'requested', requestedAt: req.createdAt, note: req.note, history: [...(o.photoConsent?.history || []), { at: req.createdAt, text: 'ลูกค้าขอไม่ให้ใช้รูปเผยแพร่' }] }
  log(o, 'ลูกค้าขอไม่ให้ใช้รูปงานเผยแพร่ (รอร้านตรวจสอบ · ระงับการแสดงบนเว็บชั่วคราว)')
  notify('team_photo_optout', { vars: orderVars(o), orderId: o.id })
  return { ok: true, request: req }
}
export function customerCancelPhotoOptOut(ctx) {
  const o = ctxOrder(ctx)
  if (!o) return { error: 'ไม่พบออร์เดอร์' }
  if (o._remote) return remoteOrderAction(db, ctx, 'photo_optout_cancel') // Promise
  const req = db.photoRequests.find((r) => r.orderId === o.id && r.status === 'pending')
  if (!req || photoStatusOf(o) !== 'requested') return { error: 'ไม่มีคำขอที่รอตรวจสอบ' }
  Object.assign(req, { status: 'cancelled', decidedAt: now(), decidedBy: 'customer' })
  o.photoConsent = { ...o.photoConsent, status: 'ok', history: [...(o.photoConsent.history || []), { at: now(), text: 'ลูกค้ายกเลิกคำขอ' }] }
  log(o, 'ลูกค้ายกเลิกคำขอไม่ให้ใช้รูป')
  return { ok: true }
}
export const pendingPhotoRequests = () => db.photoRequests.filter((r) => r.status === 'pending').length
export function approvePhotoOptOut(id, opts = {}) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const r = db.photoRequests.find((x) => x.id === id)
  if (!r || r.status !== 'pending') return { error: 'คำขอนี้ดำเนินการแล้ว' }
  const o = findOrder(r.orderId)
  if (o) {
    for (const it of o.items) { for (const p of it.workPhotos || []) unpublishPhoto(o, it, p); it.workPhotos = [] }
    // กันตกค้าง: รายการคลัง/รูปสินค้าที่อ้างออร์เดอร์นี้
    db.cakeGallery = db.cakeGallery.filter((g) => g.source?.orderId !== o.id)
    for (const p of db.retailItems) if (p.workImages) p.workImages = p.workImages.filter((w) => w.orderId !== o.id)
    o.photoConsent = { ...o.photoConsent, status: 'revoked', decidedAt: now(), history: [...(o.photoConsent?.history || []), { at: now(), text: 'ร้านอนุมัติ ลบรูปทุกที่' }] }
    log(o, 'อนุมัติคำขอไม่เผยแพร่: ลบรูปงานออกจากทุกที่')
  }
  Object.assign(r, { status: 'approved', decidedAt: now(), decidedBy: session.role })
  if (o) notifyOrder('photo_optout_done', o, { skip: opts.notify === false, noSms: opts.sms === false })
  return { ok: true }
}
export function rejectPhotoOptOut(id, reason, opts = {}) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const r = db.photoRequests.find((x) => x.id === id)
  if (!r || r.status !== 'pending') return { error: 'คำขอนี้ดำเนินการแล้ว' }
  if (!String(reason ?? '').trim()) return { error: 'ใส่เหตุผลที่ไม่อนุมัติ' }
  const o = findOrder(r.orderId)
  Object.assign(r, { status: 'rejected', decisionNote: String(reason).trim().slice(0, 300), decidedAt: now(), decidedBy: session.role })
  if (o) {
    o.photoConsent = { ...o.photoConsent, status: 'ok', history: [...(o.photoConsent?.history || []), { at: now(), text: `ร้านไม่อนุมัติ: ${r.decisionNote}` }] }
    log(o, `ไม่อนุมัติคำขอไม่เผยแพร่รูป: ${r.decisionNote}`)
    notifyOrder('photo_optout_rejected', o, { skip: opts.notify === false, noSms: opts.sms === false })
  }
  return { ok: true }
}
// ลูกค้าเปลี่ยนใจและแจ้งร้าน → เปิดให้อัปโหลด/ใช้รูปได้อีก
export function allowPhotosAgain(orderId) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const o = findOrder(orderId)
  if (!o || photoStatusOf(o) !== 'revoked') return { error: 'ไม่อยู่ในสถานะห้ามใช้รูป' }
  o.photoConsent = { ...o.photoConsent, status: 'ok', history: [...(o.photoConsent.history || []), { at: now(), text: 'ร้านเปิดให้ใช้รูปได้อีก (ลูกค้าแจ้งเปลี่ยนใจ)' }] }
  log(o, 'เปิดให้อัปโหลด/ใช้รูปงานได้อีก')
  return { ok: true }
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
  // รูปทรง: บังคับเลือกตัวเลือกในหัวข้ออื่น { [groupId]: [optionId] } (เก็บเฉพาะที่ยังมีอยู่จริง)
  delete data.forces
  if (g.key === 'shape') {
    const forces = {}
    for (const [gid, ids] of Object.entries(d.forces || {})) {
      const tg = db.optionGroups.find((x) => x.id === gid)
      const ok = (ids || []).filter((id) => tg?.options?.some((o) => o.id === id))
      if (tg && tg.id !== g.id && ok.length) forces[gid] = ok
    }
    if (Object.keys(forces).length) data.forces = forces
  }
  if (g.key === 'size') data.pounds = Number(d.pounds) || 1
  else if (g.key === 'type') {
    if (!d.id) Object.assign(data, { price: 0, sizePrices: {} })
  } else if (g.key === 'flavor' || g.key === 'style' || g.key === 'shape') {
    // โหมดราคา (คงที่/ตามขนาด) ตั้งที่หน้าแก้ตัวเลือก · ตัวเลขราคาตั้งที่หน้าการกำหนดราคา
    data.priceType = d.priceType === 'size' ? 'size' : 'fixed'
    if (!d.id) Object.assign(data, { price: 0, sizePrices: {} })
    if (data.priceType === 'size') data.sizePrices = cleanSpecial(d.sizePrices) // โหมดตามขนาด: กรอกราคาต่อขนาดที่หน้าแก้ตัวเลือก
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
  upsert(db.bundles, 'b', { ...d, items: d.items.map((x) => ({ groupId: x.groupId, optionId: x.optionId })), discount: cleanSpecial(d.discount), types: [...(d.types || [])], typeDiscount: cleanTable(d.typeDiscount), styleDiscount: cleanTable(d.styleDiscount), styleMode: Object.fromEntries(Object.entries(d.styleMode || {}).filter(([, v]) => v === 'own')) })

// จัดลำดับ: สลับกับตัวข้างเคียง (dir = -1 ขึ้น / 1 ลง)
export function moveItem(list, index, dir) {
  const j = index + dir
  if (j < 0 || j >= list.length) return
  const [x] = list.splice(index, 1)
  list.splice(j, 0, x)
}

// ลากวางเรียงลำดับ: ย้ายรายการ from → ตำแหน่งของ to
export function moveItemTo(list, from, to) {
  if (from < 0 || to < 0 || from === to || from >= list.length || to >= list.length) return
  const [x] = list.splice(from, 1)
  list.splice(to, 0, x)
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
  const promo = payload.quoteItems
    ? { items: payload.items, shipPromo: payload.shipPromo || null, on: !!payload.promoOn }
    : (() => { const w = withPromos(payload.items.filter((i) => !i.promoGift).map((i) => priceItem(i))); return { items: w.items, shipPromo: w.shipPromo, on: true } })()
  const o = {
    id: uid('o'),
    code: nextCode(),
    customerId: payload.customerId,
    pickupAt: payload.pickupAt,
    fulfillment: payload.fulfillment,
    chatId: payload.chatId || null, // สร้างจากแชท
    birthday: payload.birthday?.md ? { name: payload.birthday.name || '', md: payload.birthday.md } : null, // { name, md: 'MM-DD' }
    ...deliveryFields(payload),
    items: promo.items, // จากใบเสนอ = ราคาตามใบเสนอ · ปกติ = ราคา + โปร/ดีล (withPromos)
    shipPromo: promo.shipPromo,
    promoOn: promo.on,
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
  if (!asDraft) notifyOrder('order_created', o, { skip: payload.notify === false, noSms: payload.sms === false })
  return o
}

// ลำดับจัดส่ง (เฉพาะ fulfillment = delivery): เตรียมแล้ว → พร้อมจัดส่ง → กำลังจัดส่ง → ส่งมอบแล้ว · ข้ามขั้นไม่ได้ · รับที่ร้านไม่มีสองขั้นกลาง
const SHIP_FROM = { ready_to_ship: 'prepared', shipping: 'ready_to_ship', delivered: 'shipping' }
export function setStatus(order, status, text, opts = {}) {
  // ส่งมอบไม่ได้ถ้ายังชำระไม่ครบ
  if (status === 'delivered' && orderTotals(order).balance > 0) return
  const isShip = order.fulfillment === 'delivery'
  if (['ready_to_ship', 'shipping'].includes(status) && !isShip) return
  if (isShip && SHIP_FROM[status] && order.status !== SHIP_FROM[status]) return
  const prev = order.status
  order.status = status
  log(order, text)
  if (status === 'delivered') order.deliveredAt = now()
  if (status === 'delivered') awardOrderRemote(order)
  const skip = opts.notify === false
  const noSms = opts.sms === false
  if (status === 'delivered') notifyOrder('delivered', order, { skip, noSms })
  if (status === 'prepared') notifyOrder('prepared', order, { skip, noSms })
  if (status === 'shipping') notifyOrder('shipping', order, { skip, noSms })
  if (status === 'cancelled') notifyOrder('cancelled', order, { skip, noSms })
  // ร่าง → ส่งไปรอชำระ = เริ่มเป็นออร์เดอร์จริง
  if (prev === 'draft' && status === 'awaiting_payment') notifyOrder('order_created', order, { skip, noSms })
}

// แจ้งยอดชำระ = ส่งยอดไปให้ลูกค้า (ยังไม่ใช่ยอดที่จ่ายจริง) ยอดจริงใส่ตอนแอดมินยืนยัน
// payment.status = reported (รอลูกค้าชำระ) | confirmed | cancelled, requested = ยอดที่แจ้ง, amount = ยอดจริง (ตอนยืนยัน)
const goodAmount = (v) => Number.isFinite(Number(v)) && Number(v) > 0
export function reportPayment(order, p) {
  if (!goodAmount(p.amount)) return { error: 'ยอดเงินไม่ถูกต้อง' }
  if (['draft', 'cancelled'].includes(order.status)) return { error: 'ออร์เดอร์นี้แจ้งยอดไม่ได้' }
  order.payments.push({
    id: uid('pay'), code: numbering.next('PAY'),
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
  notifyOrder('payment_requested', order, { requested: Number(p.amount), dueAt: due, skip: p.notify === false, noSms: p.sms === false })
  if (order.status === 'awaiting_payment') order.status = 'payment_reported'
  return { ok: true }
}

const dueText = (iso) => (iso ? `${dateOnly(iso)} ${timeOnly(iso)} น.` : '')

const payFields = (p) => ({ method: p.method, paidAt: p.paidAt, slip: p.slip || '', note: p.note || '' })

export function updatePaymentRequest(order, paymentId, p) {
  const pay = order.payments.find((x) => x.id === paymentId)
  if (!pay || pay.status !== 'reported') return
  if (!goodAmount(p.amount)) return { error: 'ยอดเงินไม่ถูกต้อง' }
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
  if (orderTotals(order).paidNet - p.amount < -0.004) return { error: 'ยกเลิกยอดนี้ไม่ได้ เพราะคืนเงินบางส่วนไปแล้ว' }
  Object.assign(p, { status: 'cancelled', cancelledAt: now(), cancelledBy: session.role })
  log(order, `ยกเลิกยอดที่ยืนยันแล้ว ${money(p.amount)}`)
  if (!order.payments.some((x) => x.status === 'confirmed') && ['payment_confirmed', 'preparing', 'prepared', 'ready_to_ship', 'shipping'].includes(order.status)) {
    order.status = order.payments.some((x) => x.status === 'reported') ? 'payment_reported' : 'awaiting_payment'
  }
}

// data = ยอดที่ได้รับจริง + รายละเอียด (ไม่ส่ง = ใช้ตามที่แจ้ง)
export function confirmPayment(order, paymentId, data = null) {
  const p = order.payments.find((x) => x.id === paymentId)
  if (!p || p.status !== 'reported') return
  if (['draft', 'cancelled'].includes(order.status)) return { error: 'ออร์เดอร์นี้ยืนยันชำระไม่ได้' }
  if (data) {
    // ยอดที่ได้รับจริง: ต้องเป็นจำนวนบวก และไม่เกินยอดคงค้าง (ยอดที่ยืนยันแล้วของออร์เดอร์ไม่นับยอดนี้)
    if (!goodAmount(data.amount)) return { error: 'ยอดเงินไม่ถูกต้อง' }
    if (round2(Number(data.amount)) > round2(orderTotals(order).balance) + 0.004) return { error: 'ยอดเกินยอดคงค้าง' }
    Object.assign(p, { amount: round2(Number(data.amount)), ...payFields(data) })
  }
  p.status = 'confirmed'
  p.confirmedBy = session.role
  p.confirmedAt = now()
  log(order, `ยืนยันชำระ ${money(p.amount)}${p.amount !== p.requested ? ` (แจ้ง ${money(p.requested)})` : ''}`)
  if (['awaiting_payment', 'payment_reported'].includes(order.status)) order.status = 'payment_confirmed'
  notifyOrder('payment_confirmed', order, { skip: data?.notify === false, noSms: data?.sms === false, paid: p.amount })
  return { ok: true }
}

// รับชำระทันที: ลูกค้าจ่ายแล้วที่หน้างาน ไม่ต้องแจ้งยอด/กำหนดชำระ → สร้างงวดที่ยืนยันแล้วเลย (สิทธิ์ confirmPayment) · คืน { ok } | { error }
export function receivePaymentNow(order, p) {
  if (!can('confirmPayment')) return { error: 'ไม่มีสิทธิ์ยืนยันรับชำระ' }
  if (!order || ['draft', 'cancelled'].includes(order.status)) return { error: 'ออร์เดอร์นี้รับชำระไม่ได้' }
  const amount = round2(Number(p.amount))
  if (!(amount > 0)) return { error: 'กรอกยอดเงิน' }
  if (amount > round2(orderTotals(order).balance) + 0.004) return { error: 'ยอดเกินยอดคงค้าง' }
  order.payments.push({
    id: uid('pay'), code: numbering.next('PAY'), requested: amount, amount, method: p.method, paidAt: p.paidAt || now(), slip: p.slip || '', note: p.note || '',
    dueAt: '', extension: null, createdAt: now(), status: 'confirmed', source: 'direct', reportedBy: session.role, confirmedBy: session.role, confirmedAt: now(),
  })
  log(order, `รับชำระทันที ${money(amount)} (${p.method})`)
  if (['awaiting_payment', 'payment_reported'].includes(order.status)) order.status = 'payment_confirmed'
  notifyOrder('payment_confirmed', order, { skip: p.notify === false, noSms: p.sms === false, paid: amount })
  return { ok: true }
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
export function confirmUnpaid(order, opts = {}) {
  if (!can('confirmUnpaid') || !canConfirmUnpaid(order)) return false
  const pending = order.approval?.status === 'pending'
  order.approval = { ...(order.approval || {}), status: 'approved', decidedBy: session.role, decidedAt: now() }
  setStatus(order, 'order_confirmed', pending ? 'อนุมัติ · ยืนยันการสั่งซื้อ (ยังไม่ชำระ)' : 'ยืนยันการสั่งซื้อ (ยังไม่ชำระ)')
  notifyOrder('order_confirmed', order, { skip: opts.notify === false, noSms: opts.sms === false })
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
  const base = order.items.filter((i) => !i.promoGift).map((i) => priceItem(i, orderDate(order)))
  if (!order.promoOn) { order.items = base; return }
  const w = withPromos(base, { at: new Date(order.createdAt) })
  order.items = w.items
  order.shipPromo = w.shipPromo
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
  if (!it || it.promoGift || order.items.filter((x) => !x.promoGift).length <= 1) return false
  order.items = order.items.filter((x) => x.id !== itemId)
  repriceAll(order)
  log(order, `ลบสินค้า: ${it.name}`)
  return true
}

export function setAdjustment(order, amount, reason) {
  // ส่วนลดจากการปรับราคา (ติดลบ) ต้องไม่เกินยอดสินค้า
  const a = Math.max(Number.isFinite(Number(amount)) ? Number(amount) : 0, -orderTotals(order).subtotal)
  order.adjustment = { amount: a, reason }
  log(order, `ปรับราคา ${money(a)} (${reason})`)
}

// ยกเลิกออร์เดอร์ + คืนเงิน: c = { reason, refunds: [{ method: cash | transfer | points, amount }], refundNote }
// (รูปแบบเก่า { refundAmount, refundMethod } ยังใช้ได้) · คืนเป็นคะแนน = ยอด ÷ มูลค่าต่อคะแนน (ต้องหารลงตัว) อายุตามค่าตั้งต้น
// ตรวจก่อนแก้ข้อมูลทุกอย่าง → คืน { ok } หรือ { error }
// ตัวทำงานหลังยกเลิกออร์เดอร์ (เช่น บัญชีออกใบลดหนี้) ลงทะเบียนจากโมดูลอื่น — store ไม่ import โมดูลเหล่านั้น
export const cancelHooks = []
export function cancelOrder(order, c) {
  if (!order || order.status === 'cancelled') return { error: 'ออร์เดอร์นี้ยกเลิกแล้ว' }
  const paid = orderTotals(order).paidNet // หักยอดที่คืนบางส่วนไปแล้ว
  const refunds = normalizeRefunds(c, paid)
  const cu = findCustomer(order.customerId)
  const err = refundErrors(refunds, { paid, canPoints: !!cu && !cu.deleted, pointValue: db.loyalty.pointValue })
  if (err) return { error: err }
  const prevSt = order.status
  // ย้อนการยกเลิกได้เฉพาะ: ไม่มีเงินคืนจริง · ไม่เคยใช้คะแนน/คูปอง · ไม่ได้ยกเลิกจากสถานะส่งมอบแล้ว (undoLoyalty ถอนคะแนน/คูปองไปแล้ว)
  const restorable = !refunds.length && !order.pointsUsed && !order.couponsUsed.length && !order.loyalty && prevSt !== 'delivered'
  undoLoyalty(order)
  for (const x of refunds) {
    if (x.method !== 'points') continue
    x.points = Math.round(x.amount / db.loyalty.pointValue)
    if (pointsHook.call) { if (x.points > 0 && cu) ledgerRemote(cu.id, [{ op: 'earn', id: uid('pt'), points: x.points, reason: `คืนเงินจากการยกเลิก ${order.code}`, orderId: order.id }], order.id) }
    else earnPoints(cu, x.points, `คืนเงินจากการยกเลิก ${order.code}`, order.id)
  }
  const refundAmount = round2(refunds.reduce((n, x) => n + x.amount, 0))
  const summary = refunds.map((x) => `${REFUND_METHODS[x.method]} ${money(x.amount)}${x.method === 'points' ? ` (${x.points} คะแนน)` : ''}`).join(' + ')
  order.cancel = { reason: c.reason, refunds, refundAmount, refundMethod: refunds.map((x) => REFUND_METHODS[x.method]).join(' + '), refundNote: c.refundNote || '', at: now(), prevStatus: prevSt, restorable }
  setStatus(order, 'cancelled', `ยกเลิก: ${c.reason}${refundAmount ? ` / คืนเงิน ${summary}` : ''}`, { notify: c.notify, sms: c.sms })
  for (const h of cancelHooks) h(order)
  return { ok: true }
}

// คืนเงินบางส่วนโดยไม่ยกเลิกออร์เดอร์/บิล (ออร์เดอร์: สิทธิ์ refundPartial · POS: posVoid)
// c = { reason, refunds: [{ method: cash | transfer | points, amount }], note, notify } · รวมทุกครั้งต้องไม่เกินยอดที่ชำระแล้ว
// คืนเป็นคะแนน = ยอด ÷ มูลค่าต่อคะแนน (ต้องหารลงตัว) · ไม่ย้อนสต็อก/คะแนนที่ได้จากการซื้อ (เป็นการชดเชยเงิน) · คืน { ok, entry } | { error }
export function refundOrder(order, c) {
  if (!order || ['draft', 'cancelled'].includes(order.status)) return { error: 'ออร์เดอร์นี้คืนเงินไม่ได้' }
  if (!can(order.channel === 'pos' ? 'posVoid' : 'refundPartial')) return { error: 'ไม่มีสิทธิ์คืนเงิน' }
  const reason = String(c?.reason || '').trim().slice(0, 200)
  if (!reason) return { error: 'ระบุเหตุผลการคืนเงิน' }
  const paidNet = orderTotals(order).paidNet
  if (!(paidNet > 0)) return { error: 'ไม่มียอดที่ชำระแล้วให้คืน' }
  const refunds = normalizeRefunds({ refunds: c?.refunds || [] }, paidNet)
  if (!refunds.length) return { error: 'ระบุยอดคืนอย่างน้อย 1 ช่องทาง' }
  const cu = findCustomer(order.customerId)
  const err = refundErrors(refunds, { paid: paidNet, canPoints: !!cu && !cu.deleted, pointValue: db.loyalty.pointValue })
  if (err) return { error: err }
  for (const x of refunds) {
    if (x.method !== 'points') continue
    x.points = Math.round(x.amount / db.loyalty.pointValue)
    if (pointsHook.call) {
      x.lotId = x.points > 0 ? uid('pt') : null
      if (x.lotId) ledgerRemote(cu.id, [{ op: 'earn', id: x.lotId, points: x.points, reason: `คืนเงิน ${order.code}`, orderId: order.id }], order.id)
    } else x.lotId = earnPoints(cu, x.points, `คืนเงิน ${order.code}`, order.id)?.id
  }
  const amount = round2(refunds.reduce((n, x) => n + x.amount, 0))
  const entry = { id: uid('rf'), at: now(), by: session.role, reason, note: String(c?.note || '').trim().slice(0, 200), refunds, amount }
  ;(order.returns ||= []).push(entry)
  const summary = refunds.map((x) => `${REFUND_METHODS[x.method]} ${money(x.amount)}${x.method === 'points' ? ` (${x.points} คะแนน)` : ''}`).join(' + ')
  log(order, `คืนเงินบางส่วน ${summary} · ${reason}`)
  notifyOrder('order_refunded', order, { requested: amount, skip: c?.notify === false, noSms: c?.sms === false })
  return { ok: true, entry }
}

// ยกเลิกการคืนเงินบางส่วนรายการหนึ่ง (เก็บประวัติเป็น "ยกเลิกแล้ว" ไม่ลบ) · สิทธิ์เดียวกับการคืน
// ปฏิเสธเมื่อ: ออร์เดอร์/บิลถูกยกเลิก · งวดบัญชีปิดแล้ว · เดือนภาษียื่นแล้ว (มี VAT) · คะแนนที่คืนให้ถูกใช้ไปแล้ว
export function cancelRefund(order, returnId, c = {}) {
  if (!order) return { error: 'ไม่พบออร์เดอร์' }
  if (!can(order.channel === 'pos' ? 'posVoid' : 'refundPartial')) return { error: 'ไม่มีสิทธิ์ยกเลิกการคืนเงิน' }
  const r = (order.returns || []).find((x) => x.id === returnId)
  if (!r) return { error: 'ไม่พบรายการคืนเงิน' }
  if (r.cancelled) return { error: 'รายการนี้ยกเลิกไปแล้ว' }
  const reason = String(c.reason || '').trim().slice(0, 200)
  if (!reason) return { error: 'ระบุเหตุผลที่ยกเลิกการคืนเงิน' }
  if (order.status === 'cancelled') return { error: `${order.channel === 'pos' ? 'บิล' : 'ออร์เดอร์'}นี้ถูกยกเลิกแล้ว ยกเลิกการคืนเงินไม่ได้` }
  const A = db.acct
  const date = dayOf(r.at)
  if (date && A?.closedThrough && date <= A.closedThrough) return { error: `รายการบัญชีของการคืนนี้ (${date}) อยู่ในงวดที่ปิดแล้ว ยกเลิกไม่ได้` }
  if (date && order.vat && A?.vatFilings?.[date.slice(0, 7)]?.filedAt) return { error: `เดือนภาษี ${date.slice(0, 7)} ยื่น ภ.พ.30 แล้ว ยกเลิกการคืนไม่ได้` }
  // คะแนนที่คืนให้ต้องยังไม่ถูกใช้ (ตรวจทุกก้อนก่อนแก้ข้อมูล)
  const cu = findCustomer(order.customerId)
  const pts = (r.refunds || []).filter((x) => x.method === 'points')
  if (pts.length && !cu) return { error: 'ไม่พบลูกค้า' }
  const lots = []
  for (const x of pts) {
    const lot = cu?.ledger?.find((l) => (x.lotId ? l.id === x.lotId : l.orderId === order.id && l.reason === `คืนเงิน ${order.code}` && l.delta === x.points))
    // เจอก้อนในเครื่องแล้วถูกใช้ไป = ปฏิเสธ · ไม่เจอในเครื่อง (โหมดเซิร์ฟเวอร์) ให้เซิร์ฟเวอร์ตรวจตอนแก้ไข
    if (lot ? lot.remaining !== lot.delta : !pointsHook.call) return { error: 'คะแนนที่คืนให้ลูกค้าถูกใช้ไปแล้ว ยกเลิกการคืนไม่ได้' }
    lots.push({ lot, x })
  }
  if (pointsHook.call) {
    const ops = lots.map(({ lot, x }) => ({ op: 'cut_refund', lotId: lot?.id || x.lotId || null, points: x.points, label: `คืนเงิน ${order.code}`, reason: `ยกเลิกการคืนเงิน ${order.code}`, orderId: order.id }))
    if (ops.length) ledgerRemote(cu.id, ops, order.id)
  } else {
    for (const { lot, x } of lots) {
      lot.remaining = 0
      cu.ledger.push({ id: uid('pt'), at: now(), delta: -x.points, reason: `ยกเลิกการคืนเงิน ${order.code}`, orderId: order.id, takes: [{ lotId: lot.id, n: x.points }] })
    }
  }
  r.cancelled = { at: now(), by: session.role, reason }
  log(order, `ยกเลิกการคืนเงิน ${money(r.amount)} · ${reason}`)
  if (order.channel !== 'pos') notifyOrder('order_refund_cancelled', order, { requested: r.amount, skip: c.notify !== true, noSms: c.sms === false })
  return { ok: true, entry: r }
}

// ---------- ย้อนสถานะทีละขั้น (สิทธิ์ revertStatus) ----------
// คืน { ok, from, to } | { error } · ต้องมีเหตุผล · ไม่ทำกับบิล POS (ใช้ยกเลิกบิล) · ไม่แจ้งลูกค้า (opts.notify === true จึงแจ้งสถานะใหม่ในกรณีที่มีข้อความ)
const dayOf = (iso) => String(iso || '').slice(0, 10)
function revertBlock(order, from) {
  const A = db.acct
  const closed = A?.closedThrough || ''
  const hasInv = (A?.taxInvoices || []).some((i) => i.orderId === order.id && i.type === 'invoice' && !i.voidedBy)
  let date = ''
  if (from === 'delivered') date = dayOf(order.deliveredAt)
  else if (from === 'payment_confirmed') date = dayOf([...order.payments].reverse().find((p) => p.status === 'confirmed')?.confirmedAt)
  else if (from === 'cancelled') date = dayOf(order.cancel?.at)
  else return ''
  if (date && closed && date <= closed) return `รายการบัญชีของขั้นนี้ (${date}) อยู่ในงวดที่ปิดแล้ว ย้อนไม่ได้`
  if (date && A?.vatFilings?.[date.slice(0, 7)]?.filedAt && order.vat) return `เดือนภาษี ${date.slice(0, 7)} ยื่น ภ.พ.30 แล้ว ย้อนไม่ได้`
  if (hasInv) return 'ออกใบกำกับภาษีไว้แล้ว ยกเลิกใบ (ออกใบลดหนี้) ก่อนจึงย้อนสถานะได้'
  return ''
}
export function revertStatus(order, reason, opts = {}) {
  if (!can('revertStatus')) return { error: 'ไม่มีสิทธิ์ย้อนสถานะ' }
  if (!order) return { error: 'ไม่พบออร์เดอร์' }
  if (order.channel === 'pos') return { error: 'บิลหน้าร้าน (POS) ย้อนสถานะไม่ได้ ใช้ยกเลิกบิลแทน' }
  if (!String(reason ?? '').trim()) return { error: 'ระบุเหตุผลที่ย้อนสถานะ' }
  const from = order.status
  const to = prevStatus(order)
  if (!to) return { error: from === 'cancelled' ? 'ออร์เดอร์ที่ยกเลิกนี้ย้อนไม่ได้ (มีการคืนเงิน/ใช้คะแนน-คูปอง/ยกเลิกหลังส่งมอบ หรือยกเลิกก่อนมีฟีเจอร์นี้)' : 'ไม่มีขั้นก่อนหน้า' }
  const block = revertBlock(order, from)
  if (block) return { error: block }
  const why = String(reason).trim().slice(0, 200)
  if (from === 'cancelled') {
    order.cancel = null
    order.status = to
  } else if (from === 'payment_confirmed') {
    const last = [...order.payments].reverse().find((p) => p.status === 'confirmed')
    if (!last) return { error: 'ไม่พบยอดที่ยืนยัน' }
    Object.assign(last, { status: 'cancelled', cancelledAt: now(), cancelledBy: session.role })
    if (!order.payments.some((x) => x.status === 'confirmed')) order.status = to
  } else if (from === 'payment_reported') {
    for (const p of order.payments) if (p.status === 'reported') p.status = 'cancelled'
    order.status = to
  } else if (from === 'awaiting_payment') {
    if (order.payments.some((p) => p.status !== 'cancelled')) return { error: 'มียอดชำระ/ยอดที่แจ้งอยู่ ยกเลิกยอดก่อน' }
    order.status = to
  } else if (from === 'order_confirmed') {
    if (order.approval) order.approval = { ...order.approval, status: 'revoked' }
    order.status = to
  } else {
    order.status = to
    if (from === 'delivered') {
      order.deliveredAt = null
      undoAwardRemote(order)
    }
  }
  log(order, `ย้อนสถานะ ${STATUS[from]?.label || from} → ${STATUS[order.status]?.label || order.status} · เหตุผล: ${why}`)
  if (opts.notify === true && order.status === 'prepared') notifyOrder('prepared', order, { noSms: opts.sms === false })
  return { ok: true, from, to: order.status }
}
export const canRevert = (order) => can('revertStatus') && order?.channel !== 'pos' && !!prevStatus(order)

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
      address: String(d.vat.address ?? '').trim().slice(0, 300), branch: /^\d{5}$/.test(String(d.vat.branch ?? '')) ? String(d.vat.branch) : '00000',
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
  points = Math.floor(Number(points))
  if (!(points > 0)) return false
  if (points * db.loyalty.pointValue > orderTotals(order).total + 0.004) return false // ส่วนลดจากคะแนนต้องไม่เกินยอดที่ต้องชำระ
  const e = spendPoints(c, points, `ใช้เป็นส่วนลด ${order.code}`, order.id)
  if (!e) return false
  order.pointsUsed = { points, amount: round2(points * db.loyalty.pointValue), entryId: e.id }
  log(order, `ใช้ ${points} คะแนน ลด ${money(order.pointsUsed.amount)}`)
  return true
}

// ใช้/ยกเลิกใช้แต้มกับออร์เดอร์ผ่านเซิร์ฟเวอร์แบบอะตอมิก (กันใช้แต้มซ้ำจากสองเครื่อง) · ไม่มีตัวเรียก (โหมดจำลอง) = ใช้ฟังก์ชันในเครื่องเดิม
export const pointsHook = { call: null }
const PTS_MSG = {
  insufficient: 'คะแนนไม่พอ (อาจถูกใช้ไปจากอีกเครื่อง) กรุณารีเฟรช', already_used: 'ออร์เดอร์นี้ใช้คะแนนไปแล้ว', bad_status: 'ออร์เดอร์นี้ใช้คะแนนไม่ได้',
  no_order: 'ไม่พบออร์เดอร์บนเซิร์ฟเวอร์ (ยังไม่ซิงก์)', no_customer: 'ไม่พบลูกค้า', invalid: 'ข้อมูลไม่ถูกต้อง', none: 'ออร์เดอร์นี้ไม่ได้ใช้คะแนน',
  forbidden: 'ไม่มีสิทธิ์ทำรายการนี้',
}
export async function applyPointsRemote(order, points) {
  const n = Math.floor(Number(points))
  if (!(n > 0)) return { error: 'จำนวนคะแนนไม่ถูกต้อง' }
  if (!pointsHook.call) return applyPoints(order, n) ? { ok: true } : { error: 'ใช้คะแนนไม่ได้' }
  if (!can('useLoyalty')) return { error: 'ไม่มีสิทธิ์ใช้คะแนน' }
  if (n * db.loyalty.pointValue > orderTotals(order).total + 0.004) return { error: 'ส่วนลดจากคะแนนต้องไม่เกินยอดที่ต้องชำระ' } // เพดานตรวจที่แอป (เซิร์ฟเวอร์ตรวจยอดคะแนน/สถานะ)
  const r = await pointsHook.call('punpang_apply_points', { p_order: order.id, p_points: n }, { order: order.id, customer: order.customerId })
  if (r.error) return { error: PTS_MSG[r.error] || r.error }
  return { ok: true }
}
export async function removePointsRemote(order) {
  if (!order.pointsUsed) return { error: PTS_MSG.none }
  if (!pointsHook.call) { removePoints(order); return { ok: true } }
  if (!can('useLoyalty')) return { error: 'ไม่มีสิทธิ์ใช้คะแนน' }
  const r = await pointsHook.call('punpang_remove_points', { p_order: order.id }, { order: order.id, customer: order.customerId })
  if (r.error) return { error: PTS_MSG[r.error] || r.error }
  return { ok: true }
}

// แอดมินปรับแต้ม (+/−) ผ่านเซิร์ฟเวอร์แบบอะตอมิก · ไม่มีตัวเรียก (โหมดจำลอง) = ใช้ adjustPoints ในเครื่องเดิม
export async function adjustPointsRemote(customerId, delta, reason) {
  if (!pointsHook.call) return adjustPoints(customerId, delta, reason)
  if (!can('adjustPoints')) return { error: 'เฉพาะแอดมิน' }
  const n = Number(delta)
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 1000000) return { error: 'ใส่จำนวนคะแนนเป็นจำนวนเต็ม (ไม่เกิน 1,000,000)' }
  if (!String(reason ?? '').trim()) return { error: 'ใส่เหตุผลในการปรับคะแนน' }
  const r = await pointsHook.call('punpang_adjust_points', { p_customer: customerId, p_delta: n, p_reason: String(reason).trim() }, { customer: customerId })
  if (r.error) return { error: r.error === 'insufficient' ? `ลดได้ไม่เกิน ${r.balance ?? 0} คะแนน (คงเหลือของลูกค้า)` : r.error === 'no_reason' ? 'ใส่เหตุผลในการปรับคะแนน' : PTS_MSG[r.error] || r.error }
  return { ok: true, balance: r.balance }
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
  Object.assign(cp, { status: 'used', orderId: order.id, usedAt: now(), activatedAt: null, activatedUntil: null })
  // ส่วนลดคูปองต้องไม่เกินยอดที่ต้องชำระ ณ ตอนใช้ (ยอดไม่ติดลบ)
  order.couponsUsed.push({ couponId, name: cp.name, amount: Math.min(Math.max(Number(cp.amount) || 0, 0), orderTotals(order).total) })
  log(order, `ใช้คูปอง ${cp.name}`)
  return true
}

// จองคูปองกับเซิร์ฟเวอร์แบบอะตอมิกก่อนใช้ (กันสองเครื่องใช้คูปองใบเดียวกับสองออร์เดอร์) · ไม่มีตัวจอง (โหมดจำลอง) = ผ่านเลย
// ผล: { ok } | { error } · เซิร์ฟเวอร์ตอบ missing (ยังไม่มีแถวในฐานข้อมูล) ถือว่าใช้ต่อในเครื่องได้เหมือนเดิม
export const couponHook = { claim: null, release: null }
const CLAIM_MSG = { used: 'คูปองใบนี้ถูกใช้ไปแล้ว (อาจจากอีกเครื่อง) กรุณารีเฟรช', expired: 'คูปองหมดอายุแล้ว', invalid: 'ใช้คูปองนี้ไม่ได้' }
export async function claimCoupon(couponId, orderId) {
  if (!couponHook.claim) return { ok: true }
  let r
  try { r = await couponHook.claim(String(couponId), String(orderId)) } catch { r = 'error' }
  if (r === 'ok' || r === 'missing') return { ok: true }
  return { error: CLAIM_MSG[r] || 'ตรวจคูปองกับเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' }
}
export async function claimAndApplyCoupon(order, couponId) {
  const cp = db.coupons.find((x) => x.id === couponId)
  if (!cp || cp.type !== 'discount' || !couponUsable(cp, today())) return { error: 'ใช้คูปองนี้ไม่ได้' }
  const c = await claimCoupon(couponId, order.id)
  if (c.error) return c
  return applyCoupon(order, couponId) ? { ok: true } : { error: 'ใช้คูปองนี้ไม่ได้' }
}
// POS: จองทุกใบก่อนขาย · ใบใดไม่ผ่าน → คืนใบที่จองไปแล้วทั้งหมด (คืน { ok, claimed } เพื่อให้ผู้เรียกคืนได้ถ้าขายไม่สำเร็จ)
export const POS_CLAIM_ORDER = 'pos-pending'
export async function claimPosCoupons(ids) {
  const claimed = []
  for (const id of ids || []) {
    const c = await claimCoupon(id, POS_CLAIM_ORDER)
    if (c.error) { await releaseCoupons(claimed); return c }
    claimed.push(id)
  }
  return { ok: true, claimed }
}
export async function releaseCoupons(ids, orderId = POS_CLAIM_ORDER) {
  if (!couponHook.release) return
  for (const id of ids || []) { try { await couponHook.release(String(id), String(orderId)) } catch { /* ข้าม */ } }
}

export function removeCoupon(order, couponId) {
  const cp = db.coupons.find((x) => x.id === couponId)
  if (cp) Object.assign(cp, { status: 'pending', orderId: null, usedAt: null, activatedAt: null, activatedUntil: null })
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
  if (order.pointsUsed) { if (pointsHook.call) serverRemovePoints(order); else removePoints(order) }
  for (const u of [...order.couponsUsed]) removeCoupon(order, u.couponId)
  undoAwardRemote(order)
}
// คิวคะแนนของเครื่องนี้: การให้/ถอนแต้มทำทีละครั้ง เรียงตามลำดับที่สั่ง (ส่งมอบแล้วย้อนทันที → ถอนต้องไม่แซงการให้)
let loyaltyChain = Promise.resolve()
function loyaltyQueue(fn) {
  const run = loyaltyChain.then(fn)
  loyaltyChain = run.catch(() => {})
  return run
}
// ส่งมอบ: ให้แต้มผ่านเซิร์ฟเวอร์ (RPC punpang_award_order กันให้ซ้ำด้วย data.loyalty ของออร์เดอร์) · ไม่มีตัวเรียก/ไม่มีลูกค้า = ทำแบบเดิมในเครื่อง
// ไม่ return ผลลัพธ์ให้ผู้เรียก: ผิดพลาดจะแจ้งด้วย toast (ออร์เดอร์ยังส่งมอบอยู่)
export function awardOrderRemote(order) {
  if (!pointsHook.call) return awardOrder(order)
  if (!order.customerId || !findCustomer(order.customerId) || order.loyalty) return
  const { points, bonus, spins, base } = pointsFor(order)
  return loyaltyQueue(async () => {
    try {
      const r = await pointsHook.call('punpang_award_order', { p_order: order.id, p_points: points, p_bonus: bonus, p_spins: spins, p_base: base }, { order: order.id, customer: order.customerId })
      if (r.error && r.error !== 'already_awarded') showToast(`ให้คะแนนออร์เดอร์ ${order.code} ไม่สำเร็จ: ${PTS_MSG[r.error] || r.error} · ย้อนสถานะแล้วส่งมอบใหม่เพื่อลองอีกครั้ง`, 10000, 'error')
    } catch (e) {
      showToast(`ให้คะแนนออร์เดอร์ ${order.code} ไม่สำเร็จ: ${e?.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'} · ย้อนสถานะแล้วส่งมอบใหม่เพื่อลองอีกครั้ง`, 10000, 'error')
    }
  })
}
// สมุดแต้มผ่านเซิร์ฟเวอร์ (RPC punpang_ledger_apply): รายการหลายอย่างของลูกค้าหนึ่งคนทำในธุรกรรมเดียว · ผิดพลาดทั้งชุดไม่เกิด
const LEDGER_MSG = { lot_missing: 'ไม่พบก้อนคะแนนเดิม', lot_used: 'คะแนนที่คืนให้ถูกใช้ไปแล้ว', dup_id: 'รหัสรายการซ้ำ', no_customer: 'ไม่พบลูกค้า', invalid_op: 'ข้อมูลไม่ถูกต้อง', forbidden: 'ไม่มีสิทธิ์' }
function ledgerRemote(customerId, ops, orderId = null) {
  return loyaltyQueue(async () => {
    try {
      const r = await pointsHook.call('punpang_ledger_apply', { p_customer: customerId, p_ops: ops }, { customer: customerId, order: orderId })
      if (r.error) showToast(`บันทึกคะแนนไม่สำเร็จ: ${LEDGER_MSG[r.error] || r.error} · ตรวจยอดคะแนนลูกค้า`, 10000, 'error')
    } catch (e) {
      showToast(`บันทึกคะแนนไม่สำเร็จ: ${e?.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'} · ตรวจยอดคะแนนลูกค้า`, 10000, 'error')
    }
  })
}
// คืนคะแนนที่ตัดไปตอนใช้เป็นส่วนลดของออร์เดอร์ (ฝั่งเซิร์ฟเวอร์ ตามออร์เดอร์) · ใช้ตอนยกเลิกออร์เดอร์
function serverRemovePoints(order) {
  return loyaltyQueue(async () => {
    try {
      const r = await pointsHook.call('punpang_remove_points', { p_order: order.id }, { order: order.id, customer: order.customerId })
      if (r.error && r.error !== 'none') showToast(`คืนคะแนนที่ใช้ของออร์เดอร์ ${order.code} ไม่สำเร็จ: ${PTS_MSG[r.error] || r.error} · ตรวจยอดคะแนนลูกค้า`, 10000, 'error')
    } catch (e) {
      showToast(`คืนคะแนนที่ใช้ของออร์เดอร์ ${order.code} ไม่สำเร็จ: ${e?.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'} · ตรวจยอดคะแนนลูกค้า`, 10000, 'error')
    }
  })
}

// ย้อนส่งมอบ/ยกเลิก: ถอนแต้ม/สิทธิ์หมุนผ่านเซิร์ฟเวอร์ (ซ้ำได้ปลอดภัย · ไม่มีแต้มค้างอยู่ = ไม่ทำอะไร) · ไม่มีตัวเรียก = undoAward ในเครื่อง
export function undoAwardRemote(order) {
  if (!pointsHook.call) return undoAward(order)
  if (!order.customerId || !findCustomer(order.customerId)) return
  return loyaltyQueue(async () => {
    try {
      const r = await pointsHook.call('punpang_undo_award', { p_order: order.id }, { order: order.id, customer: order.customerId })
      if (r.error) showToast(`ถอนคะแนนออร์เดอร์ ${order.code} ไม่สำเร็จ: ${PTS_MSG[r.error] || r.error} · ตรวจยอดคะแนนลูกค้า`, 10000, 'error')
    } catch (e) {
      showToast(`ถอนคะแนนออร์เดอร์ ${order.code} ไม่สำเร็จ: ${e?.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'} · ตรวจยอดคะแนนลูกค้า`, 10000, 'error')
    }
  })
}
// ถอนคะแนน/สิทธิ์หมุนที่ให้ตอนส่งมอบ (ไม่แตะส่วนลดที่ใช้)
function undoAward(order) {
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
export const CUSTOMER_PAY = { perHour: 5, slipMaxChars: 3000000, noteMax: 200 }
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
    delivery: dv ? { placeName: o.placeName || '', distanceKm: o.distanceKm ?? null, shippingFee: t.shipping, shipFree: o.shipPromo?.free ? o.shipPromo.name : '', ...(owner ? { address: o.address || '', mapUrl: o.mapUrl || '', detail: o.detail || '' } : {}) } : null,
    birthday: owner && o.birthday ? { ...o.birthday } : null,
    items: o.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, unitPrice: i.unitPrice, lines: describeSelections(i, db.optionGroups), note: owner ? i.note || '' : '', workPhotos: (i.workPhotos || []).map((p) => ({ id: p.id, image: p.image, at: p.at })) })),
    photoConsent: photoStatusOf(o),
    total: t.total, paid: t.paid, balance: Math.max(t.balance, 0), discountTotal: t.discountTotal, vat: t.vat, vatRate: t.vatRate, vatMode: t.vatMode,
    refunds: o.status === 'cancelled' ? refundList(o.cancel) : [],
    returns: (o.returns || []).filter((r) => !r.cancelled).map((r) => ({ id: r.id, at: r.at, amount: r.amount, items: r.refunds.map((x) => ({ label: REFUND_METHODS[x.method] || x.method, amount: x.amount, points: x.points ?? null })) })),
    payments: pays, payDue: orderDue(o), unpaidApproved: o.status === 'order_confirmed',
    pay: { block: customerPayBlock(o), room, info: { ...db.shop.payment }, limitPerHour: CUSTOMER_PAY.perHour },
    review: owner && rv ? { rating: rv.rating, status: rv.status } : null,
  }
}

// ออร์เดอร์ตามสิทธิ์ลูกค้า: { token } (ลิงก์ที่ยังไม่หมดอายุ) หรือ { orderId } (ล็อกอินเป็นเจ้าของ) · ไม่เจอ/ไม่มีสิทธิ์ = null (ไม่บอกเหตุผล)
export function ctxOrder(ctx) {
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
// ออร์เดอร์ที่โหลดมาจากเซิร์ฟเวอร์ (ธง _remote: ลิงก์ข้ามเครื่อง/บัญชีลูกค้า) — ฝั่งลูกค้าทำรายการผ่าน Edge Function customer-order (คืน Promise)
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
  if (slip.length > CUSTOMER_PAY.slipMaxChars) return { error: 'ไฟล์สลิปใหญ่เกินไป (ไม่เกิน 2 MB)' }
  const nt = String(note).trim().slice(0, CUSTOMER_PAY.noteMax)
  if (o._remote) return remoteOrderAction(db, ctx, 'pay', { amount: amt, slip, note: nt, paymentId }) // Promise · เซิร์ฟเวอร์บันทึก/ออกเลข PAY
  let p = null
  if (paymentId) {
    p = o.payments.find((x) => x.id === paymentId)
    if (!p || p.status !== 'reported' || p.source === 'customer') return { error: 'ไม่พบยอดที่ร้านแจ้ง' }
    if (p.customerSubmitted) return { error: 'ส่งสลิปของยอดนี้แล้ว รอร้านตรวจสอบ' }
    if (dueState(p) === 'overdue') return { error: 'ยอดนี้เกินกำหนดชำระ กรุณากดขอขยายเวลาก่อน' }
    Object.assign(p, { amount: amt, slip, note: nt, customerSubmitted: true, submittedAt: now(), paidAt: localNow() })
  } else {
    p = { id: uid('pay'), code: numbering.next('PAY'), requested: amt, amount: amt, method: 'โอนเงิน', paidAt: localNow(), slip, note: nt, dueAt: '', extension: null, status: 'reported', source: 'customer', customerSubmitted: true, submittedAt: now(), createdAt: now(), reportedBy: 'customer', confirmedBy: null }
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
  if (o._remote) return remoteOrderAction(db, ctx, 'extend', { paymentId, note }) // Promise
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
// รูปบนการ์ด Messenger: รูปสินค้าแรกของรายการ (https เท่านั้น) · ไม่มี = รูปหน้าร้าน (storefront) · ไม่มีอีก = ไม่ใส่รูป
const isHttps = (u) => typeof u === 'string' && /^https:\/\//i.test(u)
function cardImageOf(items) {
  for (const i of items || []) {
    const r = i.kind === 'retail' ? db.retailItems.find((x) => x.id === i.retailId) : null
    const img = (r?.images || []).find(isHttps)
    if (img) return img
  }
  return isHttps(db.storefront?.heroImage) ? db.storefront.heroImage : ''
}
const viewCardOf = (order, url) => viewCard(order, { title: `ส่งมอบแล้ว · ${order.code}`, subtitle: 'ขอบคุณที่อุดหนุนค่ะ', url, image: cardImageOf(order.items) })
// การ์ดปุ่ม "ดูออร์เดอร์" ทั่วไปของข้อความที่เกี่ยวกับออร์เดอร์ (บรรทัดรอง = ยอดรวม/คงค้าง)
const orderLinkCardOf = (order, url) => {
  const t = orderTotals(order)
  return viewCard(order, { title: 'ออร์เดอร์ ' + order.code, subtitle: 'ยอดรวม ' + money(t.total) + ' · ' + (t.balance > 0.004 ? 'คงค้าง ' + money(t.balance) : 'ชำระครบแล้ว'), url, image: cardImageOf(order.items) })
}
const payCardOf = (order, totals, paid, url) => payCard(order, totals, { paid, url, image: cardImageOf(order.items) })
export function sendOrderLinkToChat(order, url) {
  const chat = (order.chatId && findChat(order.chatId)) || chatFor(order.customerId)
  if (!chat) return { error: 'ลูกค้าคนนี้ยังไม่มีแชท' }
  sendChat(chat.id, 'staff', `ดูออร์เดอร์ ${order.code} ได้ที่ลิงก์นี้ค่ะ (ใช้ดูอย่างเดียว) ${url}`, { orderId: order.id, by: session.role, fbCard: linkCardMsg(order, url, db.shop.name, { image: cardImageOf(order.items) }) })
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
  const remote = !!pointsHook.call
  if (order.pointsUsed) {
    // โหมดเซิร์ฟเวอร์: คืนคะแนนที่ใช้ให้ผู้ซื้อเดิม (ตามรายการ takes) · ไม่ผ่านออร์เดอร์เพราะผู้ซื้อในออร์เดอร์กำลังจะเปลี่ยน
    if (remote) { if (from) ledgerRemote(from.id, [{ op: 'refund_spend', entryId: order.pointsUsed.entryId, reason: `คืนคะแนน ${order.code} (เปลี่ยนผู้ซื้อ)` }], order.id); order.pointsUsed = null }
    else removePoints(order)
  }
  for (const u of [...(order.couponsUsed || [])]) removeCoupon(order, u.couponId)
  const l = order.loyalty
  if (l && from && remote) {
    const lid = l.points > 0 ? uid('pt') : null
    const cutOps = [...(l.lotId ? [{ op: 'cut', lotId: l.lotId, reason: `โอนคะแนน ${order.code} ไปผู้ซื้อใหม่`, orderId: order.id }] : []), ...(l.spins ? [{ op: 'spins', delta: -l.spins }] : [])]
    if (cutOps.length) ledgerRemote(from.id, cutOps, order.id)
    const earnOps = [...(lid ? [{ op: 'earn', id: lid, points: l.points, reason: `โอนมาจากออร์เดอร์ ${order.code}`, orderId: order.id }] : []), ...(l.spins ? [{ op: 'spins', delta: l.spins }] : [])]
    if (earnOps.length) ledgerRemote(to.id, earnOps, order.id)
    order.loyalty = { ...l, lotId: lid }
  } else if (l && from) {
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
  if (order.status === 'delivered' && !order.loyalty) awardOrderRemote(order) // บิลที่ไม่เคยมีสมาชิก
  return { ok: true, ...pv }
}

// ---------- ฝั่งลูกค้า: แลกของ / หมุนกาชา ----------
export function redeemReward(c, rewardId) {
  const rw = db.rewards.find((x) => x.id === rewardId && x.active !== false)
  if (!rw || !spendPoints(c, rw.points, `แลก ${rw.name}`)) return null
  // คูปองส่วนลด: นำไปใช้ที่ POS/ออร์เดอร์ (มีขั้นต่ำ/อายุตามที่ตั้ง) · ของรางวัล: รับที่ร้าน
  if (rw.kind === 'coupon') {
    return newCoupon(c, { type: 'discount', rewardId: rw.id, points: rw.points, name: rw.name, amount: Number(rw.amount) || 0, minSpend: Number(rw.minSpend) || 0, source: 'redeem', ...(Number(rw.validDays) > 0 ? { expiresAt: addDays(today(), Number(rw.validDays)) } : {}) })
  }
  return newCoupon(c, { type: 'reward', rewardId: rw.id, points: rw.points, name: rw.name, source: 'redeem' })
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
// โหมด Supabase (ลูกค้าที่ล็อกอินแล้ว): แลก/หมุนทำบนเซิร์ฟเวอร์ แล้วรีเฟรชข้อมูลลูกค้าในเครื่อง · ไม่ใช่โหมดนี้ให้ใช้ redeemReward/spinGacha เดิม
export const usesServerLoyalty = () => remoteCust()
export async function redeemRewardRemote(rewardId) {
  const r = await callLoyalty('redeem', { session: readSessionToken(), rewardId })
  if (r.error) return { error: r.error }
  injectBundle(db, r)
  return { ok: true, coupon: r.result?.coupon || null }
}
export async function spinGachaRemote(usePoints) {
  const r = await callLoyalty('spin', { session: readSessionToken(), usePoints: !!usePoints })
  if (r.error) return { error: r.error }
  injectBundle(db, r)
  return { ok: true, prize: r.result?.prize || null }
}

// ---------- คูปอง/ของรางวัลที่ร้าน: ลูกค้าต้องกด "ใช้ที่ร้านตอนนี้" ในระบบลูกค้าก่อน จึงจะขึ้นบน POS (ยืนยันว่าลูกค้าทำรายการเอง) ----------
// ครบเวลา (db.loyalty.activationMin นาที) โดยร้านยังไม่มอบ/ใช้ = ถือว่าใช้ไปแล้ว (lapsed ใช้ซ้ำไม่ได้)
export const phaseOfCoupon = (cp, nowIso = now()) => couponPhase(cp, today(), nowIso)
export function sweepCoupons(nowIso = now()) {
  let n = 0
  for (const cp of db.coupons) {
    if (cp.status === 'pending' && cp.activatedUntil && cp.activatedUntil <= nowIso) { Object.assign(cp, { status: 'lapsed', lapsedAt: nowIso }); n++ }
  }
  return n
}
export const activeCouponsOf = (c, nowIso = now()) => customerCoupons(c).filter((x) => phaseOfCoupon(x, nowIso) === 'active')
// POS เห็นเฉพาะที่ลูกค้ากดแสดงอยู่
export const posCoupons = (c, nowIso = now()) => activeCouponsOf(c, nowIso).filter((x) => x.type === 'discount')
export const pendingRewards = (c, nowIso = now()) => activeCouponsOf(c, nowIso).filter((x) => x.type === 'reward')
// จำนวนที่ลูกค้ามีแต่ยังไม่ได้กดแสดง (ไว้บอกพนักงานให้ลูกค้ากดเอง)
export const notShownCount = (c, nowIso = now()) => customerCoupons(c).filter((x) => phaseOfCoupon(x, nowIso) === 'pending').length
// ฝั่งลูกค้า: กด "ใช้ที่ร้านตอนนี้" (ต้องล็อกอิน · เป็นเจ้าของ · ยกเลิกไม่ได้)
export function activateCouponAtStore(couponId) {
  sweepCoupons()
  const c = myCustomer()
  const cp = db.coupons.find((x) => x.id === couponId)
  if (!c || !cp || cp.customerId !== c.id) return { error: 'ไม่พบคูปอง' }
  const ph = phaseOfCoupon(cp)
  const msg = { active: 'แสดงที่ร้านอยู่แล้ว', lapsed: 'หมดเวลาแล้ว (ถือว่าใช้ไปแล้ว)', delivered: 'ใช้/รับไปแล้ว', used: 'ใช้ไปแล้ว', refunded: 'ใช้ไม่ได้ (ร้านคืนคะแนนแล้ว)', expired: 'หมดอายุแล้ว' }[ph]
  if (msg) return { error: msg }
  const min = Math.min(120, Math.max(1, Math.round(Number(db.loyalty.activationMin) || 15)))
  const at = now()
  Object.assign(cp, { activatedAt: at, activatedUntil: new Date(Date.now() + min * 60e3).toISOString() })
  notify('team_coupon_shown', { vars: { ชื่อลูกค้า: c.name, รายการ: cp.name, นาที: String(min) } })
  return { ok: true, coupon: cp, minutes: min }
}
// POS: ตรวจก่อนขาย (กดช้าจนหมดเวลา/ไม่ใช่ของลูกค้า/ยังไม่ได้กดแสดง) · คืนข้อความผิดพลาด หรือ ''
export function posCouponProblem({ customerId, couponIds = [] }) {
  sweepCoupons()
  for (const id of couponIds) {
    const cp = db.coupons.find((x) => x.id === id)
    if (!cp || cp.type !== 'discount' || cp.customerId !== customerId) return 'คูปองไม่ถูกต้อง'
    if (phaseOfCoupon(cp) !== 'active') return `คูปอง ${cp.name} หมดเวลาแสดงแล้ว (ถือว่าใช้แล้ว) หรือลูกค้ายังไม่ได้กดใช้ที่ร้าน`
  }
  return ''
}
// POS: มอบของรางวัลที่ลูกค้ากดแสดงอยู่ (= ใช้แล้ว หายจากจอ)
export function posHandOver(customerId, couponId) {
  if (!can('useLoyalty')) return { error: 'ไม่มีสิทธิ์' }
  sweepCoupons()
  const c = findCustomer(customerId)
  const cp = db.coupons.find((x) => x.id === couponId)
  if (!c || !cp || cp.customerId !== c.id || cp.type !== 'reward') return { error: 'ไม่พบของรางวัล' }
  const ph = phaseOfCoupon(cp)
  if (ph !== 'active') return { error: { delivered: 'มอบไปแล้ว', lapsed: 'หมดเวลาแล้ว (ถือว่าใช้ไปแล้ว)', refunded: 'ร้านคืนคะแนนแล้ว', expired: 'หมดอายุแล้ว', pending: 'ลูกค้ายังไม่ได้กด "ใช้ที่ร้านตอนนี้" ในระบบลูกค้า' }[ph] || 'มอบไม่ได้' }
  markCouponDelivered(cp)
  return { ok: true, coupon: cp }
}
// หลังบ้าน: คืนคะแนนตามคูปอง/ของรางวัลที่ไม่ได้ใช้จริง (pending/active/lapsed/expired) · ต้องเหตุผล · สิทธิ์ adjustPoints
export function refundCoupon(couponId, reason, opts = {}) {
  if (!can('adjustPoints')) return { error: 'ไม่มีสิทธิ์' }
  sweepCoupons()
  const cp = db.coupons.find((x) => x.id === couponId)
  if (!cp) return { error: 'ไม่พบคูปอง' }
  const c = findCustomer(cp.customerId)
  if (!c || c.deleted) return { error: 'ไม่พบลูกค้า' }
  if (!String(reason ?? '').trim()) return { error: 'ใส่เหตุผลที่คืนคะแนน' }
  const ph = phaseOfCoupon(cp)
  if (['delivered', 'used'].includes(ph)) return { error: 'ใช้/มอบไปแล้ว คืนคะแนนไม่ได้' }
  if (ph === 'refunded') return { error: 'คืนคะแนนไปแล้ว' }
  const pts = Number(cp.points) || (cp.rewardId && cp.source !== 'gacha' ? Number(db.rewards.find((r) => r.id === cp.rewardId)?.points) || 0 : 0)
  if (!(pts > 0)) return { error: 'ได้จากกาชา/ไม่มีคะแนนที่จ่าย ไม่มีคะแนนให้คืน' }
  const why = `คืนคะแนน ${cp.name} (${String(reason).trim().slice(0, 80)})`
  if (pointsHook.call) { if (Math.round(pts) > 0) ledgerRemote(c.id, [{ op: 'earn', id: uid('pt'), points: Math.round(pts), reason: why }]) }
  else earnPoints(c, pts, why)
  Object.assign(cp, { status: 'refunded', refundedAt: now(), refundedBy: session.role, refundReason: String(reason).trim().slice(0, 200), activatedAt: null, activatedUntil: null })
  if (opts.notify !== false) {
    const rule = db.notifyRules.find((x) => x.event === 'coupon_refunded')
    if (rule?.enabled) notify('coupon_refunded', { customer: c, vars: { ชื่อลูกค้า: c.name, รายการ: cp.name, คะแนน: String(pts) } })
  } else db.outbox.unshift({ id: uid('msg'), at: now(), event: 'coupon_refunded', channel: null, to: c.name, text: '(พนักงานเลือกไม่แจ้งลูกค้า)', orderId: null, status: 'skipped' })
  return { ok: true, points: pts }
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
  // เวลาที่คูปองแสดงที่ร้านหลังลูกค้ากด "ใช้ที่ร้านตอนนี้" (นาที) 1–120
  db.loyalty.activationMin = Number.isFinite(Number(d.activationMin)) && d.activationMin !== '' && d.activationMin != null ? Math.min(120, Math.max(1, Math.round(Number(d.activationMin)))) : 15
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
    ยอดที่ชำระ: extra.paid != null ? money(extra.paid) : '',
    ชำระแล้ว: money(Math.max(t.paid, 0)),
    ชำระก่อน: extra.dueAt ? dueText(extra.dueAt) : 'ไม่กำหนด',
    วันนัด: dateOnly(order.pickupAt),
    เวลานัด: timeOnly(order.pickupAt),
    ส่งมอบ: order.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับ',
    ข้อความรับสินค้า: order.fulfillment === 'delivery' ? '' : `สามารถรับสินค้าได้แล้ว แต่ต้องไม่เกินเวลาร้านปิด ${db.shop.close || ''} น.`,
    เวลาปิดร้าน: db.shop.close || '',
    ข้อความขอใช้ภาพ: hasWorkPhotos(order) && photoStatusOf(order) === 'ok' ? 'ขออนุญาตนำภาพสินค้าของออร์เดอร์นี้ไปใช้เผยแพร่ หากไม่ยินยอมสามารถแจ้งได้เลยค่ะ (กดปุ่ม "ดูออร์เดอร์" แล้วเลือก "ไม่อนุญาตให้ใช้รูปเผยแพร่" หรือพิมพ์แจ้งในแชทนี้)' : '',
    ชื่อวันเกิด: order.birthday?.name || c?.name || '',
    คะแนน: '',
    ลิงก์ออร์เดอร์: '',
  }
}
function pushOut(event, channel, to, text, orderId = null, customer = null, opts = {}) {
  db.outbox.unshift({ id: uid('msg'), at: now(), event, channel, to, text, orderId, status: channel ? 'simulated' : 'no_channel' })
  const row = db.outbox[0]
  // ส่งทาง LINE/Facebook: ลงเธรดของช่องทางนั้นในศูนย์รวมแชทด้วย (สร้างออร์เดอร์ = การ์ดสรุป) · Facebook ส่งถึง Messenger จริงและอัปเดตสถานะของรายการนี้
  const chat = customer && (channel === 'line' || channel === 'facebook') ? chatFor(customer.id, channel) : null
  if (chat) {
    const order = orderId ? findOrder(orderId) : null
    if (event === 'order_created' && order) postOrderCard(order, chat, row)
    else if (opts.card) sendChat(chat.id, 'staff', text, { orderId, by: 'ระบบ', row, fbCard: opts.card })
    else sendChat(chat.id, 'staff', text, { orderId, by: 'ระบบ', row })
  } else if (channel === 'facebook' && customer && fbHook.send) {
    row.status = 'failed'; row.error = 'ลูกค้ายังไม่มีแชท Facebook ที่ผูกไว้'
    emitStaffBell('notify_failed', { text: `${customer.name || 'ลูกค้า'}: ยังไม่มีแชท Facebook ที่ผูกไว้ แจ้งทางอื่นเอง` })
  }
  if (channel === 'sms' && customer?.phone) deliverSms(db.outbox[0], customer.phone, text, 'notify')
  if (channel === 'telegram') deliverTg(db.outbox[0], text, 'notify')
}
// ส่ง SMS จริงผ่านเกตเวย์ (ตั้งโดยชั้นเชื่อม Supabase) · ไม่มีตัวส่ง = คงสถานะจำลองไว้
export const smsHook = { send: null }
function deliverSms(row, number, text, kind) {
  if (!smsHook.send) return
  row.status = 'sending'
  // คีย์กันส่งซ้ำ: ผูกกับแถวคิวเดิม ลองใหม่กี่ครั้งก็ใช้คีย์เดิม (เกตเวย์ไม่สร้างงานซ้ำ)
  row.idem ??= 'ob' + (globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}${Math.random().toString(36).slice(2)}`)
  smsHook.send(number, text, kind, row.idem).then((r) => { row.status = r.ok ? 'sent' : 'failed'; if (!r.ok) row.error = r.error || '' }, () => { row.status = 'failed' })
}
// ส่ง Telegram จริงเข้ากลุ่มทีม (Edge Function telegram-send · token/chat id เป็น secret ฝั่งเซิร์ฟเวอร์) · ไม่มีตัวส่ง = คงสถานะจำลองไว้
export const tgHook = { send: null }
function deliverTg(row, text, kind) {
  if (!tgHook.send) return
  row.status = 'sending'
  tgHook.send(text, kind).then((r) => { row.status = r.ok ? 'sent' : 'failed'; if (!r.ok) row.error = r.error || '' }, () => { row.status = 'failed' })
}
// ---------- กระดิ่งแจ้งเตือนในแอป ----------
function bellPush(item) {
  db.bell.unshift({ id: uid('bl'), at: now(), ...item })
  if (db.bell.length > BELL_MAX) db.bell.length = BELL_MAX
}
// เรียกที่ต้น notify() — ไม่ขึ้นกับกฎ/ช่องทางเปิดปิด
function emitBell(event, { customer = null, vars = {}, orderId = null } = {}) {
  const ev = NOTIFY_EVENTS[event]
  if (!ev) return
  if (ev.audience === 'team') {
    const d = BELL_STAFF[event]
    if (!d) return
    bellPush({ audience: 'staff', event, title: d.title, text: bellText(event, vars), orderId, readBy: [] })
    return
  }
  const d = BELL_CUSTOMER[event]
  if (!d || !customer || customer.deleted) return
  if (d.marketing && customer.promoOptIn === false) return
  bellPush({ audience: 'customer', customerId: customer.id, event, title: d.title, text: bellText(event, vars), orderId, read: false })
}
// แชท/คำขอระบบที่ไม่ผ่าน notify()
function emitStaffBell(event, { text = '', chatId = null, orderId = null } = {}) {
  const d = BELL_STAFF[event]
  if (!d) return
  bellPush({ audience: 'staff', event, title: d.title, text, chatId, orderId, readBy: [] })
}
// ข้อความแชทใหม่จากลูกค้า: ยุบรายการที่ยังไม่มีใครอ่านของแชทเดียวกันเป็นรายการเดียว
function emitChatBell(chat, text) {
  const t = `${chat.profileName || 'ลูกค้า'}: ${String(text).slice(0, 60)}`
  const old = db.bell.find((i) => i.audience === 'staff' && i.event === 'chat_inbound' && i.chatId === chat.id && !i.readBy.length)
  if (old) {
    old.count = (old.count || 1) + 1
    old.text = `${t}${old.count > 1 ? ` (+${old.count - 1})` : ''}`
    old.at = now()
    db.bell.splice(db.bell.indexOf(old), 1)
    db.bell.unshift(old)
    return
  }
  emitStaffBell('chat_inbound', { text: t, chatId: chat.id })
}
// รายการของผู้ใช้ปัจจุบัน: audience 'staff' = ตามสิทธิ์ของ session · 'customer' = ของลูกค้าที่ล็อกอิน
export function bellFeed(audience = 'staff') {
  if (audience === 'customer') return visibleToCustomer(db.bell, customerSession.customerId)
  return visibleToStaff(db.bell, can)
}
export const bellIsRead = (item, audience = 'staff') => (audience === 'customer' ? !!item.read : isReadStaff(item, session.userId))
export function bellUnreadCount(audience = 'staff') {
  return audience === 'customer' ? unreadCustomer(db.bell, customerSession.customerId) : unreadStaff(db.bell, session.userId, can)
}
export function bellMarkRead(id, audience = 'staff') {
  const i = db.bell.find((x) => x.id === id)
  if (!i) return
  if (audience === 'customer') {
    if (i.audience === 'customer' && i.customerId === customerSession.customerId) i.read = true
  } else if (i.audience === 'staff' && !i.readBy.includes(session.userId)) i.readBy.push(session.userId)
}
export function bellMarkUnread(id, audience = 'staff') {
  const i = db.bell.find((x) => x.id === id)
  if (!i) return
  if (audience === 'customer') {
    if (i.audience === 'customer' && i.customerId === customerSession.customerId) i.read = false
  } else if (i.audience === 'staff') i.readBy = i.readBy.filter((u) => u !== session.userId)
}
export function bellMarkAll(audience = 'staff') {
  for (const i of bellFeed(audience)) bellMarkRead(i.id, audience)
}
// ช่องทางที่อนุญาตต่อ event: ออร์เดอร์ > ลูกค้า > ระบบ (กฎของ event) · คีย์ที่ไม่ได้ตั้ง = สืบทอดระดับถัดไป
// คืน { line, facebook, sms } (true=อนุญาต) และ src = ระดับที่ตัดสินแต่ละช่อง ('order' | 'customer' | 'system')
export function effectiveChannels(rule, customer = null, order = null) {
  const out = {}, src = {}
  for (const k of CUSTOMER_CHANNEL_ORDER) {
    const o = order?.notifyChannels?.[k], c = customer?.notifyChannels?.[k]
    if (typeof o === 'boolean') { out[k] = o; src[k] = 'order' } else if (typeof c === 'boolean') { out[k] = c; src[k] = 'customer' } else { out[k] = !!rule?.channels?.includes(k); src[k] = 'system' }
  }
  return { ...out, src }
}
// ตั้งช่องทางของออร์เดอร์/ลูกค้า: value = true/false หรือ null (ตามระดับถัดไป) · 
function setNotifyCh(target, ch, value) {
  const cur = { ...(target.notifyChannels || {}) }
  if (typeof value === 'boolean') cur[ch] = value; else delete cur[ch]
  target.notifyChannels = cur // เก็บ {} ได้ (ฟอร์มบันทึกด้วยการ merge จึงต้องมีคีย์เสมอ เพื่อให้ "ตามเดิม" ล้างค่าเก่าได้)
}
export const setOrderNotifyChannel = (order, ch, value) => setNotifyCh(order, ch, value)
export const setCustomerNotifyChannel = (customer, ch, value) => setNotifyCh(customer, ch, value)
// ส่งตามกฎของ event (คืนจำนวนข้อความที่เข้าคิว)
export function notify(event, { customer = null, vars = {}, orderId = null, noSms = false, card = null } = {}) {
  emitBell(event, { customer, vars, orderId })
  const r = db.notifyRules.find((x) => x.event === event)
  const ev = NOTIFY_EVENTS[event]
  if (!r || !r.enabled || !ev) return 0
  // ข้อความถึงลูกค้าที่เกี่ยวกับออร์เดอร์ (ไม่ใช่การตลาด) ต้องมีลิงก์ดูออร์เดอร์เสมอ · เทมเพลตไม่มีลิงก์ → ต่อท้ายเป็นบรรทัด "ดูออร์เดอร์: <ลิงก์>"
  const order = orderId ? findOrder(orderId) : null
  const orderMsg = ev.audience === 'customer' && !ev.marketing && !!order && order.channel !== 'pos'
  const url = vars.ลิงก์ออร์เดอร์ || (orderMsg ? createOrderLink(order, { system: true }).url || '' : '')
  const tpl = tplOf(r)
  const body = fillTemplate(tpl, { ...vars, ลิงก์ออร์เดอร์: url }).replace(/\n{2,}/g, '\n').trim() // ตัวแปรที่ว่างไม่ทิ้งบรรทัดเปล่า
  const text = url && !tpl.includes('{ลิงก์ออร์เดอร์}') ? `${body}\nดูออร์เดอร์: ${url}` : body
  if (ev.audience === 'team') {
    if (!r.channels.includes('telegram') || !db.integrations.telegram.enabled) return 0
    pushOut(event, 'telegram', 'กลุ่มทีม', text, orderId)
    return 1
  }
  if (ev.marketing && customer && customer.promoOptIn === false) return 0
  const allowed = effectiveChannels(r, customer, orderId ? findOrder(orderId) : null)
  const ch = CUSTOMER_CHANNEL_ORDER.find((k) => allowed[k] && db.integrations[k]?.enabled && customerAddr(customer, k))
  const to = ch ? `${CHANNELS[ch].label}: ${customer?.name || ''}${ch === 'sms' ? ` (${formatPhone(customer.phone)})` : ''}` : customer?.name || '-'
  // ส่งทางแชท (Facebook/LINE) ที่มีการ์ดพร้อมปุ่ม: ตัดบรรทัดลิงก์ออกจากข้อความ (ปุ่มทำหน้าที่แทน) · SMS ยังได้ข้อความเต็มพร้อมลิงก์
  // Facebook: การ์ดปุ่ม "ดูออร์เดอร์" (card ที่ส่งมา หรือการ์ดลิงก์ที่สร้างให้) · ข้อความบนการ์ดตัดบรรทัดลิงก์ออก เพราะปุ่มทำหน้าที่แทน · LINE/SMS ได้ข้อความที่มีลิงก์
  const fbCard = ch === 'facebook' ? (card || (orderMsg && url ? orderLinkCardOf(order, url) : null)) : null
  const chatText = fbCard && url ? fillTemplate(tpl, { ...vars, ลิงก์ออร์เดอร์: '' }).replace(/\s*(ดูออร์เดอร์|ดู\/ชำระที่|ชำระที่|ดูได้ที่)\s*:?\s*$/, '').replace(/\n{2,}/g, '\n').trim() : text
  pushOut(event, ch || null, to, chatText, orderId, customer, fbCard ? { card: { text: chatText, card: fbCard } } : {})
  // ส่งทาง Facebook/LINE แล้ว ถ้าลูกค้ามีเบอร์ → ส่ง SMS ซ้ำด้วยเสมอ (พนักงานติ๊กออกได้ที่หน้าที่ส่ง) · ใช้เฉพาะ event ที่กฎเปิด SMS ไว้
  if ((ch === 'facebook' || ch === 'line') && !noSms && !ev.marketing && customer?.phone && allowed.sms && db.integrations.sms?.enabled) {
    pushOut(event, 'sms', `${CHANNELS.sms.label}: ${customer.name || ''} (${formatPhone(customer.phone)})`, text, orderId, customer)
  }
  return 1
}
// เหตุการณ์ของออร์เดอร์ → ลูกค้า + ทีม (ถ้ามีคู่ของทีม)
export function notifyOrder(event, order, extra = {}) {
  if (order.channel === 'pos') return // บิลหน้าร้านไม่แจ้งเตือน
  const vars = orderVars(order, extra)
  // พนักงานติ๊ก "ไม่แจ้งลูกค้า": ไม่ส่งหาลูกค้า (ทีมยังได้รับตามปกติ) · บันทึกไว้ในคิวว่าถูกข้าม เพื่อไล่ตรวจย้อนหลังได้
  if (extra.skip) {
    const r0 = db.notifyRules.find((x) => x.event === event)
    if (r0?.enabled && NOTIFY_EVENTS[event]?.audience === 'customer') db.outbox.unshift({ id: uid('msg'), at: now(), event, channel: null, to: findCustomer(order.customerId)?.name || '-', text: '(พนักงานเลือกไม่แจ้งลูกค้า)', orderId: order.id, status: 'skipped' })
    if (TEAM_OF[event]) notify(TEAM_OF[event], { vars, orderId: order.id })
    return
  }
  const rule = db.notifyRules.find((x) => x.event === event)
  // ลิงก์ดูออร์เดอร์ของทุกข้อความลูกค้าที่เกี่ยวกับออร์เดอร์ (ออร์เดอร์ร่าง/POS สร้างลิงก์ไม่ได้)
  const url = rule?.enabled && NOTIFY_EVENTS[event]?.audience === 'customer' && !NOTIFY_EVENTS[event]?.marketing ? createOrderLink(order, { system: true }).url || '' : ''
  vars.ลิงก์ออร์เดอร์ = url
  const customer = findCustomer(order.customerId)
  const card = event === 'payment_confirmed' ? payCardOf(order, orderTotals(order), extra.paid, url) : event === 'delivered' ? viewCardOf(order, url) : null
  notify(event, { customer, vars, orderId: order.id, noSms: !!extra.noSms, card })
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
  if (!asked.some((p) => p.status === 'reported')) return // ยังไม่เคยแจ้งชำระ (ไม่มีงวดที่แจ้งไว้)
  if (o.payments.some((p) => p.status === 'confirmed') || orderTotals(o).paid > 0) return // มีการชำระแล้ว
  if (o.payments.some((p) => p.status === 'reported' && (p.slip || p.source === 'customer'))) return // ลูกค้าแจ้งโอนแล้ว รอตรวจ
  if (orderTotals(o).balance <= 0) return
  const open = asked.filter((p) => p.status === 'reported').sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0]
  once(`payrem|${o.id}|${tmrStr}`, () => { notifyOrder('payment_reminder', o, { dueAt: open?.dueAt || '' }); return 1 })
}
// จำลองรอบตรวจตามเวลา (ของจริงใช้ cron): เตือนนัดรับ 24 ชม., งานใกล้เวลา 2 ชม., วันเกิด, คะแนนใกล้หมดอายุ · ส่งครั้งเดียวต่อ key
// ตัวตรวจตามเวลาจากโมดูลอื่น (เช่นบัญชี) ลงทะเบียนที่นี่ — store ไม่ import โมดูลเหล่านั้นเพื่อกัน import วน
export const scheduledHooks = []
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
    if (toPickup > 0 && toPickup <= 24 * 3600e3) once(`pickup|${o.id}`, () => { notifyOrder('pickup_reminder', o); return 1 })
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
  sweepCoupons()
  for (const h of scheduledHooks) n += h(once, today) || 0
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
  if (from === 'staff' && c.channel === 'facebook') {
    if (m.kind === 'text') {
      if (extra.fbCard) deliverFb(c, m, extra.fbCard.text, extra.row, { card: extra.fbCard.card })
      else deliverFb(c, m, m.text, extra.row)
    } else if (m.kind === 'order') { const o = findOrder(m.orderId); if (o) { const lk = o.status !== 'draft' && o.channel !== 'pos' ? createOrderLink(o, { system: true }) : null; const k = orderCardMsg(o, orderTotals(o), db.shop.name, { image: cardImageOf(o.items), url: lk?.url }); deliverFb(c, m, k.text, extra.row, { card: k.card }) } }
    else if (m.kind === 'quote') { const q = findQuote(m.quoteId); if (q) { const k = quoteCardMsg(q, orderTotals({ ...q.payload, payments: [], adjustment: null, couponsUsed: [] }), db.shop.name, { image: cardImageOf(q.payload?.items) }); deliverFb(c, m, k.text, extra.row, { quoteId: q.id, card: k.card }) } }
  }
  return m
}
// ส่ง Messenger จริงเมื่อพนักงาน/บอท/ระบบตอบในแชท Facebook (ผ่าน Edge Function fb-send · ตั้งโดยชั้นเชื่อม Supabase) · ไม่มีตัวส่ง = คงสถานะจำลอง
export const fbHook = { send: null }
function deliverFb(chat, m, text = m.text, row = null, opts = {}) {
  if (!fbHook.send || !m || !chat.externalId) return
  const fail = (err) => {
    m.delivery = 'failed'; m.deliveryError = err || ''
    if (row) { row.status = 'failed'; row.error = err || '' }
    // ข้อความอัตโนมัติของระบบ (แจ้งลูกค้า) ส่งไม่ถึง → เตือนพนักงานให้ตามเอง
    if (m.by === 'ระบบ') emitStaffBell('notify_failed', { text: `${chat.profileName || 'ลูกค้า'}: ส่งทาง Facebook ไม่สำเร็จ${err ? ` (${err})` : ''}`, chatId: chat.id })
  }
  if (!fbWindowOpen(chat)) return fail('เกิน 24 ชั่วโมงหลังลูกค้าทักล่าสุด ส่งทาง Messenger ไม่ได้')
  m.delivery = 'sending'
  if (row) row.status = 'sending'
  fbHook.send(chat.externalId, text, opts).then((r) => {
    if (!r.ok) return fail(r.error)
    m.delivery = 'sent'
    if (row) row.status = 'sent'
  }, () => fail('เชื่อมต่อไม่ได้'))
}
// ข้อความเข้าจาก LINE/Facebook (ของจริงมาจาก webhook) · ผูกอัตโนมัติถ้า userId/PSID ตรงกับลูกค้า
// ถ้ามีคำถามค้าง (ปุ่มถาม) ข้อความนี้ = คำตอบ → ผูกกับคำถามและกรอกลงร่างอัตโนมัติ
export function receiveMessage(channel, externalId, profileName, text, at = null) {
  const c = db.chats.find((x) => x.channel === channel && x.externalId === externalId) || newChat(channel, externalId, profileName)
  if (profileName) c.profileName = profileName
  const ask = c.pendingAsk
  const parsed = ask ? parseAnswer(ask.field, text) : null
  const m = sendChat(c.id, 'customer', text, { at, ...(ask ? { replyTo: ask.messageId, answerFor: ask.field } : {}) })
  if (m) emitChatBell(c, text)
  if (ask && parsed) {
    m.filled = applyToDraft(c.id, parsed)
    c.pendingAsk = null
  } else runBot(c, m)
  return c
}
// ข้อความจริงที่ webhook เขียนลงฐานข้อมูลแล้ว (ไม่ผ่าน receiveMessage ซึ่งเป็นของตัวจำลอง) → ทำส่วนที่เหลือแบบเดียวกัน: ตอบคำถามค้าง หรือเรียกบอท
// ผู้เรียกต้อง "จองสิทธิ์" ข้อความนี้ในฐานข้อมูลก่อน (กันหลายแท็บ/หลายพนักงานตอบซ้ำ) · ข้อความที่มีไฟล์แนบไม่ผ่านบอท (ให้พนักงานดูเอง)
export function processInbound(chatId, mid) {
  const c = findChat(chatId)
  if (!c || c.channel !== 'facebook' || !mid) return null
  const m = c.messages[c.messages.length - 1]
  if (!m || m.from !== 'customer' || m.fbMid !== mid) return null // มีข้อความใหม่กว่าแล้ว หรือไม่ใช่ข้อความนี้
  if (m.noBot || m.attachments?.length || !String(m.text || '').trim()) return null
  const ask = c.pendingAsk
  const parsed = ask ? parseAnswer(ask.field, m.text) : null
  if (ask) { m.replyTo = ask.messageId; m.answerFor = ask.field }
  if (ask && parsed) {
    m.filled = applyToDraft(c.id, parsed)
    c.pendingAsk = null
  } else runBot(c, m)
  return m
}

// ---------- บอทตอบแชท ----------
// ทำงานเมื่อมีข้อความจากลูกค้า (LINE/Facebook): suggest = เก็บร่างให้พนักงานกดส่ง · auto = ส่งเองหลังหน่วงเวลา (Facebook ต้องอยู่ในหน้าต่าง 24 ชม.)
// ไม่แน่ใจ/เรื่องเงิน/ร้องเรียน/ยืนยันตัวตนไม่ได้ → ส่งต่อพนักงาน + แจ้ง Telegram · ข้อความลูกค้าประมวลผลในเบราว์เซอร์เท่านั้น
// Facebook: บอทฝั่งเซิร์ฟเวอร์ (fb-webhook/bot.ts) ตอบแทนแล้ว → เบราว์เซอร์ไม่ตอบซ้ำ · LINE/อื่น ๆ ยังทำงานในเบราว์เซอร์
const SERVER_BOT_CHANNELS = ['facebook']
const botOn = (c) => db.bot.enabled && db.bot.mode !== 'off' && !SERVER_BOT_CHANNELS.includes(c.channel) && !!db.bot.channels[c.channel] && !c.botOff
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
// ส่งเองได้เมื่อประเภทนั้นตั้งเป็นตอบเอง (ประเภทล็อกส่งเองไม่ได้) และ Facebook ยังอยู่ในหน้าต่าง 24 ชม.
const autoFor = (c, source) => !LOCKED_SOURCES.includes(source) && (db.bot.sourceModes?.[source] || db.bot.mode) === 'auto' && fbWindowOpen(c)
export function runBot(c, m) {
  if (!m || m.kind !== 'text' || !botOn(c)) return null
  const notice = closedNoticeFor(c, m)
  let auto = false // ตัดสินหลังรู้ประเภทคำตอบ (ดูด้านล่าง)
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
  auto = autoFor(c, res.source)
  c.botDraft = null
  c.botHandoff = false
  if (res.handoff) {
    db.bot.stats.handoff++
    c.botHandoff = true
    emitStaffBell('bot_handoff', { text: `${c.profileName || 'ลูกค้า'}: ${res.reason || ''}`.trim(), chatId: c.id })
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
    emitStaffBell('bot_handoff', { text: `${c.profileName || 'ลูกค้า'}: ความมั่นใจต่ำ`, chatId: c.id })
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
  b.sourceModes = Object.fromEntries(AUTO_SOURCES.map((k) => [k, d.sourceModes?.[k] === 'auto' ? 'auto' : 'suggest']))
  b.channels = { line: !!d.channels?.line, facebook: !!d.channels?.facebook }
  b.confidence = Math.min(0.95, Math.max(0.3, Number(d.confidence) || 0.6))
  b.delaySec = Math.min(60, Math.max(0, Math.round(Number(d.delaySec) || 0)))
  b.offHours = { enabled: !!d.offHours?.enabled, text: String(d.offHours?.text ?? '').trim().slice(0, 300) || BOT_DEFAULTS.offHours.text }
  b.closedNotice = { enabled: !!d.closedNotice?.enabled, text: String(d.closedNotice?.text ?? '').trim().slice(0, 300) || BOT_DEFAULTS.closedNotice.text }
  b.handoff = { notifyTelegram: !!d.handoff?.notifyTelegram, text: String(d.handoff?.text ?? '').trim().slice(0, 300) || BOT_DEFAULTS.handoff.text }
  const ai = d.ai || {}
  b.ai = {
    enabled: !!ai.enabled,
    provider: 'anthropic', // รองรับ Claude API ก่อน · ผู้ให้บริการอื่นเพิ่มภายหลังในเซิร์ฟเวอร์
    model: String(ai.model ?? '').trim().slice(0, 80) || BOT_DEFAULTS.ai.model,
    mode: ai.mode === 'auto' ? 'auto' : 'suggest',
    dailyLimit: Math.min(1000, Math.max(0, Math.round(Number(ai.dailyLimit) || 0))),
    maxTokens: Math.min(1024, Math.max(50, Math.round(Number(ai.maxTokens) || BOT_DEFAULTS.ai.maxTokens))),
  }
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
// Telegram: bot token + chat id (จำลอง ไม่ยิง API จริง · เก็บเฉพาะ 4 ตัวท้ายของ token) · SMS ไม่มีฟอร์ม: ค่าอยู่ที่ Supabase secrets
export function connectTelegram({ token, chatId }) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const c = checkTelegram(token, chatId)
  if (c.error) return c
  connectIntegration('telegram', { accountName: 'บอททีม', accountId: c.chatId, tokenHint: c.token.slice(-4) })
  return { ok: true }
}
// ส่งข้อความทดสอบ (Telegram: ส่งจริงถ้าตั้ง secret · SMS ทดสอบที่หน้า /admin/settings/sms)
export function sendIntegrationTest(key) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const it = db.integrations[key]
  if (!it || it.status !== 'connected') return { error: 'ยังไม่ได้เชื่อม' }
  if (key !== 'telegram') return { error: 'ช่องทางนี้ทดสอบที่หน้า SMS Gateway' }
  const text = `[ทดสอบ] ข้อความทดสอบจาก ${db.shop.name} · ${dateOnly(now())} ${timeOnly(now())}`
  const toLabel = 'กลุ่มทีม'
  db.outbox.unshift({ id: uid('msg'), at: now(), event: 'test', channel: key, to: toLabel, text, orderId: null, status: 'simulated' })
  deliverTg(db.outbox[0], text, 'test')
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
  if (cu.error) return cu
  linkChat(chatId, cu.id)
  return cu
}
// การ์ดสรุปออร์เดอร์ในแชท (แชทของออร์เดอร์ ถ้าไม่มีใช้แชทล่าสุดของลูกค้า)
export function postOrderCard(order, chat = null, row = null) {
  const c = chat || (order.chatId ? findChat(order.chatId) : chatFor(order.customerId))
  if (!c) return
  if (!order.chatId) order.chatId = c.id
  sendChat(c.id, 'staff', '', { kind: 'order', orderId: order.id, by: 'ระบบ', row })
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
    birthday: draft.birthday || null, ...(() => { const w = withPromos(draft.items.filter((i) => !i.promoGift).map((i) => priceItem(i))); return { items: w.items, shipPromo: w.shipPromo, promoOn: true } })(), vat: vatNow(),
  }))
  const q = { id: uid('qt'), code: numbering.next('QT'), chatId, customerId: c.customerId, payload, status: 'pending', orderId: null, createdAt: now(), respondedAt: null }
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
  if (!q || !['need_phone', 'customer_ok', 'converting'].includes(q.status)) return { error: 'ใบเสนอนี้ใช้ไม่ได้แล้ว' }
  const block = chatOrderBlock(q.chatId)
  if (block) return { error: block }
  if (new Date(q.payload.pickupAt) <= new Date()) return { error: 'เวลานัดผ่านแล้ว ส่งใบเสนอใหม่' }
  const o = quoteToOrder(q)
  return o.error ? { error: o.error } : { order: o }
}
// ลูกค้ากดยืนยันใบเสนอบน Messenger (webhook ตั้ง customer_ok · ผู้เรียกจองสิทธิ์ใน DB แล้ว = converting) → สร้างออร์เดอร์ ถ้ายังไม่ผูก/ไม่มีเบอร์ → ขอเบอร์ รอพนักงาน
// (ข้อความ "ยืนยัน" และคำตอบลูกค้าลงแชทโดย webhook แล้ว ที่นี่ไม่ส่งซ้ำ)
export function processQuoteConfirm(quoteId) {
  const q = findQuote(quoteId)
  if (!q || !['customer_ok', 'converting'].includes(q.status)) return null
  if (new Date(q.payload.pickupAt) <= new Date()) {
    q.status = 'revise'
    sendChat(q.chatId, 'staff', 'ใบเสนอนี้เลยเวลานัดแล้วค่ะ รบกวนแจ้งวันเวลาใหม่ ร้านจะส่งใบเสนอให้ใหม่นะคะ', { by: 'ระบบ' })
    return { expired: true }
  }
  if (chatOrderBlock(q.chatId)) {
    q.status = 'need_phone'
    sendChat(q.chatId, 'staff', 'ขอบคุณค่ะ รบกวนแจ้งชื่อและเบอร์โทรเพื่อยืนยันออร์เดอร์นะคะ', { by: 'ระบบ' })
    return { needPhone: true }
  }
  const o = quoteToOrder(q)
  if (o.error) { q.status = 'need_phone'; return { error: o.error } } // สร้างไม่ได้ → ให้พนักงานกดสร้างเอง
  return { order: o }
}
export function reviseQuote(quoteId, note = '') {
  const q = findQuote(quoteId)
  if (!q || q.status !== 'pending') return
  Object.assign(q, { status: 'revise', respondedAt: now(), note })
  sendChat(q.chatId, 'customer', `ขอแก้ไขใบเสนอ ${q.code}${note ? `: ${note}` : ''}`)
}

export const unreadChats = () => db.chats.filter((c) => c.unreadStaff > 0).length

// ---------- POS หน้าร้าน ----------
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
  for (const o of live) {
    for (const p of o.payments) if (p.status === 'confirmed') byMethod[p.posMethod || 'cash'] = (byMethod[p.posMethod || 'cash'] || 0) + p.amount
    // คืนเงินบางส่วน: เงินสดหักจากเงินสด · โอนหักจากช่องทางไม่ใช่เงินสดของบิลนั้น (โอน/บัตร) · คืนเป็นคะแนนไม่กระทบยอดรับเงิน
    const rb = returnedByMethod(o)
    if (rb.cash) byMethod.cash = round2((byMethod.cash || 0) - rb.cash)
    if (rb.transfer) {
      const pm = o.payments.find((p) => p.status === 'confirmed' && (p.posMethod || 'cash') !== 'cash')?.posMethod || 'transfer'
      byMethod[pm] = round2((byMethod[pm] || 0) - rb.transfer)
    }
  }
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
// ตะกร้า POS → { items (รายการ + แถวของแถม), hints, shipFree } · โปรส่วนลด/บันเดิ้ล/ดีล ณ เวลานั้น
const dealCatalog = () => db.retailItems.filter((x) => x.active !== false).map((x) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, stock: x.stock }))
function giftRow(g) {
  const r = db.retailItems.find((x) => x.id === g.retailId)
  const it = priceItem({ id: `gift:${g.dealId}:${g.retailId}`, kind: 'retail', retailId: g.retailId, retailPrice: r?.price || 0, sizeId: r?.sizeId || null, typeId: r?.typeId || null, mods: [], name: r?.name || '', qty: g.qty, selections: {}, note: '', images: [] })
  return { ...it, unitPrice: 0, discounts: [{ kind: 'gift', name: g.name, amount: it.unitPrice }], promoGift: { dealId: g.dealId, name: g.name } }
}
export function posPromoInfo(cart, at = new Date()) {
  const raws = cart.map((l) => {
    const r = db.retailItems.find((x) => x.id === l.refId)
    const mods = modsOf(l.mods)
    return { l, r, mods, price: (r?.price || 0) + mods.reduce((s, m) => s + m.price, 0) }
  })
  const res = applyPosPromos(
    raws.map((x) => ({ retailId: x.l.refId, category: x.r?.category || '', price: x.price, qty: x.l.qty })),
    { discounts: db.posDiscounts, bundles: db.posBundles, deals: db.posDeals, catalog: dealCatalog(), now: at },
  )
  const items = raws.flatMap((x, i) =>
    res.lines[i].map((seg) => {
      const it = priceItem({ id: uid('i'), kind: 'retail', retailId: x.l.refId, retailPrice: x.price, sizeId: x.r?.sizeId || null, typeId: x.r?.typeId || null, mods: x.mods, name: x.r?.name || '', qty: seg.qty, selections: {}, note: '', images: [] })
      return seg.entries.length ? { ...it, unitPrice: round2(it.unitPrice - seg.perUnit), discounts: [...(it.discounts || []), ...seg.entries] } : it
    }),
  )
  return { items: [...items, ...res.gifts.map(giftRow)], hints: res.hints, shipFree: res.shipFree, gifts: res.gifts }
}
export const posItems = (cart, at = new Date()) => posPromoInfo(cart, at).items

// ---- โปรในออร์เดอร์ (สินค้าสำเร็จ + ยอดทั้งบิลรวมเค้กสั่งทำ) ----
// items = รายการที่คิดราคาแล้ว (priceItem) → { items (ติดส่วนลด + แถวของแถม promoGift), shipPromo { name, free } | null, hints }
// ไม่แยกรายการเมื่อชิ้นได้ส่วนลดไม่เท่ากัน (เฉลี่ยต่อชิ้น) เพื่อให้รหัสรายการ/รูปงานคงเดิม · เรียกซ้ำกับรายการชุดเดิมได้ผลเท่าเดิม
export function withPromos(items, { at = new Date() } = {}) {
  const base = (items || []).filter((i) => !i.promoGift)
  const lines = base.map((i) => {
    const r = i.kind === 'retail' ? db.retailItems.find((x) => x.id === i.retailId) : null
    return { retailId: r ? i.retailId : null, category: r?.category || '', price: Number(i.unitPrice) || 0, qty: Number(i.qty) || 0, noItemPromo: !r }
  })
  const res = applyPosPromos(lines, { discounts: db.posDiscounts, bundles: db.posBundles, deals: db.posDeals, catalog: dealCatalog(), now: at })
  const out = base.map((i, k) => {
    const segs = res.lines[k]
    const total = round2(segs.reduce((n, sg) => n + sg.perUnit * sg.qty, 0))
    if (!(total > 0) || !(i.qty > 0)) return i
    const by = new Map()
    for (const sg of segs) for (const e of sg.entries) { const key = `${e.kind}|${e.name}`; by.set(key, { kind: e.kind, name: e.name, amount: (by.get(key)?.amount || 0) + e.amount * sg.qty }) }
    const entries = [...by.values()].map((e) => ({ ...e, amount: round2(e.amount / i.qty) }))
    return { ...i, unitPrice: round2(i.unitPrice - total / i.qty), discounts: [...(i.discounts || []), ...entries] }
  })
  const gifts = res.gifts.map(giftRow)
  return { items: [...out, ...gifts], shipPromo: res.shipFree ? { name: res.shipFree.name, free: true } : null, hints: res.hints }
}
const stockOf = (l) => db.retailItems.find((x) => x.id === l.refId)
// ขาย: สร้างบิล (ออร์เดอร์ channel 'pos') ส่งมอบทันที + ตัดสต็อก + คะแนน
export function posSale({ cart, customerId = null, couponIds = [], discount = 0, method = 'cash', received = null }) {
  const shift = currentShift()
  if (!shift || !cart.length) return null
  if (couponIds.length && (!customerId || posCouponProblem({ customerId, couponIds }))) return null // คูปองต้องที่ลูกค้ากดแสดงอยู่ (POS ตรวจก่อนด้วย posCouponProblem)
  const ts = now()
  const o = {
    id: uid('o'), code: numbering.next('POS'), channel: 'pos', shiftId: shift.id, chatId: null,
    customerId, pickupAt: ts.slice(0, 16), fulfillment: 'pickup', birthday: null, address: '', shippingFee: 0,
    items: posItems(cart, new Date(ts)), adjustment: { amount: Number.isFinite(Number(discount)) && Number(discount) ? -Math.abs(Number(discount)) : 0, reason: Number.isFinite(Number(discount)) && Number(discount) ? 'ส่วนลดหน้าร้าน' : '' },
    pointsUsed: null, couponsUsed: [], loyalty: null, vat: vatNow(), status: 'payment_confirmed', payments: [], cancel: null, history: [], createdAt: ts,
  }
  if (o.adjustment.amount < -orderTotals(o).subtotal) o.adjustment.amount = -orderTotals(o).subtotal // ส่วนลดหน้าร้านไม่เกินยอดสินค้า
  db.orders.unshift(o)
  log(o, 'ขายหน้าร้าน (POS)')
  // POS ไม่ใช้คะแนนตรง ๆ แล้ว: ลูกค้าแลกคะแนนเป็นคูปองส่วนลดที่หน้าเว็บ แล้วนำมาใช้ที่นี่
  if (customerId) for (const id of couponIds) applyCoupon(o, id)
  const total = Math.max(orderTotals(o).total, 0)
  const got = method === 'cash' ? Math.max(Number(received) || 0, total) : total
  o.payments.push({ id: uid('pay'), code: numbering.next('PAY'), requested: total, amount: total, method: POS_METHODS[method], posMethod: method, received: got, change: got - total, paidAt: ts.slice(0, 16), slip: '', note: '', status: 'confirmed', reportedBy: session.role, confirmedBy: session.role })
  for (const it of o.items) {
    const src = it.kind === 'retail' ? db.retailItems.find((x) => x.id === it.retailId) : null
    if (src && src.stock != null) { const take = Math.min(src.stock, it.qty); it.stockTaken = take; src.stock -= take } // จดจำนวนที่ตัดจริง ตอนยกเลิกบิลคืนเท่านี้
  }
  o.status = 'delivered'
  o.deliveredAt = ts
  log(o, `รับชำระ ${money(total)} (${POS_METHODS[method]}) · ส่งมอบ`)
  awardOrderRemote(o)
  return o
}
// ยกเลิกบิล (แอดมิน): คืนสต็อก + คืนคะแนน/คูปองที่ใช้ + ตัดคะแนนที่ได้ + คืนเงินตาม refunds (ไม่ส่ง = คืนเต็มช่องทางที่จ่ายมา)
export function voidPosSale(order, reason = 'ยกเลิกบิล', refunds = null, refundNote = '') {
  if (order.channel !== 'pos' || order.status === 'cancelled') return { error: 'บิลนี้ยกเลิกแล้ว' }
  const pay = order.payments.find((p) => p.status === 'confirmed')
  const net = orderTotals(order).paidNet
  const rows = refunds || (pay && net > 0 ? [{ method: defaultRefundMethod(pay.posMethod), amount: net }] : [])
  const r = cancelOrder(order, { reason, refunds: rows, refundNote })
  if (r.error) return r
  for (const it of order.items) {
    const src = it.kind === 'retail' ? db.retailItems.find((x) => x.id === it.retailId) : null
    if (src && src.stock != null) src.stock += it.stockTaken ?? it.qty
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
export const DEAL_KINDS = { bogo: 'ซื้อ X แถม Y', nth: 'ชิ้นที่ N ลด % (ซื้อ 3 จ่าย 2)', spend_off: 'ซื้อครบ X ลด Y (ขั้นบันได)', spend_free: 'ซื้อครบ X ฟรีสินค้า', spend_addon: 'ซื้อครบ X ซื้อสินค้าราคาพิเศษ', free_ship: 'ส่งฟรีเมื่อครบ X' }
const posInt = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && Math.floor(n) === n ? n : 0 }
const hasItem = (id) => db.retailItems.some((x) => x.id === id)
export function saveDeal(d) {
  if (!can('manage')) return { error: 'เฉพาะแอดมิน' }
  const kind = d.kind
  if (!DEAL_KINDS[kind]) return { error: 'เลือกประเภทดีล' }
  const name = String(d.name ?? '').trim()
  if (!name) return { error: 'กรอกชื่อดีล' }
  const base = { id: d.id, kind, name, active: d.active !== false, schedule: cleanSchedule(d.schedule) }
  const scopeOf = () => {
    const scope = ['items', 'category', 'all'].includes(d.scope) ? d.scope : 'items'
    if (scope === 'items' && !(d.itemIds || []).length) return { error: 'เลือกสินค้าอย่างน้อย 1 รายการ' }
    if (scope === 'category' && !(d.categories || []).length) return { error: 'เลือกหมวดอย่างน้อย 1 หมวด' }
    return { scope, itemIds: scope === 'items' ? ids(d.itemIds) : [], categories: scope === 'category' ? ids(d.categories) : [] }
  }
  const minOf = (label = 'ยอดขั้นต่ำ') => { const n = Number(d.min); return Number.isFinite(n) && n > 0 ? { min: n } : { error: `${label}ต้องมากกว่า 0 บาท` } }
  let data
  if (kind === 'bogo' || kind === 'nth') {
    const sc = scopeOf()
    if (sc.error) return sc
    if (kind === 'bogo') {
      const buyQty = posInt(d.buyQty), giftQty = posInt(d.giftQty)
      if (!buyQty) return { error: 'จำนวนที่ต้องซื้อต้องเป็นจำนวนเต็ม ≥ 1' }
      if (!giftQty) return { error: 'จำนวนของแถมต้องเป็นจำนวนเต็ม ≥ 1' }
      if (d.giftItemId && !hasItem(d.giftItemId)) return { error: 'ไม่พบสินค้าของแถม' }
      data = { ...sc, buyQty, giftQty, giftItemId: d.giftItemId || '', repeat: d.repeat !== false, maxGifts: Math.max(0, Math.floor(Number(d.maxGifts) || 0)) }
    } else {
      const n = posInt(d.n), percent = Number(d.percent)
      if (n < 2) return { error: 'N ต้องเป็นจำนวนเต็ม ≥ 2 (เช่น 3 = ชิ้นที่ 3)' }
      if (!(percent > 0 && percent <= 100)) return { error: 'เปอร์เซ็นต์ต้องอยู่ระหว่าง 1–100 (100 = ฟรี)' }
      data = { ...sc, n, percent }
    }
  } else if (kind === 'spend_off') {
    const tiers = (d.tiers || []).map((t) => ({ min: Number(t.min), type: t.type === 'amount' ? 'amount' : 'percent', value: Number(t.value) })).filter((t) => t.min > 0 || t.value > 0)
    if (!tiers.length) return { error: 'เพิ่มขั้นส่วนลดอย่างน้อย 1 ขั้น' }
    if (tiers.some((t) => !(t.min > 0))) return { error: 'ยอดแต่ละขั้นต้องมากกว่า 0' }
    if (tiers.some((t) => !(t.value > 0) || (t.type === 'percent' && t.value > 100))) return { error: 'ส่วนลดแต่ละขั้นต้องมากกว่า 0 (เปอร์เซ็นต์ไม่เกิน 100)' }
    if (tiers.some((t) => t.type === 'amount' && t.value >= t.min)) return { error: 'ส่วนลดเป็นบาทต้องน้อยกว่ายอดของขั้นนั้น' }
    if (new Set(tiers.map((t) => t.min)).size !== tiers.length) return { error: 'ยอดของแต่ละขั้นซ้ำกัน' }
    data = { tiers: tiers.sort((a, b) => a.min - b.min) }
  } else if (kind === 'spend_free') {
    const m = minOf()
    if (m.error) return m
    if (!hasItem(d.giftItemId)) return { error: 'เลือกสินค้าที่แถมฟรี' }
    const giftQty = posInt(d.giftQty || 1)
    if (!giftQty) return { error: 'จำนวนของแถมต้องเป็นจำนวนเต็ม ≥ 1' }
    data = { ...m, giftItemId: d.giftItemId, giftQty }
  } else if (kind === 'spend_addon') {
    const m = minOf()
    if (m.error) return m
    if (!hasItem(d.itemId)) return { error: 'เลือกสินค้าที่ขายราคาพิเศษ' }
    const price = Number(d.price)
    if (d.price === '' || d.price == null || !(price >= 0)) return { error: 'กรอกราคาพิเศษ' }
    const regular = db.retailItems.find((x) => x.id === d.itemId).price
    if (price >= regular) return { error: `ราคาพิเศษต้องต่ำกว่าราคาปกติ (${regular} บาท)` }
    data = { ...m, itemId: d.itemId, price, limit: Math.max(1, Math.floor(Number(d.limit) || 1)) }
  } else {
    const m = minOf()
    if (m.error) return m
    data = { ...m }
  }
  return { ok: true, item: upsert(db.posDeals, 'dl', { ...base, ...data }) }
}
export function removePromo(list, id) {
  if (!can('manage')) return
  const a = { discount: db.posDiscounts, bundle: db.posBundles, point: db.pointPromos, deal: db.posDeals }[list]
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

// ---------- หน้าร้าน: เนื้อหา + รีวิว (หลังบ้านแก้ ที่ /admin/settings/storefront) ----------
const pairs = (list, keys) =>
  (list || []).map((x) => Object.fromEntries(keys.map((k) => [k, String(x[k] ?? '').trim()]))).filter((x) => keys.some((k) => x[k]))
// ลิงก์ที่หน้าร้านแสดงเป็นปุ่ม (LINE/Facebook/แผนที่): รับเฉพาะ http(s) กัน javascript:/data: ที่ทำงานเมื่อลูกค้ากด · ไม่ถูกต้อง = ว่าง
const webUrl = (v) => {
  const s = String(v ?? '').trim()
  if (!s) return ''
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '' } catch { return '' }
}
export function saveStorefront(d) {
  Object.assign(db.storefront, {
    heroTitle: String(d.heroTitle ?? '').trim(), heroText: String(d.heroText ?? '').trim(), heroImage: d.heroImage || '',
    about: String(d.about ?? '').trim(), address: String(d.address ?? '').trim(), mapUrl: webUrl(d.mapUrl),
    phone: phoneDigits(d.phone), lineUrl: webUrl(d.lineUrl), facebookUrl: webUrl(d.facebookUrl),
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
// โหมด Supabase + ไม่ใช่พนักงาน: บัญชีลูกค้าอยู่ที่เซิร์ฟเวอร์ (Edge Function customer-auth) ไม่ใช่ข้อมูลจำลองในเครื่อง
const remoteCust = () => supabaseEnabled && !staffState.staff
const ACCT_BLOCK = 'ยังแก้ข้อมูลบัญชีผ่านหน้าเว็บไม่ได้ในตอนนี้ กรุณาแจ้งร้านทางแชท'
const REMOTE_OTP = ['register', 'reset', 'change_pin', 'change_phone', 'delete']
// OTP ของบัญชีที่ล็อกอินอยู่ (เปลี่ยน PIN/เบอร์/ลบข้อมูล) ต้องแนบเซสชัน · เซิร์ฟเวอร์ส่งไปเบอร์ของบัญชีเอง (change_phone ส่งไปเบอร์ใหม่)
const remoteOtpBody = (phone, purpose) => ({ phone: phoneDigits(phone), purpose, ...(NEEDS_LOGIN.includes(purpose) ? { session: readSessionToken() } : {}) })
export const customerLogout = () => {
  if (remoteCust()) {
    const t = readSessionToken()
    clearSessionToken()
    clearBundle(db, customerSession.customerId)
    if (t) callAuth('logout', { session: t })
  }
  customerSession.customerId = null
}
// คำสั่งของลูกค้าที่ล็อกอิน (แนบเซสชัน) → เซิร์ฟเวอร์ตรวจสิทธิ์และคืนข้อมูลล่าสุดของลูกค้า
async function remoteAct(action, body = {}) {
  const t = readSessionToken()
  if (!t || !customerSession.customerId) return { error: 'กรุณาเข้าสู่ระบบ' }
  const r = await callAuth(action, { ...body, session: t })
  if (r.ok && r.customer) { injectBundle(db, r); return { ok: true } }
  if (r.status === 401) { clearSessionToken(); clearBundle(db, customerSession.customerId); customerSession.customerId = null }
  return { error: r.error }
}
function enterRemote(r) {
  saveSessionToken(r.session.token)
  customerSession.customerId = injectBundle(db, r)
}
// เปิดหน้าเว็บใหม่: ถ้ามีเซสชันค้างอยู่ (14 วัน) → กลับเข้าบัญชีอัตโนมัติ
export async function restoreCustomerSession() {
  const t = readSessionToken()
  if (!t || !remoteCust() || customerSession.customerId) return false
  const r = await callAuth('session', { session: t })
  if (r.ok && r.customer) { customerSession.customerId = injectBundle(db, r); return true }
  if (r.status === 401) clearSessionToken()
  return false
}
const NEEDS_LOGIN = ['change_pin', 'change_phone', 'delete']

// ขอ OTP (จำลอง: คืน simCode ให้แสดงบนจอ · ของจริงส่ง SMS ผ่านระบบ SMS ของร้านและไม่คืนรหัส)
export function requestOtp(phoneRaw, purpose) {
  // โหมดออนไลน์: คืน Promise (เซิร์ฟเวอร์ส่ง SMS จริง ไม่คืนรหัส) · ผู้เรียกใช้ await เสมอ
  if (remoteCust()) return REMOTE_OTP.includes(purpose) ? callAuth('otp_request', remoteOtpBody(phoneRaw, purpose)) : Promise.resolve({ error: ACCT_BLOCK })
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
  if (remoteCust()) return REMOTE_OTP.includes(purpose) ? callAuth('otp_verify', { ...remoteOtpBody(phoneRaw, purpose), code: String(code ?? '') }) : Promise.resolve({ error: ACCT_BLOCK })
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
  if (remoteCust()) {
    const r = await callAuth('register', { token, phone: phoneDigits(phoneRaw), name, pin, consent })
    if (!r.ok) return { error: r.error }
    enterRemote(r)
    return { ok: true, linked: !!r.linked }
  }
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
  if (remoteCust()) {
    const r = await callAuth('login', { phone: phoneDigits(phoneRaw), pin })
    if (!r.ok) return { error: r.error, ...(r.locked ? { locked: true } : {}) }
    enterRemote(r)
    return { ok: true }
  }
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
  if (remoteCust()) {
    const r = await callAuth('reset', { token, phone: phoneDigits(phoneRaw), pin })
    if (r.ok) clearSessionToken()
    return r.ok ? { ok: true } : { error: r.error }
  }
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
  if (remoteCust()) return remoteAct('change_pin', { token, pin })
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
  if (remoteCust()) return remoteAct('change_phone', { token, phone: phoneDigits(phoneRaw) }) // Promise ในโหมดออนไลน์
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
  if (remoteCust()) return remoteAct('update_profile', { name, line, promoOptIn }) // Promise ในโหมดออนไลน์
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
  if (remoteCust()) return remoteAct('submit_review', { orderId, rating, text }) // Promise ในโหมดออนไลน์
  return submitReviewLocal({ orderId, rating, text })
}
// เวอร์ชันในเครื่อง (ข้อมูลตัวอย่าง/โหมดจำลอง) — ไม่เรียกเซิร์ฟเวอร์
export function submitReviewLocal({ orderId, rating, text }) {
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
  if (c.error) return c
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
  if (remoteCust()) return remoteAct('accept_consent') // Promise ในโหมดออนไลน์
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
  if (remoteCust()) return remoteAct('request_deletion', { token, note }) // Promise ในโหมดออนไลน์
  const a = myAccount()
  const o = findVerified(token, 'delete', a?.phone)
  if (!a || !o) return NEED_OTP
  if (db.deletionRequests.some((r) => r.customerId === a.customerId && r.status === 'pending')) return { error: 'มีคำขอที่รอตรวจสอบอยู่แล้ว' }
  db.deletionRequests.unshift({ id: uid('dr'), customerId: a.customerId, status: 'pending', customerNote: String(note).trim().slice(0, 300), reason: '', createdAt: now(), decidedAt: null, decidedBy: '' })
  o.used = true
  emitStaffBell('deletion_request', { text: findCustomer(a.customerId)?.name || '' })
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
      for (const p of it.workPhotos || []) unpublishPhoto(o, it, p)
      it.workPhotos = []
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
