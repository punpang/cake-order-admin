// ข้อมูลตัวอย่าง (เก็บในหน่วยความจำ รีเฟรชแล้วหาย)
// ขั้นต่อไปจะเปลี่ยนฟังก์ชันในไฟล์นี้ให้เรียก Supabase แทน
import { reactive } from 'vue'
import { PERMISSIONS, CHANNELS, CUSTOMER_CHANNEL_ORDER, NOTIFY_EVENTS, POS_METHODS } from '../lib/constants'
import { activeLists, priceDetail, orderTotals } from '../lib/pricing'
import { addDays, pointBalance, takePoints, returnPoints, couponUsable, pickPrize, expiringSoon } from '../lib/loyalty'
import { pad, toDateStr, money, phoneDigits, phoneValid, formatPhone, dateOnly, timeOnly } from '../lib/format'
import { nextBirthday, daysBetween } from '../lib/birthday'
import { parseAnswer } from '../lib/chatParse'
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
export const session = reactive({ role: 'admin' })
export const can = (action) => PERMISSIONS[action]?.includes(session.role)

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
  shop: { name: 'ร้านเค้กตัวอย่าง', slotMinutes: 30, open: '09:00', close: '20:00', nearbyHours: 2, leadPickup: 60, leadDelivery: 120, depositPercent: 50, birthdayDays: 14 },
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

  // เค้กสำเร็จ: ราคา = ประเภท (typeId) + เนื้อเค้ก (flavorId) + ขนาดของประเภท (sizeId) · recipe = สูตรวัตถุดิบของสินค้า (ตัวเลขตัวอย่าง)
  products: [
    { id: 'p1', stock: 3, name: 'เค้กช็อกโกแลตฟัดจ์', typeId: 't1', flavorId: 'sp2', sizeId: 's1', active: true, recipe: [r('m1', 150), r('m2', 120), r('m3', 3), r('m4', 80), r('m6', 40), r('m8', 1, 'piece')] },
    { id: 'p2', name: 'เค้กส้ม', typeId: 't1', flavorId: 'sp1', sizeId: 's1', active: true, recipe: [r('m1', 160), r('m2', 130), r('m3', 3), r('m4', 70), r('m8', 1, 'piece')] },
    { id: 'p3', name: 'เค้กใบเตยมะพร้าวอ่อน', typeId: 't3', flavorId: 'sp3', sizeId: 's2', active: true, recipe: [r('m1', 150), r('m2', 110), r('m3', 3), r('m5', 150), r('m8', 1, 'piece')] },
    { id: 'p4', name: 'เรดเวลเวท', typeId: 't2', flavorId: 'sp4', sizeId: 's1', active: true, recipe: [r('m1', 150), r('m2', 130), r('m3', 3), r('m4', 80), r('m6', 10), r('m8', 1, 'piece')] },
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
    rule('payment_requested', ['line', 'facebook', 'sms'], 'ออร์เดอร์ {เลขออร์เดอร์} ยอดที่ต้องชำระ {ยอดที่แจ้ง} (คงค้างทั้งหมด {คงค้าง})'),
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
  ],
  // คิวข้อความ (จำลอง) ล่าสุดอยู่หน้า · notifySent = key ที่ส่งแล้ว (กันส่งซ้ำของเหตุการณ์ตามเวลา)
  outbox: [],
  notifySent: [],

  // ---------- ศูนย์รวมแชท LINE OA + Facebook (จำลอง) ----------
  // messages: { from: 'customer' | 'staff', kind: 'text' | 'order', text, orderId, at, by }
  chats: [],
  chatDrafts: {}, // ร่างออร์เดอร์ต่อแชท { [chatId]: form } สลับไปมาข้อมูลไม่หาย
  quotes: [], // ใบเสนอในแชท status: pending | accepted | revise | superseded

  // ---------- POS หน้าร้าน ----------
  // สินค้าหน้าร้าน (ตัวอย่าง) stock = คงเหลือ (null = ไม่นับสต็อก)
  retailItems: [
    { id: 'rt1', name: 'เค้กช็อกโกแลต (ชิ้น)', category: 'เค้กชิ้น', price: 75, stock: 12, active: true },
    { id: 'rt2', name: 'เค้กส้ม (ชิ้น)', category: 'เค้กชิ้น', price: 70, stock: 8, active: true },
    { id: 'rt3', name: 'คัพเค้กวานิลลา', category: 'คัพเค้ก', price: 45, stock: 20, active: true },
    { id: 'rt4', name: 'คัพเค้กเรดเวลเวท', category: 'คัพเค้ก', price: 55, stock: 0, active: true },
    { id: 'rt5', name: 'อเมริกาโน่เย็น', category: 'เครื่องดื่ม', price: 60, stock: null, active: true, modifierIds: ['md1', 'md2', 'md3'] },
    { id: 'rt6', name: 'ชาไทยเย็น', category: 'เครื่องดื่ม', price: 55, stock: null, active: true, modifierIds: ['md1', 'md2'] },
    { id: 'rt7', name: 'เทียนวันเกิด (แพ็ก)', category: 'ของเสริม', price: 20, stock: 50, active: true },
  ],
  // ตัวเลือกสินค้าหน้าร้าน (กลุ่มกลาง ผูกกับสินค้าด้วย retailItems[].modifierIds) price = บาทที่บวกเพิ่ม
  posModifiers: [
    { id: 'md1', name: 'ความหวาน', type: 'single', required: true, active: true, options: [{ id: 'o1', name: 'ปกติ', price: 0 }, { id: 'o2', name: 'หวานน้อย', price: 0 }, { id: 'o3', name: 'ไม่หวาน', price: 0 }] },
    { id: 'md2', name: 'น้ำแข็ง', type: 'single', required: true, active: true, options: [{ id: 'o4', name: 'ปกติ', price: 0 }, { id: 'o5', name: 'แยกน้ำแข็ง', price: 0 }, { id: 'o6', name: 'ไม่ใส่น้ำแข็ง', price: 0 }] },
    { id: 'md3', name: 'เพิ่ม', type: 'multi', required: false, active: true, options: [{ id: 'o7', name: 'เพิ่มช็อต', price: 15 }, { id: 'o8', name: 'วิปครีม', price: 10 }] },
  ],
  // กะขาย: float = เงินทอนตั้งต้น, counted = เงินสดที่นับได้ตอนปิด
  shifts: [],

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

  // ---------- ระบบลูกค้า (จำลอง) ----------
  // customerAccounts: เบอร์ + PIN (เก็บเป็น hash + salt) · otps: รหัสยืนยัน (จำลองเก็บในหน่วยความจำ) · deletionRequests: คำขอลบข้อมูล
  customerAccounts: [],
  otps: [],
  deletionRequests: [],

  orders: [],
})

// ทุกรายการเริ่มต้นเป็น "ใช้งาน" + สมุดคะแนน / สิทธิ์หมุน
for (const p of db.products) Object.assign(p, { stock: p.stock ?? null, images: p.images || [], pinned: !!p.pinned })
for (const o of db.optionGroups.find((g) => g.key === 'type')?.options || []) o.images = o.images || []
for (const r of db.retailItems) r.modifierIds = r.modifierIds || []
for (const c of db.customers) Object.assign(c, { active: true, ledger: [], spins: 0, lineUserId: '', fbPsid: '', promoOptIn: true })
// ตัวอย่าง: ลูกค้าคนแรกผูก LINE แล้ว (จำลอง)
db.customers[0].lineUserId = 'U-demo-mali'
for (const g of db.optionGroups) g.active = true

// ---------- ฟังก์ชัน ----------
let orderNo = 0
const nextCode = () => `OR-${String(++orderNo).padStart(4, '0')}`

export const findOrder = (id) => db.orders.find((o) => o.id === id)
export const findCustomer = (id) => db.customers.find((c) => c.id === id)

export function addCustomer(data) {
  const c = { id: uid('c'), name: data.name.trim(), phone: phoneDigits(data.phone), line: data.line?.trim() || '', note: data.note?.trim() || '', active: true, ledger: [], spins: 0, lineUserId: '', fbPsid: '', promoOptIn: true }
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
  const c = upsert(db.customers, 'c', { ...d, phone: phoneDigits(d.phone) })
  if (!c.ledger) Object.assign(c, { ledger: [], spins: 0 })
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
export const saveProduct = (d) => upsert(db.products, 'p', { ...d, recipe: cleanRecipe(d.recipe), stock: d.stock === '' || d.stock == null ? null : Math.max(0, Number(d.stock) || 0) })
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
  return { ...item, ...priceDetail(item, db.optionGroups, db.products, activeListsAt(dateStr), db.bundles) }
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
    chatId: payload.chatId || null, // สร้างจากแชท
    birthday: payload.birthday?.md ? { name: payload.birthday.name || '', md: payload.birthday.md } : null, // { name, md: 'MM-DD' }
    address: payload.fulfillment === 'delivery' ? payload.address : '',
    shippingFee: payload.fulfillment === 'delivery' ? Number(payload.shippingFee) || 0 : 0,
    items: payload.quoteItems ? payload.items : payload.items.map((i) => priceItem(i)), // จากใบเสนอ = ราคาตามใบเสนอ
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
    status: 'reported',
    reportedBy: session.role,
    confirmedBy: null,
  })
  log(order, `แจ้งยอดชำระ ${money(Number(p.amount))} (${p.method})`)
  notifyOrder('payment_requested', order, { requested: Number(p.amount) })
  if (order.status === 'awaiting_payment') order.status = 'payment_reported'
}

const payFields = (p) => ({ method: p.method, paidAt: p.paidAt, slip: p.slip || '', note: p.note || '' })

export function updatePaymentRequest(order, paymentId, p) {
  const pay = order.payments.find((x) => x.id === paymentId)
  if (!pay || pay.status !== 'reported') return
  Object.assign(pay, { requested: Number(p.amount), amount: Number(p.amount), ...payFields(p) })
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
  if (!order.payments.some((x) => x.status === 'confirmed') && ['payment_confirmed', 'preparing'].includes(order.status)) {
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

export function cancelOrder(order, c) {
  undoLoyalty(order)
  order.cancel = { reason: c.reason, refundAmount: Number(c.refundAmount) || 0, refundMethod: c.refundMethod, refundNote: c.refundNote || '', at: now() }
  setStatus(order, 'cancelled', `ยกเลิก: ${c.reason}${order.cancel.refundAmount ? ` / คืนเงิน ${money(order.cancel.refundAmount)}` : ''}`)
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
    items: [{ id: uid('i'), kind: 'custom', name: 'เค้กครีม · ช็อกโกแลต · 2 ปอนด์', qty: 1, note: 'ตามรูปตัวอย่าง', images: [],
      tiers: [{ selections: { g_size: 's2', g_sponge: 'sp2', g_filling: ['f2'], g_type: 't1', g_shape: 'sh3', g_color: 'ชมพูพาสเทล', g_topping: ['tp2'] } }],
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
    วันนัด: dateOnly(order.pickupAt),
    เวลานัด: timeOnly(order.pickupAt),
    ส่งมอบ: order.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับ',
    ชื่อวันเกิด: order.birthday?.name || c?.name || '',
    คะแนน: '',
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
  const customer = findCustomer(order.customerId)
  notify(event, { customer, vars, orderId: order.id })
  if (TEAM_OF[event]) notify(TEAM_OF[event], { vars, orderId: order.id })
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
  }
  return c
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
  Object.assign(db.integrations[key], { status: 'not_connected', accountName: '', accountId: '', connectedAt: null, tokenHint: '' })
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
      customerId: c?.customerId || null, date: toDateStr(new Date()), time: '', fulfillment: 'pickup', address: '', shippingFee: 0,
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
  for (const old of db.quotes) if (old.chatId === chatId && old.status === 'pending') old.status = 'superseded'
  const payload = JSON.parse(JSON.stringify({
    customerId: c.customerId, pickupAt: draft.pickupAt, fulfillment: draft.fulfillment,
    address: draft.fulfillment === 'delivery' ? draft.address : '', shippingFee: draft.fulfillment === 'delivery' ? Number(draft.shippingFee) || 0 : 0,
    birthday: draft.birthday || null, items: draft.items.map((i) => priceItem(i)),
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
  return { order: quoteToOrder(q) }
}
// พนักงานสร้างออร์เดอร์จากใบเสนอที่ลูกค้ายืนยันแล้ว (หลังผูก/ได้เบอร์)
export function convertQuote(quoteId) {
  const q = findQuote(quoteId)
  if (!q || q.status !== 'need_phone') return { error: 'ใบเสนอนี้ใช้ไม่ได้แล้ว' }
  const block = chatOrderBlock(q.chatId)
  if (block) return { error: block }
  if (new Date(q.payload.pickupAt) <= new Date()) return { error: 'เวลานัดผ่านแล้ว ส่งใบเสนอใหม่' }
  return { order: quoteToOrder(q) }
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

// ตะกร้า → รายการออร์เดอร์ (ราคาตามปัจจุบัน)
export function posItems(cart) {
  return cart.map((l) => {
    if (l.kind === 'retail') {
      const r = db.retailItems.find((x) => x.id === l.refId)
      const mods = modsOf(l.mods)
      const price = (r?.price || 0) + mods.reduce((s, m) => s + m.price, 0)
      return priceItem({ id: uid('i'), kind: 'retail', retailId: l.refId, retailPrice: price, mods, name: r?.name || '', qty: l.qty, selections: {}, note: '', images: [] })
    }
    const p = db.products.find((x) => x.id === l.refId)
    return priceItem({ id: uid('i'), kind: 'ready', productId: l.refId, name: p?.name || '', qty: l.qty, selections: {}, note: '', images: [] })
  })
}
const stockOf = (l) => (l.kind === 'retail' ? db.retailItems : db.products).find((x) => x.id === l.refId)
// ขาย: สร้างบิล (ออร์เดอร์ channel 'pos') ส่งมอบทันที + ตัดสต็อก + คะแนน
export function posSale({ cart, customerId = null, points = 0, couponIds = [], discount = 0, method = 'cash', received = null }) {
  const shift = currentShift()
  if (!shift || !cart.length) return null
  const ts = now()
  const o = {
    id: uid('o'), code: `POS-${String(++posNo).padStart(4, '0')}`, channel: 'pos', shiftId: shift.id, chatId: null,
    customerId, pickupAt: ts.slice(0, 16), fulfillment: 'pickup', birthday: null, address: '', shippingFee: 0,
    items: posItems(cart), adjustment: { amount: discount ? -Math.abs(Number(discount)) : 0, reason: discount ? 'ส่วนลดหน้าร้าน' : '' },
    pointsUsed: null, couponsUsed: [], loyalty: null, status: 'payment_confirmed', payments: [], cancel: null, history: [], createdAt: ts,
  }
  db.orders.unshift(o)
  log(o, 'ขายหน้าร้าน (POS)')
  if (customerId && points > 0) applyPoints(o, points)
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
// ยกเลิกบิล (แอดมิน): คืนสต็อก + คืนคะแนน/คูปอง + ตัดคะแนนที่ได้
export function voidPosSale(order, reason = 'ยกเลิกบิล') {
  if (order.channel !== 'pos' || order.status === 'cancelled') return
  for (const it of order.items) {
    const src = it.kind === 'retail' ? db.retailItems.find((x) => x.id === it.retailId) : db.products.find((x) => x.id === it.productId)
    if (src && src.stock != null) src.stock += it.qty
  }
  const pay = order.payments.find((p) => p.status === 'confirmed')
  cancelOrder(order, { reason, refundAmount: pay?.amount || 0, refundMethod: pay?.method || '', refundNote: '' })
}
export const saveRetailItem = (d) => upsert(db.retailItems, 'rt', { ...d, modifierIds: [...(d.modifierIds || [])], price: Number(d.price) || 0, stock: d.stock === '' || d.stock == null ? null : Math.max(0, Number(d.stock) || 0) })
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
export async function registerAccount({ token, phone: phoneRaw, name = '', pin }) {
  const phone = phoneDigits(phoneRaw)
  const o = findVerified(token, 'register', phone)
  if (!o) return NEED_OTP
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
    .map((o) => {
      const t = orderTotals(o)
      return {
        id: o.id, code: o.code, channel: o.channel || 'web', status: o.status, createdAt: o.createdAt, pickupAt: o.pickupAt, fulfillment: o.fulfillment,
        address: o.address || '', birthday: o.birthday ? { ...o.birthday } : null, items: o.items.map((i) => ({ ...i })),
        total: t.total, paid: t.paid, balance: Math.max(t.balance, 0), discountTotal: t.discountTotal,
        payments: o.payments.filter((p) => p.status === 'confirmed').map((p) => ({ amount: p.amount, method: p.method, paidAt: p.paidAt })),
        review: reviewOfOrder(o.id) ? { rating: reviewOfOrder(o.id).rating, status: reviewOfOrder(o.id).status } : null,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
  const chatIds = new Set(db.chats.filter((c) => c.customerId === id).map((c) => c.id))
  const textGroups = new Set(db.optionGroups.filter((g) => g.type === 'text').map((g) => g.id))
  for (const o of db.orders) {
    if (o.customerId !== id) continue
    Object.assign(o, { birthday: null, address: '', chatId: null })
    for (const it of o.items) {
      it.note = ''
      it.images = []
      for (const k of Object.keys(it.selections || {})) if (textGroups.has(k)) delete it.selections[k]
      for (const t of it.tiers || []) for (const k of Object.keys(t.selections || {})) if (textGroups.has(k)) delete t.selections[k]
    }
    for (const p of o.payments) Object.assign(p, { slip: '', note: '' })
    if (o.cancel) o.cancel.refundNote = ''
  }
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
