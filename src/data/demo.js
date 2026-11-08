// ข้อมูลตัวอย่างสมจริง ~90 วัน (โหลดตอนเปิดเว็บ จากนั้นหายเมื่อรีเฟรช เพราะเป็นหน่วยความจำ)
// สร้างผ่านฟังก์ชันจริงของ store/acct เพื่อให้สอดคล้องกติกา แล้ว "ย้อนนาฬิกา" ให้เวลาในประวัติกระจายตามจริง
// ตอนต่อ Supabase: ลบไฟล์นี้ + บรรทัด seedDemo() ใน src/main.js
import {
  db, session, customerSession, createOrder, reportPayment, confirmPayment, receivePaymentNow, setStatus, cancelOrder, addWorkPhotos, publishWorkPhoto,
  customerRequestPhotoOptOut, saveGalleryImage, recordCakeClick, redeemReward, spinGacha, saveReview, submitReviewLocal, setReviewStatus, saveRetailItem, savePosDiscount, saveDeal,
  openShift, closeShift, posSale, shiftSummary, receiveMessage, sendChat, postOrderCard, sendQuote, acceptQuote, reviseQuote, saveIngredient, saveShopSettings,
  createOrderLink, sendOrderLinkToChat, saveUser, findCustomer, currentShift, priceItem, refundOrder, shiftBills,
} from './store'
import * as acct from './acct'
import { orderTotals, describeSelections } from '../lib/pricing'
import { blankSchedule } from '../lib/posPromo'
import { toDateStr } from '../lib/format'

const RealDate = Date
const realRandom = Math.random
let clock = 0
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock) }
  static now() { return clock }
}
// สุ่มแบบกำหนดเมล็ด (ผลเหมือนเดิมทุกครั้ง)
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export function seedDemo() {
  if (db.__demo) return null
  db.__demo = true
  const t0 = performance.now()
  const rnd = mulberry(20260101)
  const real = Date.now()
  const midnight = new RealDate(real); midnight.setHours(0, 0, 0, 0)
  const DAY = 864e5, H = 3600e3, M = 60e3
  const T = (daysAgo, hh = 12, mm = 0) => Math.min(midnight.getTime() - daysAgo * DAY + hh * H + mm * M, real - M)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const chance = (p) => rnd() < p
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const local = (ms) => { const d = new RealDate(ms); return `${toDateStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const at = (ms, fn) => events.push({ t: ms, n: events.length, fn })
  const events = []
  const savedSession = { ...session }
  const savedCust = customerSession.customerId

  globalThis.Date = FakeDate
  Math.random = rnd
  try {
    clock = T(90, 8)
    session.role = 'admin'; session.userId = 'u1'

    // ---------- ตั้งค่าร้าน: VAT (ให้ใบกำกับภาษี/รายงานภาษีมีของ) ----------
    saveShopSettings({
      ...db.shop, name: 'ร้านเค้กตัวอย่าง',
      vat: { enabled: true, rate: 7, mode: 'inclusive', taxId: taxId('010556700123'), legalName: 'บริษัท เค้กตัวอย่าง จำกัด', address: '88/12 ถนนสุขุมวิท 39 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110', branch: '00000' },
      payment: { promptpayId: '0812345678', accountName: 'บจก. เค้กตัวอย่าง', bank: 'กสิกรไทย', accountNo: '123-4-56789-0', note: 'โอนแล้วส่งสลิปในแชทได้เลย' },
    })

    // ---------- ผู้ใช้เพิ่ม ----------
    saveUser({ name: 'น้องฟ้า (แคชเชียร์)', email: 'fah@example.com', role: 'sales' })
    saveUser({ name: 'พี่ต้น (ช่างเค้ก)', email: 'ton@example.com', role: 'baker' })

    // ---------- สินค้าหน้าร้าน + วัตถุดิบ ----------
    const art = (hue, kind) => svgCake(hue, kind)
    const setRetail = (id, data) => Object.assign(db.retailItems.find((x) => x.id === id), data)
    setRetail('rt1', { stock: 60, images: [art(25, 'slice')], showOnStore: true, description: 'ช็อกโกแลตเข้มข้น นุ่มชุ่มฉ่ำ หน้าครีมกานาช' })
    setRetail('rt2', { stock: 60, images: [art(35, 'slice')], showOnStore: true, description: 'เนื้อเค้กส้มหอมสด เปรี้ยวหวานกำลังดี' })
    setRetail('rt3', { stock: 120, images: [art(48, 'cup')], showOnStore: true, description: 'คัพเค้กวานิลลา ท็อปครีมชีส' })
    setRetail('rt4', { stock: 120, images: [art(350, 'cup')], showOnStore: true, description: 'เรดเวลเวทหอมโกโก้ ครีมชีสเนียน' })
    setRetail('rt5', { images: [art(28, 'drink')], showOnStore: true, description: 'กาแฟเข้ม สดชื่น เลือกระดับความหวานได้' })
    setRetail('rt6', { images: [art(30, 'drink')], showOnStore: true, description: 'ชาไทยเข้มข้น หอมนม' })
    setRetail('rt7', { stock: 300 })
    setRetail('rt8', { images: [art(20, 'whole')], description: 'ฟัดจ์ช็อกโกแลตหนานุ่ม ขนาด 1 ปอนด์' })
    setRetail('rt9', { images: [art(34, 'whole')], description: 'เค้กส้มหอม ท็อปเจลลี่ส้ม' })
    setRetail('rt10', { images: [art(130, 'whole')], description: 'เค้กใบเตยหอมกลิ่นธรรมชาติ สอดไส้มะพร้าวอ่อน' })
    setRetail('rt11', { images: [art(352, 'whole')], description: 'เรดเวลเวทนุ่มละมุน ครีมชีสสูตรร้าน' })
    const mk = (d) => saveRetailItem({ pinned: false, showInPos: true, showOnStore: true, modifierIds: [], recipe: [], ...d }).id
    const newItems = [
      mk({ name: 'บราวนี่หน้านิ่ม', category: 'ขนมอบ', price: 65, stock: 40, images: [art(22, 'slice')], description: 'บราวนี่ฟัดจ์ ท็อปวอลนัท', pinned: true }),
      mk({ name: 'คุกกี้ช็อกชิพ (ถุง 6 ชิ้น)', category: 'ขนมอบ', price: 120, stock: 30, images: [art(38, 'cup')], description: 'กรอบนอกนุ่มใน ช็อกชิพแน่น' }),
      mk({ name: 'ครัวซองต์เนยสด', category: 'ขนมอบ', price: 70, stock: 25, images: [art(42, 'slice')], description: 'เนยแท้ อบใหม่ทุกเช้า' }),
      mk({ name: 'ชีสเค้กนิวยอร์ก (ชิ้น)', category: 'เค้กชิ้น', price: 95, stock: 18, images: [art(45, 'slice')], description: 'ชีสเค้กเนื้อแน่น ฐานบิสกิต' }),
      mk({ name: 'ทีรามิสุ (ถ้วย)', category: 'เค้กชิ้น', price: 85, stock: 3, images: [art(24, 'cup')], description: 'กาแฟหอม ครีมมาสคาร์โปเนนุ่ม' }),
      mk({ name: 'กาแฟลาเต้ร้อน', category: 'เครื่องดื่ม', price: 65, stock: null, images: [art(30, 'drink')], modifierIds: ['md1', 'md3'], description: 'เอสเปรสโซ่ นมสด' }),
      mk({ name: 'ชาเขียวมัทฉะเย็น', category: 'เครื่องดื่ม', price: 75, stock: null, images: [art(105, 'drink')], modifierIds: ['md1', 'md2'], description: 'มัทฉะแท้ หอมละมุน' }),
      mk({ name: 'เค้กมะพร้าวอ่อน 1 ปอนด์ (พร้อมขาย)', category: 'เค้กสำเร็จ', price: 520, stock: null, images: [art(140, 'whole')], description: 'หอมกลิ่นมะพร้าว นุ่มชื่นใจ' }),
    ]
    saveIngredientsExtra()

    // ---------- ลูกค้า ----------
    const NAMES = ['คุณพิมพ์ชนก วงศ์สกุล', 'คุณธนากร ศรีสวัสดิ์', 'คุณนภัสสร แก้วมณี', 'คุณวีระ ปัญญาดี', 'คุณอรทัย บุญเรือง', 'คุณกิตติพงษ์ มั่นคง', 'คุณสุดารัตน์ ใจเย็น', 'คุณปรีชา เจริญสุข',
      'คุณมณีรัตน์ ทองดี', 'คุณชาติชาย สมบูรณ์', 'คุณณัฐธิดา พงษ์ไพร', 'คุณสมศักดิ์ รุ่งเรือง', 'คุณจิราพร อินทร์แก้ว', 'คุณอนุชา ศรีทอง', 'คุณพัชรี มีสุข', 'คุณวรรณา เพชรรัตน์',
      'คุณเกรียงไกร ชัยมงคล', 'คุณลลิตา สุขสันต์', 'คุณภูมิพัฒน์ จันทร์เพ็ญ', 'คุณสิริพร ดวงดี', 'คุณรัฐพล วัฒนา', 'บริษัท ซันไรส์ ดีไซน์ จำกัด', 'โรงเรียนอนุบาลดอกรัก', 'คุณเมษา กาญจนา']
    const TAXED = { 'บริษัท ซันไรส์ ดีไซน์ จำกัด': ['010556800345', '199 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310'], 'โรงเรียนอนุบาลดอกรัก': ['030534500567', '45 หมู่ 3 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540'] }
    const custs = [...db.customers]
    NAMES.forEach((name, i) => {
      const phone = `08${int(10000000, 99999999)}`
      const c = db.customers.find((x) => x.name === name) || (() => {
        const n = { id: '', name, phone, line: i % 3 ? `${['cake', 'sweet', 'yum', 'happy'][i % 4]}.${i}` : '', note: pick(['', '', 'ชอบหวานน้อย', 'แพ้ถั่ว', 'รับของช่วงเย็น', 'ลูกค้าประจำ']) }
        const created = (db.customers.push({ ...n, id: `cd${i + 1}`, active: true, ledger: [], spins: 0, lineUserId: '', fbPsid: '', promoOptIn: chance(0.6), places: [] }), db.customers[db.customers.length - 1])
        return created
      })()
      if (TAXED[name]) c.tax = { name, taxId: taxId(TAXED[name][0]), branch: '00000', address: TAXED[name][1] }
      if (i % 4 === 0) c.lineUserId = `U-demo-${i}`
      else if (i % 5 === 0) c.fbPsid = `PSID-demo-${i}`
      custs.push(c)
    })
    const pool = [...new Set(custs)].filter((c) => !c.deleted)
    // ลูกค้าประจำสั่งบ่อย: ถ่วงน้ำหนักโดยซ้ำชื่อในรายการสุ่ม
    const weighted = pool.flatMap((c, i) => Array(i < 6 ? 5 : i < 14 ? 2 : 1).fill(c))

    // ---------- ออร์เดอร์ ----------
    const ADDR = ['99/9 ซ.สุขุมวิท 50 กรุงเทพฯ', '12 ถ.พระราม 9 ห้วยขวาง กรุงเทพฯ', '55/3 ซ.ลาดพร้าว 71 กรุงเทพฯ', '210 ถ.รัชดาภิเษก ดินแดง กรุงเทพฯ', '8 ซ.อารีย์ 2 พญาไท กรุงเทพฯ', '71/5 ถ.เพชรเกษม บางแค กรุงเทพฯ']
    const MSG = ['HBD แม่ 60 ปี', 'Happy Birthday Mint', 'ขอบคุณที่ดูแลกันเสมอ', 'Congrats!', 'สุขสันต์วันเกิดคุณพ่อ', 'Happy Anniversary', 'HBD ลูกรัก 5 ขวบ', 'ยินดีด้วยนะ', '']
    const COLORS = ['ชมพูพาสเทล + ขาว', 'ฟ้าอ่อน + เหลือง', 'ม่วงลาเวนเดอร์', 'ขาว + ทอง', 'เขียวมินต์', 'แดง + ครีม']
    const TYPE_FLAVOR = { t1: ['sp1', 'sp2', 'sp3', 'sp4', 'sp5'], t2: ['sp2', 'sp3', 'sp4', 'sp5'], t3: ['sp1', 'sp2', 'sp3', 'sp4', 'sp5'], t4: ['sp1', 'sp2', 'sp4'] }
    const tierSel = (big = false) => {
      const type = pick(['t1', 't1', 't2', 't3', 't4'])
      const flavor = pick(TYPE_FLAVOR[type])
      const size = type === 't3' ? pick(['s1', 's2', 's2', 's3']) : pick(big ? ['s2', 's3', 's4'] : ['s1', 's2', 's2', 's3'])
      const s = { g_type: type, g_sponge: flavor, g_size: size, g_shape: pick(['sh1', 'sh1', 'sh2', 'sh3']), g_color: pick(COLORS) }
      if (chance(0.6)) s.g_filling = [pick(['f1', 'f2', 'f3', 'f4', 'f5'])]
      if (chance(0.5)) s.g_topping = [pick(type === 't1' || type === 't4' ? ['tp1', 'tp2', 'tp3', 'tp4', 'tp5'] : ['tp1', 'tp2', 'tp4', 'tp5'])]
      if (chance(0.5)) s.g_deco = [pick(['d1', 'd1', 'd2', 'd5', 'd4'])]
      return s
    }
    const customItem = () => {
      const multi = chance(0.12)
      const tiers = multi ? [tierSel(true), tierSel()] : [tierSel()]
      if (multi) tiers[1].g_type = tiers[0].g_type
      for (const t of tiers) if (!TYPE_FLAVOR[t.g_type].includes(t.g_sponge)) t.g_sponge = TYPE_FLAVOR[t.g_type][0]
      const selections = { g_message: pick(MSG), g_extra: chance(0.5) ? [pick(['x1', 'x2', 'x3', 'x4'])] : [] }
      if (chance(0.15)) selections.g_diet = [pick(['dt1', 'dt2'])]
      const it = { id: `i${Math.floor(rnd() * 1e9)}`, kind: 'custom', name: '', qty: 1, note: pick(['', '', 'ตามรูปตัวอย่าง', 'รับตอนเย็น', 'ขอเทียนเพิ่ม']), images: [], tiers: tiers.map((s) => ({ selections: s })), selections }
      it.name = describeSelections(it, db.optionGroups).map((x) => x.value || x).join(' · ').slice(0, 60) || 'เค้กสั่งทำ'
      return it
    }
    const READY = ['rt8', 'rt9', 'rt10', 'rt11', newItems[7]]
    const readyItem = () => {
      const rid = pick(READY)
      const r = db.retailItems.find((x) => x.id === rid)
      return { id: `i${Math.floor(rnd() * 1e9)}`, kind: 'retail', retailId: r.id, retailPrice: r.price, sizeId: r.sizeId || null, typeId: r.typeId || null, name: r.name, qty: pick([1, 1, 1, 2]), note: '', images: [], selections: chance(0.4) ? { g_message: pick(MSG.filter(Boolean)) } : {} }
    }
    const pickupHours = [[10, 0], [10, 30], [11, 0], [13, 0], [14, 0], [15, 30], [16, 0], [17, 0], [17, 30], [18, 30]]
    const specs = []
    const N = 78
    for (let i = 0; i < N; i++) {
      const created = i < 8 ? T(int(0, 3), int(9, 17), pick([0, 15, 30, 45])) : T(Math.floor(rnd() ** 1.25 * 88) + 1, int(9, 18), pick([0, 15, 30, 45]))
      const lead = int(2, 8)
      const [hh, mm] = pick(pickupHours)
      let pickup = midnight.getTime() - Math.round((midnight.getTime() - created) / DAY - lead) * DAY + hh * H + mm * M
      if (i < 8) pickup = T(-int(1, 6), hh, mm) // ออร์เดอร์ที่ยังไม่ถึงวันรับ (ปฏิทิน/ตารางผลิต)
      const future = pickup > real
      const cust = pick(weighted)
      const delivery = chance(0.3)
      const items = [chance(0.68) ? customItem() : readyItem()]
      if (chance(0.15)) items.push(readyItem())
      specs.push({ i, created, pickup, future, cust, delivery, items, fate: future ? pick(['awaiting', 'reported', 'deposit', 'paid', 'preparing', 'prepared', 'paid']) : chance(0.1) ? 'cancel' : 'delivered' })
    }
    // ลูกค้าวันเกิดใกล้ถึง 3 คน (เตือนวันเกิด)
    ;[5, 9, 12].forEach((d, k) => { specs[10 + k].birthday = { name: ['แม่', 'น้องมิ้นท์', 'พ่อ'][k], md: toDateStr(new RealDate(real + d * DAY)).slice(5, 10) } })
    const orders = []
    for (const s of specs) {
      at(s.created, () => {
        const o = createOrder({
          customerId: s.cust.id, pickupAt: local(s.pickup), fulfillment: s.delivery ? 'delivery' : 'pickup', birthday: s.birthday || null,
          ...(s.delivery ? { address: pick(ADDR), shippingFee: pick([60, 80, 100, 120]) } : {}), items: s.items,
        }, false)
        if (o.error) return
        s.order = o
        orders.push(o)
        if (chance(0.15)) { const l = createOrderLink(o); if (l.ok && chance(0.5) && s.cust.lineUserId) { /* ส่งลิงก์ให้ลูกค้าบางราย */ void l } }
        if (s.fate === 'awaiting') return
        const tot = () => orderTotals(o)
        const method = pick(['โอนเงิน', 'โอนเงิน', 'พร้อมเพย์', 'เงินสด'])
        if (s.fate === 'reported') { reportPayment(o, { amount: Math.round(tot().total / 2 / 10) * 10, method: 'โอนเงิน', paidAt: local(clock) }); return }
        const mode = pick(['full', 'full', 'deposit', 'deposit', 'report'])
        if (mode === 'full' || s.fate === 'paid') at(s.created + int(10, 180) * M, () => receivePaymentNow(o, { amount: tot().total, method, paidAt: local(clock) }))
        else if (mode === 'report') at(s.created + int(5, 90) * M, () => { reportPayment(o, { amount: tot().total, method, paidAt: local(clock) }); const p = o.payments.at(-1); if (p) confirmPayment(o, p.id) })
        else {
          at(s.created + int(10, 120) * M, () => receivePaymentNow(o, { amount: Math.round(tot().total / 2 / 10) * 10, method, paidAt: local(clock) }))
          if (s.fate === 'delivered' || s.fate === 'prepared' || s.fate === 'preparing') at(Math.min(s.pickup - int(60, 600) * M, real - 2 * M), () => { if (tot().balance > 0) receivePaymentNow(o, { amount: tot().balance, method: pick(['เงินสด', 'โอนเงิน']), paidAt: local(clock) }) })
        }
        if (s.fate === 'cancel') at(s.created + int(1, 3) * DAY, () => {
          const paid = tot().paid
          cancelOrder(o, { reason: pick(['ลูกค้าเปลี่ยนแผน', 'ลูกค้าเลื่อนงาน', 'สั่งซ้ำ ยกเลิกอีกใบ']), refunds: paid > 0 ? [{ method: 'transfer', amount: paid }] : [], refundNote: paid > 0 ? 'โอนคืนตามสลิป' : '' })
        })
        if (['preparing', 'prepared', 'delivered'].includes(s.fate)) {
          const prepT = Math.min(s.pickup - int(8, 30) * H, real - 3 * M)
          at(Math.max(prepT, s.created + 30 * M), () => { if (o.status === 'payment_confirmed' && tot().balance > 0 && s.fate !== 'delivered') { /* ยังไม่จ่ายครบ แต่เริ่มทำได้ */ } if (o.status === 'payment_confirmed') setStatus(o, 'preparing', 'เริ่มเตรียมสินค้า') })
        }
        if (['prepared', 'delivered'].includes(s.fate)) at(Math.min(s.pickup - int(60, 240) * M, real - 2 * M), () => { if (o.status === 'preparing') setStatus(o, 'prepared', 'เตรียมสินค้าเสร็จแล้ว') })
        if (s.fate === 'delivered') {
          if (s.delivery) {
            at(s.pickup - 50 * M, () => { if (o.status === 'prepared') setStatus(o, 'ready_to_ship', 'พร้อมจัดส่ง') })
            at(s.pickup - 40 * M, () => { if (o.status === 'ready_to_ship') setStatus(o, 'shipping', 'กำลังจัดส่ง') })
          }
          at(Math.min(s.pickup + int(0, 25) * M, real - M), () => {
            if (o.status === 'preparing') setStatus(o, 'prepared', 'เตรียมสินค้าเสร็จแล้ว')
            if (s.delivery && o.status === 'prepared') { setStatus(o, 'ready_to_ship', 'พร้อมจัดส่ง'); setStatus(o, 'shipping', 'กำลังจัดส่ง') }
            setStatus(o, 'delivered', s.delivery ? 'ส่งมอบแล้ว (จัดส่ง)' : 'ลูกค้ารับสินค้าแล้ว')
          })
        }
      })
    }

    // ---------- แชท + ใบเสนอ ----------
    const chats = {}
    const chatFor = (ch, id, name, msgs, tMs) => {
      msgs.forEach(([from, text], k) => at(tMs + k * int(1, 6) * M, () => {
        if (from === 'c') chats[id] = receiveMessage(ch, id, name, text, local(clock) && new RealDate(clock).toISOString())
        else if (chats[id]) sendChat(chats[id].id, 'staff', text, { by: pick(['sales', 'admin']), at: new RealDate(clock).toISOString() })
      }))
    }
    const named = (n) => pool.find((c) => c.name.includes(n))
    const hasChat = (id) => db.chats.some((ch) => ch.externalId === id)
    const lineCust = pool.filter((c) => c.lineUserId && !hasChat(c.lineUserId)).slice(0, 5)
    lineCust.forEach((c, k) => {
      chatFor('line', c.lineUserId, c.name.replace('คุณ', ''), [
        ['c', pick(['สวัสดีค่ะ อยากสั่งเค้กวันเกิด 2 ปอนด์ค่ะ', 'สอบถามราคาเค้กหน้านิ่ม 1 ปอนด์ค่ะ', 'มีเค้กช็อกโกแลตพร้อมรับวันนี้ไหมคะ', 'ขอดูแบบเค้กที่เคยทำหน่อยค่ะ']) ],
        ['s', 'สวัสดีค่ะ ต้องการรับวันไหน เวลากี่โมงคะ'], ['c', pick(['วันเสาร์นี้ช่วงบ่ายค่ะ', 'พรุ่งนี้เย็นๆ ค่ะ', 'อาทิตย์หน้าค่ะ'])], ['s', 'ได้ค่ะ เดี๋ยวส่งใบเสนอราคาให้นะคะ'],
      ], T(14 - k * 3, 10 + k, 5))
    })
    const fbCust = pool.filter((c) => c.fbPsid && !hasChat(c.fbPsid)).slice(0, 2)
    fbCust.forEach((c, k) => chatFor('facebook', c.fbPsid, c.name.replace('คุณ', ''), [['c', 'สนใจเค้กงานเลี้ยง 5 ปอนด์ค่ะ ราคาเท่าไหร่คะ'], ['s', 'ราคาเริ่มต้น 2,000 บาทค่ะ ขึ้นกับแบบและการตกแต่ง'], ['c', 'ขอบคุณค่ะ เดี๋ยวปรึกษาที่บ้านก่อนนะคะ']], T(5 + k * 7, 13, 20)))
    chatFor('line', 'U-new-1', 'Ploy_K', [['c', 'สวัสดีค่ะ ร้านเปิดกี่โมงคะ'], ['s', 'เปิด 09:00–20:00 ทุกวันค่ะ'], ['c', 'มีที่จอดรถไหมคะ']], T(1, 9, 40))
    chatFor('line', 'U-new-2', 'บีม 🎂', [['c', 'ขอสั่งเค้กฟองดองท์ลายการ์ตูนได้ไหมครับ']], T(0, 8, 15))
    // ใบเสนอ: ยืนยันแล้ว / รอตอบ / ขอแก้ไข
    const quoteDraft = (daysAhead) => ({ pickupAt: local(T(-daysAhead, 14, 0)), fulfillment: 'pickup', items: [{ ...customItem(), id: `i${int(1e8, 9e8)}` }] })
    const quotes = lineCust.slice(0, 3)
    quotes.forEach((c, k) => at(T(8 - k * 2, 15, 30), () => {
      const ch = chats[c.lineUserId]
      if (!ch) return
      if (!ch.customerId) ch.customerId = c.id
      const q = sendQuote(ch.id, quoteDraft(k + 3))
      if (!q) return
      if (k === 0) at(clock + 40 * M, () => { const r = acceptQuote(q.id); if (r.order) { orders.push(r.order); at(clock + 20 * M, () => receivePaymentNow(r.order, { amount: Math.round(orderTotals(r.order).total / 2 / 10) * 10, method: 'โอนเงิน', paidAt: local(clock) })) } })
      if (k === 1) at(clock + 60 * M, () => reviseQuote(q.id, 'ขอเปลี่ยนเป็นเนื้อช็อกโกแลตค่ะ'))
    }))
    // การ์ดออร์เดอร์ในแชท
    at(T(1, 18, 0), () => { const o = orders.find((x) => x.customerId === lineCust[1]?.id); if (o && chats[lineCust[1].lineUserId]) postOrderCard(o, chats[lineCust[1].lineUserId]) })

    // ---------- เรียกใช้เหตุการณ์ตามลำดับเวลา ----------
    let guardN = 0
    while (events.length && guardN++ < 20000) {
      events.sort((a, b) => a.t - b.t || a.n - b.n)
      const e = events.shift()
      clock = Math.min(e.t, real - M)
      try { e.fn() } catch { /* ข้ามรายการที่ผิดเงื่อนไข */ }
    }

    // ---------- รูปงานเสร็จ + แกลเลอรี ----------
    clock = T(0, 9, 0)
    let photoIdx = 0
    for (const o of [...db.orders].filter((x) => x.status === 'delivered' && !x.channel).reverse()) {
      const it = o.items.find((i) => i.kind === 'custom')
      if (!it || !o.customerId) continue
      clock = Math.min(new RealDate(o.deliveredAt).getTime() + int(5, 90) * M, real - M)
      const tier = it.tiers?.[0]?.selections || {}
      const n = it.tiers?.length || 1
      const r = addWorkPhotos(o, it.id, [art((photoIdx * 37 + 11) % 360, 'tier' + Math.min(3, n))], { notify: false })
      photoIdx++
      if (!r.ok) continue
      if (chance(0.75)) publishWorkPhoto(o, it.id, r.photos[0].id, { tags: [tier.g_type, tier.g_sponge, tier.g_size, ...(chance(0.4) && tier.g_shape ? [tier.g_shape] : []), ...(chance(0.4) && tier.g_deco ? tier.g_deco : [])].filter(Boolean), caption: pick(['', '', 'เค้กวันเกิด', 'ตกแต่งตามธีมลูกค้า', 'เค้กฉลองครบรอบ']) })
    }
    // รูปของออร์เดอร์ที่เตรียมเสร็จแล้ว (ยังไม่ส่งมอบ ยังไม่เผยแพร่)
    for (const o of db.orders.filter((x) => x.status === 'prepared').slice(0, 2)) { const it = o.items.find((i) => i.kind === 'custom'); if (it) addWorkPhotos(o, it.id, [art(int(0, 359), 'tier1')], { notify: false }) }
    // ลูกค้าขอไม่เผยแพร่รูป 1 ออร์เดอร์ (ที่ยังไม่ได้เผยแพร่)
    const optOut = db.orders.find((o) => o.status === 'delivered' && o.items.some((i) => i.workPhotos?.length && !i.workPhotos.some((p) => p.publish)))
    if (optOut) { customerSession.customerId = optOut.customerId; customerRequestPhotoOptOut({ orderId: optOut.id }, 'ขอไม่ลงรูปในเว็บนะคะ'); customerSession.customerId = null }

    // ---------- คลิกดูแบบ (นิรนาม) เพื่อระบบแนะนำ ----------
    clock = T(0, 9, 30)
    const gal = db.cakeGallery.filter((g) => g.active !== false)
    const typeOf = (g) => g.tags.find((t) => ['t1', 't2', 't3', 't4'].includes(t))
    for (let v = 1; v <= 44; v++) {
      const fav = pick(['t1', 't2', 't3', 't4'])
      const k = int(2, 6)
      for (let j = 0; j < k; j++) {
        const cands = chance(0.7) ? gal.filter((g) => typeOf(g) === fav) : gal
        const g = pick(cands.length ? cands : gal)
        if (g) { clock = T(int(0, 60), int(8, 21), int(0, 59)); recordCakeClick(g.id, `v${v}`) }
      }
    }

    // ---------- คะแนน/คูปอง/กาชา ----------
    const top = [...pool].sort((a, b) => b.ledger.reduce((s, l) => s + l.delta, 0) - a.ledger.reduce((s, l) => s + l.delta, 0))
    top.slice(0, 8).forEach((c, k) => {
      clock = T(int(3, 40), int(9, 19), 10)
      const bal = () => c.ledger.reduce((s, l) => s + (l.remaining || 0), 0)
      if (bal() >= 100 && k % 2 === 0) redeemReward(c, 'rw4')
      if (bal() >= 30) redeemReward(c, 'rw1')
      if (bal() >= 80 && k % 3 === 0) redeemReward(c, 'rw2')
      for (let s = 0; s < 2 && c.spins > 0; s++) { clock = T(int(1, 30), int(9, 19), 20); spinGacha(c, false) }
    })
    const c0 = db.customers[0]; c0.spins = 2

    // ---------- รีวิว ----------
    const REV = ['เค้กอร่อยมากค่ะ นุ่มไม่หวานเกินไป ตรงตามแบบที่สั่งเป๊ะ', 'พนักงานบริการดี ส่งตรงเวลา เค้กสวยกว่าในรูป', 'สั่งให้ลูกวันเกิด ทุกคนชอบมาก จะกลับมาอุดหนุนอีกแน่นอน', 'ราคาไม่แรง รสชาติดี ครีมไม่เลี่ยน', 'เนื้อเค้กชุ่มฉ่ำ ตกแต่งสวยละเอียด', 'แพ็กมาอย่างดี เค้กไม่เสียทรงเลยค่ะ', 'อร่อยสมคำร่ำลือ ติดใจเรดเวลเวท', 'ตอบแชทไว ให้คำแนะนำดี']
    const doneOrders = db.orders.filter((o) => o.status === 'delivered' && !o.channel && o.customerId)
    doneOrders.slice(0, 16).forEach((o, k) => {
      clock = Math.min(new RealDate(o.deliveredAt).getTime() + int(1, 3) * DAY, real - M)
      customerSession.customerId = o.customerId
      const r = submitReviewLocal({ orderId: o.id, rating: pick([5, 5, 5, 4, 4, 3]), text: REV[k % REV.length] })
      customerSession.customerId = null
      const rv = db.reviews.find((x) => x.orderId === o.id)
      if (r.ok && rv) setReviewStatus(rv.id, k < 11 ? 'approved' : k < 13 ? 'rejected' : 'pending')
    })
    ;[['คุณแพร', 'เค้กสวย อร่อย ประทับใจมากค่ะ'], ['คุณโอ๊ต', 'สั่งมาหลายรอบ คุณภาพคงที่ ชอบเค้กหน้านิ่ม'], ['คุณฟ้า', 'บราวนี่หน้านิ่มอร่อยสุด ๆ'], ['คุณแบงค์', 'ร้านน่ารัก เค้กสดใหม่ทุกครั้ง']].forEach(([name, text], k) => { clock = T(20 + k * 9, 14); saveReview({ name, text, rating: k === 1 ? 4 : 5 }) })

    // ---------- POS: กะ + ขายหน้าร้าน ----------
    const retailForPos = db.retailItems.filter((r) => r.showInPos !== false && r.active !== false && r.id !== 'rt7')
    const shiftDays = [34, 31, 29, 26, 24, 21, 19, 16, 13, 10, 7, 4, 2]
    const sell = (n, tStart, tEnd) => {
      for (let k = 0; k < n; k++) {
        clock = Math.min(tStart + Math.floor(((tEnd - tStart) * (k + rnd() * 0.8)) / n), real - M)
        const lines = Array.from({ length: int(1, 3) }, () => {
          const r = pick(retailForPos)
          const mods = (r.modifierIds || []).map((id) => { const g = db.posModifiers.find((m) => m.id === id); return g?.required ? { groupId: g.id, optionId: pick(g.options).id } : null }).filter(Boolean)
          return { kind: 'retail', refId: r.id, qty: int(1, 3), mods }
        }).filter((l, i, a) => a.findIndex((x) => x.refId === l.refId) === i)
        const member = chance(0.18) ? pick(pool) : null
        posSale({ cart: lines, customerId: member?.id || null, method: pick(['cash', 'cash', 'transfer', 'card']), received: pick([100, 200, 500, 1000]) })
      }
    }
    for (const d of shiftDays) {
      clock = T(d, 8, 25)
      openShift(pick([500, 1000, 1000, 2000]))
      sell(int(7, 11), T(d, 9, 0), T(d, 19, 30))
      clock = T(d, 20, 10)
      const sh = currentShift()
      const exp = shiftSummary(sh).expectedCash
      closeShift(exp + pick([0, 0, 0, -20, 10, -50]), pick(['', '', 'เงินทอนขาดเล็กน้อย', 'ปิดกะปกติ']))
    }
    // กะวันนี้ (ยังเปิดอยู่)
    clock = Math.max(T(0, 0, 5), real - 4 * H)
    openShift(1000)
    sell(8, clock, real - 5 * M)

    // ---------- คืนเงินบางส่วน (ไม่ยกเลิก): ออร์เดอร์ที่ส่งมอบแล้ว 3 ใบ (เงินสด / โอน / คะแนน) + บิล POS กะวันนี้ 1 ใบ ----------
    const refundable = db.orders.filter((o) => o.status === 'delivered' && !o.channel && o.customerId && orderTotals(o).paidNet >= 300)
    const pv = Number(db.loyalty.pointValue) || 1
    ;[['cash', 'ชดเชยส่งช้า'], ['transfer', 'ลูกค้าแจ้งของไม่ครบ ร้านคืนบางส่วน'], ['points', 'ชดเชยตกแต่งไม่ตรงแบบ']].forEach(([method, reason], k) => {
      const o = refundable[k * 3]
      if (!o) return
      clock = Math.min(new RealDate(o.deliveredAt).getTime() + int(1, 2) * DAY, real - M)
      const amount = method === 'points' ? pv * Math.max(1, Math.round(60 / pv)) : [50, 100, 40][k]
      refundOrder(o, { reason, refunds: [{ method, amount }], notify: false })
    })
    const todayBill = shiftBills(currentShift().id).find((o) => o.status !== 'cancelled' && orderTotals(o).paidNet >= 60)
    if (todayBill) { clock = real - 2 * M; refundOrder(todayBill, { reason: 'ลูกค้าคืนสินค้า 1 ชิ้น', refunds: [{ method: 'cash', amount: 20 }] }) }

    // ---------- สต็อกสุดท้าย (หลังขาย POS) ----------
    const finalStock = { rt1: 14, rt2: 7, rt3: 36, rt4: 0, rt7: 120 }
    for (const [id, n] of Object.entries(finalStock)) db.retailItems.find((x) => x.id === id).stock = n
    db.retailItems.find((x) => x.name.startsWith('ทีรามิสุ')).stock = 3
    db.retailItems.find((x) => x.name.startsWith('ครัวซองต์')).stock = 5

    // ---------- โปรโมชัน ----------
    clock = real
    Object.assign(db.posDiscounts.find((d) => d.id === 'pd1'), { name: 'เครื่องดื่มลด 10%', active: true })
    // ดีล (ซื้อแถม/ครบลด/ครบฟรี/ชิ้นที่ N/add-on/ส่งฟรี)
    for (const id of ['dl1', 'dl2', 'dl3']) db.posDeals.find((d) => d.id === id).active = true
    saveDeal({ kind: 'nth', name: 'ซื้อบราวนี่/คุกกี้ 3 จ่าย 2', scope: 'category', categories: ['ขนมอบ'], n: 3, percent: 100, active: true, schedule: blankSchedule() })
    saveDeal({ kind: 'spend_addon', name: 'ครบ 500 ซื้อคัพเค้กวานิลลา 29 บาท', min: 500, itemId: 'rt3', price: 29, limit: 1, active: true, schedule: blankSchedule() })
    saveDeal({ kind: 'free_ship', name: 'ส่งฟรีเมื่อซื้อครบ 1,500', min: 1500, active: true, schedule: blankSchedule() })
    savePosDiscount({ name: 'ขนมอบลด 15% ทั้งสัปดาห์', type: 'percent', value: 15, scope: 'category', categories: ['ขนมอบ'], itemIds: [], minSpend: 0, active: true, schedule: blankSchedule() })

    // ---------- บัญชี ----------
    seedAccounting({ T, real, local, rnd, int, pick, chance })
  } finally {
    globalThis.Date = RealDate
    Math.random = realRandom
    Object.assign(session, savedSession)
    customerSession.customerId = savedCust
  }
  // กระดิ่ง: ของเก่ากว่า 1 วันถือว่าอ่านแล้ว (เหลือที่เพิ่งเกิดให้เห็นป้ายตัวเลข)
  const staffIds = db.users.map((u) => u.id)
  for (const i of db.bell) {
    if (Date.now() - new Date(i.at).getTime() <= 24 * 3600e3) continue
    if (i.audience === 'staff') i.readBy = [...staffIds]
    else i.read = true
  }
  return { ms: Math.round(performance.now() - t0), orders: db.orders.length, customers: db.customers.length }

  function saveIngredientsExtra() {
    ;[
      { name: 'นมสดพาสเจอร์ไรส์', unit: 'ml', packSize: 2000, packPrice: 78 }, { name: 'ครีมชีส', unit: 'g', packSize: 1000, packPrice: 320 }, { name: 'ช็อกโกแลตแท่ง', unit: 'g', packSize: 500, packPrice: 210 },
      { name: 'ผงชาไทย', unit: 'g', packSize: 500, packPrice: 180 }, { name: 'วานิลลาสกัด', unit: 'ml', packSize: 100, packPrice: 140 }, { name: 'ผงมัทฉะ', unit: 'g', packSize: 200, packPrice: 380 },
      { name: 'เมล็ดกาแฟคั่ว', unit: 'g', packSize: 1000, packPrice: 520 }, { name: 'ริบบิ้น/โบว์', unit: 'ชิ้น', packSize: 100, packPrice: 150 },
    ].forEach((d) => saveIngredient({ ...d, active: true }))
  }
}

// ---------- บัญชี ----------
function seedAccounting({ T, real, local, int, pick, chance }) {
  const D = (daysAgo) => toDateStr(new Date(T(daysAgo, 12)))
  const ymOf = (monthsAgo) => { const d = new Date(real); d.setDate(1); d.setMonth(d.getMonth() - monthsAgo); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  const day = (ym, dd) => `${ym}-${String(dd).padStart(2, '0')}`
  const accs = Object.fromEntries(db.acct.accounts.map((a) => [a.name, a.id]))
  const find = (kw, kind) => db.acct.accounts.find((a) => a.name.includes(kw) && (!kind || a.kind === kind))?.id || db.acct.accounts.find((a) => a.kind === kind)?.id
  const exp = {
    rent: find('เช่า', 'expense'), util: find('น้ำ', 'expense') || find('ไฟ', 'expense'), raw: find('วัตถุดิบ', 'expense') || find('ซื้อ', 'expense'), wage: find('เงินเดือน', 'expense') || find('ค่าจ้าง', 'expense'),
    ad: find('โฆษณา', 'expense') || find('การตลาด', 'expense'), pack: find('บรรจุ', 'expense') || find('วัสดุ', 'expense'), misc: find('เบ็ดเตล็ด', 'expense') || find('อื่น', 'expense'),
  }
  void accs
  const fall = db.acct.accounts.find((a) => a.kind === 'expense')?.id
  const E = (k) => exp[k] || fall
  // ค่าใช้จ่ายประจำ
  const recs = [
    { name: 'ค่าเช่าร้าน', account: E('rent'), kind: 'fixed', amount: 18000, dueDay: 5, settle: 'bank', autoPost: false, payee: 'คุณสมชาย (ผู้ให้เช่า)' },
    { name: 'ค่าไฟฟ้า', account: E('util'), kind: 'variable', estimate: 5200, dueDay: 20, settle: 'bank', payee: 'การไฟฟ้านครหลวง' },
    { name: 'ค่าน้ำประปา', account: E('util'), kind: 'variable', estimate: 450, dueDay: 22, settle: 'cash', payee: 'การประปานครหลวง' },
    { name: 'เงินเดือนพนักงาน', account: E('wage'), kind: 'fixed', amount: 36000, dueDay: 30, settle: 'bank', autoPost: false, payee: 'พนักงาน' },
  ]
  const ids = recs.map((r) => acct.saveRecurring({ ...r, graceDays: 3, startMonth: ymOf(3) }).item?.id)
  // โพสต์ย้อนหลัง 3 เดือน (เดือนปัจจุบันปล่อยค้างบางรายการให้เห็นสถานะ)
  for (let m = 3; m >= 1; m--) {
    const ym = ymOf(m)
    ids.forEach((id, k) => {
      if (!id) return
      const amt = k === 1 ? int(4600, 6100) : k === 2 ? int(380, 560) : undefined
      if (k === 2 && m === 2) { acct.skipRecurring(id, ym, 'มิเตอร์เสีย ประปาไม่ได้เก็บเดือนนี้'); return }
      acct.postRecurring(id, ym, { amount: amt, date: day(ym, [5, 20, 22, 28][k]) })
    })
  }
  // บันทึกรายรับ/จ่ายเอง
  const manual = (daysAgo, kind, account, amount, settle, memo, extra = {}) => acct.saveManual({ kind, date: D(daysAgo), account, amount, vatMode: 'none', vatRate: 7, settle, memo, ...extra })
  const incomeAcc = db.acct.accounts.find((a) => a.kind === 'revenue')?.id
  for (let k = 0; k < 14; k++) {
    manual(int(2, 85), 'expense', E('raw'), int(800, 4200), pick(['cash', 'bank']), pick(['ซื้อแป้ง/น้ำตาล แม็คโคร', 'ซื้อครีม/ชีส', 'ซื้อผลไม้สด ตลาดไท', 'ซื้อไข่/เนย', 'ซื้อช็อกโกแลต']), { payee: pick(['แม็คโคร', 'ตลาดไท', 'ร้านวัตถุดิบเบเกอรี่']), vatMode: chance(0.5) ? 'included' : 'none', claimable: chance(0.5), taxInvoiceNo: chance(0.5) ? `TI${int(10000, 99999)}` : '', taxInvoiceDate: D(int(2, 85)) })
  }
  for (let k = 0; k < 4; k++) manual(int(5, 80), 'expense', E('pack'), int(500, 1800), 'cash', pick(['กล่องเค้ก/ถุง', 'ริบบิ้น/สติกเกอร์', 'ถาดรอง']))
  for (let k = 0; k < 3; k++) manual(int(10, 80), 'expense', E('ad'), pick([800, 1200, 1500]), 'bank', 'ค่าโฆษณา Facebook/IG')
  for (let k = 0; k < 2; k++) manual(int(10, 70), 'income', incomeAcc, pick([1500, 2400]), 'bank', 'ค่าสอนทำเค้ก/เวิร์กช็อป')
  // สินทรัพย์
  const asset = (name, category, cost, life, daysAgo, acquire) => acct.saveAsset({ name, category, cost, salvage: 1, lifeYears: life, method: 'sl', buyDate: D(daysAgo), startDate: D(daysAgo - 1), acquire })
  asset('เตาอบ Deck 2 ชั้น', 'equipment', 68000, 5, 80, 'bank')
  asset('ตู้เย็นโชว์เค้ก', 'equipment', 32500, 5, 62, 'cash')
  asset('เครื่องตีแป้ง 20 ลิตร', 'equipment', 24000, 5, 45, 'bank')
  asset('คอมพิวเตอร์/POS', 'computer', 18900, 3, 70, 'cash')
  // จ่ายล่วงหน้า/รับล่วงหน้า
  acct.saveDeferral({ kind: 'prepaid', name: 'ประกันอัคคีภัยร้าน 1 ปี', total: 7200, months: 12, startMonth: ymOf(2), payDate: day(ymOf(2), 3), account: E('misc'), method: 'bank' })
  acct.saveDeferral({ kind: 'unearned', name: 'มัดจำเค้กงานแต่ง (รอส่งมอบ)', total: 6000, months: 1, startMonth: ymOf(0), payDate: D(6), account: incomeAcc, method: 'bank' })
  // ผ่อนชำระ: ซื้อเครื่องผสมแบบผ่อน (ลงบัญชีสินทรัพย์) / เงินกู้
  const loan = acct.saveInstallment({ kind: 'loan', name: 'เงินกู้ SME ซื้ออุปกรณ์', principal: 60000, ratePct: 6, n: 12, method: 'reducing', startDate: D(88), firstDue: day(ymOf(2), 28), receive: 'bank' })
  if (loan.installment) { acct.payInstallment(loan.installment.id, { date: day(ymOf(2), 28), method: 'bank' }); acct.payInstallment(loan.installment.id, { date: day(ymOf(1), 28), method: 'bank' }) }
  // ใบกำกับภาษีเต็มรูป: ออร์เดอร์ที่ส่งมอบ ชำระครบ และลูกค้ามีข้อมูลภาษี
  const eligible = db.orders.filter((o) => o.status === 'delivered' && o.vat && findCustomer(o.customerId)?.tax?.taxId)
  const all = eligible.length ? eligible : db.orders.filter((o) => o.status === 'delivered' && o.vat).slice(0, 6)
  const buyerDefault = { name: 'บริษัท ซันไรส์ ดีไซน์ จำกัด', taxId: db.customers.find((c) => c.tax?.taxId)?.tax.taxId || '', branch: '00000', address: '199 ถนนพระราม 9 แขวงห้วยขวาง กรุงเทพมหานคร 10310' }
  let made = 0
  for (const o of (all.length >= 5 ? all : db.orders.filter((x) => x.status === 'delivered' && x.vat)).slice(0, 8)) {
    const r = acct.issueTaxInvoice(o.id, findCustomer(o.customerId)?.tax?.taxId ? null : buyerDefault)
    if (r.ok) { made++; if (made === 3) acct.voidTaxInvoice(r.invoice.id, 'ออกผิดชื่อผู้ซื้อ') }
  }
  // ปิดงวด/ยื่น VAT เดือนที่ผ่านมา (ทำท้ายสุด: ล็อกการลงรายการย้อนหลัง)
  const prev = ymOf(1)
  const end = new Date(`${prev}-01T00:00:00`); end.setMonth(end.getMonth() + 1); end.setDate(0)
  const m2 = ymOf(2)
  const e2 = new Date(`${m2}-01T00:00:00`); e2.setMonth(e2.getMonth() + 1); e2.setDate(0)
  for (const m of [4, 3, 2]) { const ym = ymOf(m); const r = acct.vatMarkFiled(ym, { filedAt: day(ymOf(m - 1), 12), ref: `ภพ30-${ym}`, paid: 0 }); if (r.error && globalThis.__DEMO_DEBUG) console.warn(ym, r.error) }
  acct.closePeriod(toDateStr(e2))
  void end; void local
}

// ---------- ตัวช่วย ----------
function taxId(base12) {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base12[i]) * (13 - i)
  return base12 + String((11 - (sum % 11)) % 10)
}
// รูปเค้กวาดด้วย SVG (data URI) ใช้แทนรูปถ่ายตัวอย่าง
function svgCake(hue, kind) {
  const c = (l, s = 70) => `hsl(${hue},${s}%,${l}%)`
  const bg = `<rect width="300" height="300" fill="hsl(${(hue + 30) % 360},45%,92%)"/><ellipse cx="150" cy="262" rx="110" ry="14" fill="#fff" stroke="#e8d9c5"/>`
  let body = ''
  const tier = (cx, y, w, h) => `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="10" fill="${c(80)}"/><rect x="${cx - w / 2}" y="${y}" width="${w}" height="${Math.round(h * 0.28)}" rx="10" fill="${c(93, 60)}"/>`
  if (kind.startsWith('tier')) {
    const n = Number(kind.slice(4)) || 1
    if (n === 1) body = tier(150, 150, 150, 100) + `<circle cx="150" cy="140" r="14" fill="${c(55)}"/><circle cx="118" cy="146" r="8" fill="${c(65)}"/><circle cx="182" cy="146" r="8" fill="${c(65)}"/>`
    else if (n === 2) body = tier(150, 185, 170, 70) + tier(150, 120, 120, 66) + `<circle cx="150" cy="112" r="12" fill="${c(55)}"/>`
    else body = tier(150, 200, 180, 56) + tier(150, 148, 130, 52) + tier(150, 100, 84, 48) + `<circle cx="150" cy="92" r="10" fill="${c(55)}"/>`
  } else if (kind === 'whole') body = tier(150, 150, 160, 100) + `<path d="M70 150 Q110 120 150 150 T230 150" fill="none" stroke="${c(55)}" stroke-width="6"/>`
  else if (kind === 'slice') body = `<path d="M70 230 L230 230 L200 140 L100 140 Z" fill="${c(78)}"/><path d="M100 140 L200 140 L190 170 L110 170 Z" fill="${c(92, 60)}"/><circle cx="150" cy="132" r="12" fill="${c(50)}"/>`
  else if (kind === 'cup') body = `<path d="M100 170 L200 170 L186 245 L114 245 Z" fill="${c(70, 55)}"/><ellipse cx="150" cy="168" rx="58" ry="26" fill="${c(90, 60)}"/><circle cx="150" cy="140" r="14" fill="${c(55)}"/>`
  else body = `<path d="M105 120 L195 120 L182 250 L118 250 Z" fill="${c(76)}" opacity=".9"/><rect x="110" y="120" width="80" height="26" fill="${c(92, 60)}"/><rect x="146" y="72" width="8" height="60" rx="4" fill="${c(45)}"/>`
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">${bg}${body}</svg>`)}`
}
void priceItem; void sendOrderLinkToChat; void saveGalleryImage
