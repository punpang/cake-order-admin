<script setup>
import { orderNo } from '../lib/format'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  db, can, currentShift, openShift, closeShift, shiftSummary, shiftBills, posPromoInfo, posSale, voidPosSale, pointsFor, quickMember, vatNow,
  customerPoints, posCoupons, findCustomer, modsOf, modsText, lineKey, pendingRewards, notShownCount, posHandOver, posCouponProblem, sweepCoupons, claimPosCoupons, releaseCoupons,
  newPosQrRef, posQrExpired,
} from '../data/store'
import { activeSecondsLeft } from '../lib/loyalty'
import { orderTotals } from '../lib/pricing'
import { pointPromoFor } from '../lib/posPromo'
import { coBought, rankSellers, suggestBundles } from '../lib/posRec'
import { POS_METHODS, ROLES } from '../lib/constants'
import { askConfirm } from '../lib/confirm'
import { refreshLabels } from '../lib/staffAuth'
import { waitSaved } from '../lib/syncStatus'
import { showToast } from '../lib/toast'
import { quietly } from '../lib/loading'
import { money, dateTime, timeOnly, phoneDigits, formatPhone, phoneValid } from '../lib/format'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import DiscountDetail from '../components/DiscountDetail.vue'
import Receipt from '../components/Receipt.vue'
import PhoneInput from '../components/PhoneInput.vue'
import RefundEditor from '../components/RefundEditor.vue'
import RefundPartialDialog from '../components/RefundPartialDialog.vue'
import ChangeBuyerModal from '../components/ChangeBuyerModal.vue'
import TaxInvoiceModal from '../components/TaxInvoiceModal.vue'
import { invoiceOfOrder } from '../data/acct'
import { defaultRefundMethod } from '../lib/refund'
import BillerQr from '../components/BillerQr.vue'
import { listManeeTransfers } from '../lib/maneeRemote'

// POS หน้าร้าน: เปิดกะ → ขาย (ตะกร้า สมาชิก คูปอง ส่วนลด + โปรโมชัน/บันเดิ้ลอัตโนมัติ) → ชำระ (เงินสด/โอน/บัตร + ทอน) → ใบเสร็จ · บิล · ปิดกะ
// สะสมคะแนนจากยอดสุทธิ (โปรคะแนนพิเศษคูณได้) · ไม่ใช้คะแนนตรง ๆ: ลูกค้าแลกคะแนนเป็นคูปองที่หน้าเว็บ แล้วใช้คูปองที่นี่
const shift = computed(() => currentShift())
const tab = ref('sell')

// ---------- เปิดกะ ----------
const float = ref('')
function doOpen() {
  openShift(Number(float.value) || 0)
  float.value = ''
}

// ---------- สินค้า ----------
// สินค้าที่แสดงใน POS = สินค้าที่เปิดใช้งาน + เปิด "แสดงใน POS" (สวิตช์แยกจากหน้าร้านเว็บ)
const catalog = computed(() =>
  db.retailItems.filter((r) => r.active !== false && r.showInPos !== false).map((r) => ({ kind: 'retail', id: r.id, name: r.name, category: r.category || 'อื่น ๆ', price: r.price, stock: r.stock ?? null, modifierIds: r.modifierIds || [], image: r.images?.[0] || '' })),
)
const pointTag = (x) => pointPromoFor({ retailId: x.id, category: x.category }, db.pointPromos)
const categories = computed(() => [...new Set(catalog.value.map((x) => x.category))])
const cat = ref('')
const q = ref('')
// อันดับขายดี 30 วัน (ติดดาว 5 อันดับแรก) · เรียงตามขายดีได้
const ranks = computed(() => rankSellers(db.orders, db.retailItems))
const sortBest = ref(false)
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  const list = catalog.value.filter((x) => (!cat.value || x.category === cat.value) && (!s || x.name.toLowerCase().includes(s)))
  if (!sortBest.value) return list
  const r = (x) => ranks.value.get(x.id)?.rank ?? Infinity
  return list.slice().sort((a, b) => r(a) - r(b))
})

// ---------- ตะกร้า ----------
const cart = ref([]) // [{ kind, refId, qty, mods: [{ groupId, optionId }] }] แยกบรรทัดตามชุดตัวเลือก
// จำนวนในตะกร้าของสินค้า (รวมทุกบรรทัด ใช้ตรวจสต็อก)
const inCart = (x) => cart.value.filter((l) => l.kind === x.kind && l.refId === x.id).reduce((s, l) => s + l.qty, 0)
const canAdd = (x, n = 1) => x.stock == null || inCart(x) + n <= x.stock
const itemOf = (l) => catalog.value.find((c) => c.kind === l.kind && c.id === l.refId)
const groupsOf = (x) => (x.modifierIds || []).map((id) => db.posModifiers.find((m) => m.id === id)).filter((g) => g && g.active !== false && g.options.length)
const linePrice = (l) => (itemOf(l)?.price || 0) + modsOf(l.mods).reduce((s, m) => s + m.price, 0)
function addLine(x, mods, qty) {
  const key = lineKey({ kind: x.kind, refId: x.id, mods })
  const l = cart.value.find((y) => lineKey(y) === key)
  if (l) l.qty += qty
  else cart.value.push({ kind: x.kind, refId: x.id, qty, mods })
}
function add(x) {
  if (!canAdd(x)) return
  if (groupsOf(x).length) return openMods(x)
  addLine(x, [], 1)
}
function step(l, d) {
  const x = itemOf(l)
  if (d > 0 && x && !canAdd(x)) return
  if (l.qty + d <= 0) return removeLine(l)
  l.qty += d
}

// ---------- ลบรายการในตะกร้าแบบง่าย (ไม่ต้องเปิดตะกร้า) + เลิกทำ ----------
const undo = reactive({ snap: null, text: '', timer: null })
function remember(text) {
  undo.snap = JSON.parse(JSON.stringify(cart.value))
  undo.text = text
  clearTimeout(undo.timer)
  undo.timer = setTimeout(() => (undo.snap = null), 5000)
}
function undoRemove() {
  if (!undo.snap) return
  cart.value = undo.snap
  undo.snap = null
  clearTimeout(undo.timer)
}
const lineName = (l) => `${itemOf(l)?.name || 'รายการ'}${l.mods?.length ? ` (${modsText(modsOf(l.mods))})` : ''}`
function removeLine(l) {
  remember(`ลบ ${lineName(l)} แล้ว`)
  cart.value.splice(cart.value.indexOf(l), 1)
}
// ปุ่ม − บนการ์ดสินค้า: ลด 1 ที่บรรทัดล่าสุดของสินค้านั้น (ไม่เปิดตะกร้า)
function lessOf(x) {
  const ls = cart.value.filter((l) => l.kind === x.kind && l.refId === x.id)
  const l = ls[ls.length - 1]
  if (!l) return
  if (l.qty <= 1) return removeLine(l)
  l.qty -= 1
}
async function clearCart() {
  if (!cart.value.length) return
  if (!(await askConfirm({ title: 'ล้างตะกร้า', message: `ลบทั้ง ${count.value} ชิ้น (เลิกทำได้ภายใน 5 วินาที)`, okText: 'ล้างตะกร้า', danger: true }))) return
  remember('ล้างตะกร้าแล้ว')
  cart.value = []
  cartOpen.value = false
}
// ปัดซ้ายที่บรรทัดบนมือถือเพื่อลบ (ตัวเสริม · วิธีหลักคือปุ่มถังขยะ/✕)
const swipe = { x: 0, y: 0 }
const swipeStart = (e) => { swipe.x = e.touches[0].clientX; swipe.y = e.touches[0].clientY }
const swipeEnd = (e, l) => {
  const dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y
  if (dx < -80 && Math.abs(dy) < 40) removeLine(l)
}

// ---------- เลือกตัวเลือกสินค้า (เช่น หวานน้อย แยกน้ำแข็ง) ----------
const modFor = ref(null) // { x, line (แก้บรรทัดเดิม), sel: { [groupId]: optionId | [optionId] }, qty }
function openMods(x, line = null) {
  const sel = {}
  for (const g of groupsOf(x)) {
    const cur = (line?.mods || []).filter((m) => m.groupId === g.id).map((m) => m.optionId)
    sel[g.id] = g.type === 'multi' ? cur : cur[0] || (g.required ? g.options[0].id : null)
  }
  modFor.value = { x, line, sel, qty: line?.qty || 1 }
}
function pickMod(g, o) {
  const s = modFor.value.sel
  if (g.type === 'multi') s[g.id] = s[g.id].includes(o.id) ? s[g.id].filter((v) => v !== o.id) : [...s[g.id], o.id]
  else s[g.id] = s[g.id] === o.id && !g.required ? null : o.id
}
const isPicked = (g, o) => (g.type === 'multi' ? modFor.value.sel[g.id].includes(o.id) : modFor.value.sel[g.id] === o.id)
const modSel = computed(() =>
  modFor.value ? Object.entries(modFor.value.sel).flatMap(([gid, v]) => (Array.isArray(v) ? v : v ? [v] : []).map((oid) => ({ groupId: gid, optionId: oid }))) : [],
)
const modPrice = computed(() => (modFor.value ? (modFor.value.x.price + modsOf(modSel.value).reduce((s, m) => s + m.price, 0)) * modFor.value.qty : 0))
const modMissing = computed(() => (modFor.value ? groupsOf(modFor.value.x).filter((g) => g.required && !modFor.value.sel[g.id]).map((g) => g.name) : []))
const modQtyMax = computed(() => (modFor.value?.x.stock == null ? 99 : modFor.value.x.stock - inCart(modFor.value.x) + (modFor.value.line?.qty || 0)))
function saveMods() {
  const f = modFor.value
  if (modMissing.value.length || f.qty < 1 || f.qty > modQtyMax.value) return
  if (f.line) cart.value.splice(cart.value.indexOf(f.line), 1)
  addLine(f.x, modSel.value, f.qty)
  modFor.value = null
}
const count = computed(() => cart.value.reduce((s, l) => s + l.qty, 0))
// แนะนำขายต่อ: ชุดบันเดิ้ลที่ใกล้ครบ + สินค้าที่ลูกค้ามักซื้อคู่กัน
const cartRetail = computed(() => cart.value.filter((l) => l.kind === 'retail').map((l) => ({ retailId: l.refId, qty: l.qty })))
// ชิ้นที่ถูกจัดเข้าบันเดิ้ลแล้ว (ตามผลคิดโปรจริง) ไม่นับซ้ำเวลาแนะนำชุดอื่น
const bundleUsed = computed(() => { const u = {}; for (const i of lineItems.value) if ((i.discounts || []).some((d) => d.kind === 'bundle')) u[i.retailId] = (u[i.retailId] || 0) + i.qty; return u })
const bundleSug = computed(() => suggestBundles(cartRetail.value, db.posBundles, catalog.value, { now: new Date(), used: bundleUsed.value }))
const pairSug = computed(() => {
  const ok = new Set(catalog.value.filter((x) => canAdd(x)).map((x) => x.id))
  return coBought(db.orders, cartRetail.value.map((l) => l.retailId), { eligible: ok }).map((r) => ({ ...r, item: catalog.value.find((x) => x.id === r.retailId) })).filter((r) => r.item)
})
function addMissing(sug) {
  for (const m of sug.missing) {
    const x = catalog.value.find((c) => c.id === m.itemId)
    if (!x || !canAdd(x, m.qty)) continue
    if (groupsOf(x).length) return openMods(x)
    addLine(x, [], m.qty)
  }
}
const cartOpen = ref(false) // มือถือ: แผงตะกร้าแบบ bottom sheet

// สมาชิก / คะแนน / คูปอง / ส่วนลด
const memberQ = ref('')
const member = ref(null)
const memberMatches = computed(() => {
  const s = memberQ.value.trim().toLowerCase()
  if (s.length < 2) return []
  const d = phoneDigits(s)
  return db.customers.filter((c) => c.active !== false && (c.name.toLowerCase().includes(s) || (d.length >= 3 && c.phone?.includes(d)))).slice(0, 5)
})
// ---------- แลกของรางวัล (ต้องค้นหาลูกค้าก่อนจึงแสดงรายการ) ----------
const rd = reactive({ open: false, q: '', cust: null, msg: '', err: '' })
const rdMatches = computed(() => {
  const s = rd.q.trim().toLowerCase()
  if (s.length < 2) return []
  const d = phoneDigits(s)
  return db.customers.filter((c) => c.active !== false && !c.deleted && (c.name.toLowerCase().includes(s) || (d.length >= 3 && c.phone?.includes(d)))).slice(0, 6)
})
// เวลาปัจจุบันเดินทุกวินาที (นับถอยหลังของคูปองที่ลูกค้ากดแสดง · หมดเวลาแล้วหายเอง)
const nowTick = ref(Date.now())
let tickTimer = null
onMounted(() => { tickTimer = setInterval(() => { nowTick.value = Date.now(); sweepCoupons() }, 1000) })
onBeforeUnmount(() => clearInterval(tickTimer))
const nowIso = computed(() => new Date(nowTick.value).toISOString())
const mmss = (cp) => { const s = activeSecondsLeft(cp, nowTick.value); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
// ของรางวัลที่ลูกค้ากด "ใช้ที่ร้านตอนนี้" แล้ว (ลูกค้าแลกเองในระบบลูกค้า · พนักงานแลกแทนไม่ได้)
const rdPending = computed(() => (rd.cust ? pendingRewards(rd.cust, nowIso.value) : []))
const rdCoupons = computed(() => (rd.cust ? posCoupons(rd.cust, nowIso.value) : []))
const rdHidden = computed(() => (rd.cust ? notShownCount(rd.cust, nowIso.value) : 0))
function openRedeem() { Object.assign(rd, { open: true, q: '', cust: null, msg: '', err: '' }) }
function rdPick(c) { Object.assign(rd, { cust: c, q: '', msg: '', err: '' }) }
async function rdHand(cp) {
  rd.msg = rd.err = ''
  if (!(await askConfirm({ title: 'มอบของรางวัล', message: `${cp.name} ให้ ${rd.cust.name} · มอบแล้วถือว่าใช้แล้ว`, okText: 'มอบแล้ว' }))) return
  const r = posHandOver(rd.cust.id, cp.id)
  if (r.error) rd.err = r.error
  else rd.msg = `มอบ ${cp.name} แล้ว`
}
const couponIds = ref([])
const discount = ref('')
function pickMember(c) {
  member.value = c
  memberQ.value = ''
  couponIds.value = []
}
// คูปองส่วนลดของสมาชิก (ได้จากการแลกคะแนนบนเว็บ/กาชา) · ใช้ได้เมื่อยอดสินค้าถึงขั้นต่ำ
// POS เห็นเฉพาะคูปองที่ลูกค้ากดแสดงที่ร้านอยู่ (ยังไม่หมดเวลา) · ที่ยังไม่ได้กดแสดงลูกค้าต้องกดเองในบัญชีของตน
const coupons = computed(() => (member.value ? posCoupons(member.value, nowIso.value) : []))
const hiddenCoupons = computed(() => (member.value ? notShownCount(member.value, nowIso.value) : 0))
const toggleCoupon = (id) => (couponIds.value = couponIds.value.includes(id) ? couponIds.value.filter((x) => x !== id) : [...couponIds.value, id])

// รายการในตะกร้า + โปรโมชัน/บันเดิ้ลที่ใช้อยู่ (ตัวอย่างก่อนบันทึก)
const promoInfo = computed(() => posPromoInfo(cart.value))
const lineItems = computed(() => promoInfo.value.items)
const giftLines = computed(() => lineItems.value.filter((i) => i.promoGift))
const goods = computed(() => lineItems.value.reduce((n, i) => n + i.unitPrice * i.qty, 0))
const couponOk = (c) => !(Number(c.minSpend) > 0) || goods.value >= Number(c.minSpend)
watch([goods, coupons], () => (couponIds.value = couponIds.value.filter((id) => coupons.value.some((c) => c.id === id && couponOk(c)))))
const usedPromos = computed(() => [...new Set(lineItems.value.flatMap((i) => (i.discounts || []).filter((d) => d.kind === 'promo' || d.kind === 'bundle' || d.kind === 'gift').map((d) => d.name)))])
const orderLike = computed(() => ({
  items: lineItems.value, fulfillment: 'pickup', payments: [],
  adjustment: { amount: -(Number(discount.value) || 0), reason: 'ส่วนลดหน้าร้าน' }, pointsUsed: null, vat: vatNow(),
  couponsUsed: coupons.value.filter((c) => couponIds.value.includes(c.id)).map((c) => ({ couponId: c.id, name: c.name, amount: c.amount })),
}))
const preview = computed(() => orderTotals(orderLike.value))
const total = computed(() => Math.max(preview.value.total, 0))
// คะแนนที่สมาชิกจะได้จากบิลนี้ (ยอดสุทธิ + โปรคะแนนพิเศษ)
const earn = computed(() => (member.value && cart.value.length ? pointsFor(orderLike.value, new Date()) : null))

// ---------- สมัครสมาชิกที่เคาน์เตอร์ ----------
const signup = reactive({ open: false, name: '', phone: '', agreed: false, error: '' })
function openSignup() {
  Object.assign(signup, { open: true, name: '', phone: phoneValid(memberQ.value) ? memberQ.value : '', agreed: false, error: '' })
}
function doSignup() {
  const r = quickMember({ name: signup.name, phone: signup.phone, agreed: signup.agreed })
  if (r.ok) {
    pickMember(r.customer)
    signup.open = false
  } else signup.error = r.error
}

// ---------- ชำระเงิน ----------
const payOpen = ref(false)
// รายการชำระของบิลนี้: เงินสด / โอน (มี QR หมดอายุตามตั้งค่า) / บัตร · หลายรายการได้ ยอดรวมต้องพอดี
const payLines = ref([])
const payNow = ref(Date.now())
let payTimer = null
let payTick = 0
let maneePolling = false
const lineAmt = (l) => Math.round((Number(l.amount) || 0) * 100) / 100
const paidSum = computed(() => Math.round(payLines.value.reduce((s, l) => s + lineAmt(l), 0) * 100) / 100)
const remaining = computed(() => Math.round((total.value - paidSum.value) * 100) / 100)
const newKey = () => Math.random().toString(36).slice(2)
const expiredLine = (l) => !l.detectedAt && !l.confirmed && l.status !== 'cancelled' && posQrExpired(l, payNow.value)
const AUTO_ACCEPT_MS = 3 * 60 * 1000 // พบรายการโอนแล้ว พนักงานไม่กดรับภายใน 3 นาที ระบบรับเอง
const autoLeft = (l) => { const sec = Math.max(0, Math.ceil((l.detectedAt + AUTO_ACCEPT_MS - payNow.value) / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }
const changeOf = (l) => (Number(l.received) || 0) - lineAmt(l)
const quickFor = (l) => { const a = lineAmt(l); return [...new Set([a, Math.ceil(a / 100) * 100, Math.ceil(a / 500) * 500, Math.ceil(a / 1000) * 1000])].filter((v) => v >= a) }
const qrLeft = (l) => { const sec = Math.max(0, Math.ceil((new Date(l.qrExpiresAt).getTime() - payNow.value) / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }
function openPay() {
  if (!cart.value.length) return
  payErr.value = ''
  payLines.value = []
  payNow.value = Date.now()
  clearInterval(payTimer)
  payTimer = setInterval(() => { payNow.value = Date.now(); tickLines(); if (++payTick % 5 === 0) quietly(pollManee) }, 1000)
  payOpen.value = true
}
function closePay() {
  payOpen.value = false
  payLines.value = []
  clearInterval(payTimer)
}
onBeforeUnmount(() => clearInterval(payTimer))
function addPayLine(method) {
  if (remaining.value <= 0) return
  payLines.value.push({ key: newKey(), method, amount: String(remaining.value), received: '', qrRef: '', qrExpiresAt: '', confirmed: false })
}
function removePayLine(i) {
  payLines.value.splice(i, 1)
}
// ดึงรายการโอนแม่มณีที่ตรงกับ QR ที่ยังรอชำระ (ทุก 5 วินาที)
// พบรายการเดียว → ขึ้นสถานะ "ลูกค้าชำระแล้ว" (อนิเมชัน) รอพนักงานกดรับ · พบหลายรายการ → ให้พนักงานเลือกเอง
async function pollManee() {
  if (maneePolling) return
  maneePolling = true
  try {
    for (const l of payLines.value) {
      if (l.method !== 'transfer' || !l.qrRef || l.confirmed || l.detectedAt || l.status === 'cancelled' || expiredLine(l)) continue
      const r = await listManeeTransfers({ amount: lineAmt(l), from: l.qrCreatedAt, to: l.qrExpiresAt })
      if (r.error) continue
      l.candidates = r.rows
      if (r.rows.length === 1) Object.assign(l, { detectedAt: Date.now(), maneeId: r.rows[0].id })
    }
  } finally { maneePolling = false }
}
// รับเองเมื่อครบ 3 นาทีหลังพบรายการ (เฉพาะกรณีพบรายการเดียว)
function tickLines() {
  for (const l of payLines.value) {
    if (l.method === 'transfer' && l.detectedAt && !l.confirmed && l.status !== 'cancelled' && Date.now() - l.detectedAt >= AUTO_ACCEPT_MS) Object.assign(l, { confirmed: true, acceptedBy: 'auto' })
  }
}
function pickManee(l, c) {
  Object.assign(l, { confirmed: true, acceptedBy: 'staff', maneeId: c.id })
}
function receiveNow(l) {
  Object.assign(l, { confirmed: true, acceptedBy: 'staff' })
}
function cancelQr(l) {
  Object.assign(l, { status: 'cancelled', confirmed: false, detectedAt: 0, maneeId: '', candidates: [] })
}
function makeQr(l) {
  const a = lineAmt(l)
  if (!(a > 0) || a > remaining.value + lineAmt(l) + 0.005) return
  const ref = newPosQrRef()
  if (!ref) return (payErr.value = 'สร้างรหัส QR ไม่สำเร็จ ลองอีกครั้ง')
  const mins = db.shop.posQrExpireMin || 10
  Object.assign(l, { qrRef: ref, qrCreatedAt: new Date().toISOString(), qrExpiresAt: new Date(Date.now() + mins * 60000).toISOString(), status: 'waiting', confirmed: false, detectedAt: 0, acceptedBy: '', maneeId: '', candidates: [] })
}
const lineOk = (l) => {
  const a = lineAmt(l)
  if (!(a > 0)) return false
  if (l.method === 'cash') return (Number(l.received) || 0) >= a
  if (l.method === 'transfer') return !!l.qrRef && l.confirmed
  return true
}
// รายการที่ยอด 0 ถูกข้าม (ไม่นับและไม่ส่งไปบันทึก)
const activeLines = computed(() => payLines.value.filter((l) => lineAmt(l) > 0))
const canConfirm = computed(() => activeLines.value.length > 0 && remaining.value === 0 && activeLines.value.every(lineOk))
const receipt = ref(null)
const taxFor = ref(null) // บิลที่กำลังออกใบกำกับภาษีเต็มรูป
const taxable = (o) => can('taxInvoice') && o.status !== 'cancelled' && orderTotals(o).vat > 0
const payErr = ref('')
let selling = false
async function confirmPay() {
  if (!canConfirm.value || selling) return
  selling = true
  try {
    await refreshLabels(['สินค้า', 'กะ POS']) // สต็อก/กะล่าสุดจากเซิร์ฟเวอร์ก่อนตัดขาย
    await sellNow()
  } finally { selling = false }
}
async function sellNow() {
  payErr.value = member.value ? posCouponProblem({ customerId: member.value.id, couponIds: couponIds.value }) : ''
  if (payErr.value) { couponIds.value = couponIds.value.filter((id) => coupons.value.some((c) => c.id === id)); return }
  // จองคูปองกับเซิร์ฟเวอร์ก่อน (อะตอมิก) · ขายไม่สำเร็จ = คืนคูปองที่จองไว้
  const claim = couponIds.value.length ? await claimPosCoupons(couponIds.value) : { ok: true, claimed: [] }
  if (claim.error) return (payErr.value = claim.error)
  const o = posSale({
    cart: cart.value, customerId: member.value?.id || null, couponIds: couponIds.value,
    discount: can('adjustPrice') ? Number(discount.value) || 0 : 0,
    lines: activeLines.value.map((l) => ({ method: l.method, amount: lineAmt(l), received: l.method === 'cash' ? Number(l.received) : null, qrRef: l.qrRef || null, qrExpiresAt: l.qrExpiresAt || null, confirmed: !!l.confirmed, maneeId: l.maneeId || '', acceptedBy: l.acceptedBy || '' })),
  })
  if (!o) { await releaseCoupons(claim.claimed); return (payErr.value = 'ขายไม่สำเร็จ ตรวจกะ/ตะกร้า/คูปองอีกครั้ง') }
  // ผูกคูปองที่จองไว้ (pos-pending) เข้ากับบิลจริงบนเซิร์ฟเวอร์ผ่านการซิงก์แถวคูปองตามปกติ
  closePay()
  cartOpen.value = false
  receipt.value = o
  cart.value = []
  member.value = null
  couponIds.value = []
  discount.value = ''
  // ขายแล้ว (ใบเสร็จแสดงได้) แต่ต้องแจ้งตามจริงถ้ายังบันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ
  waitSaved().then((r) => { if (!r.ok) showToast(`บิล ${o.code} ยังบันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (${r.error}) · ระบบจะลองส่งซ้ำเอง ดูสถานะที่แถบด้านบน`, 12000, 'error') })
}
const print = () => window.print()

// ---------- บิลของกะ ----------
const bills = computed(() => (shift.value ? shiftBills(shift.value.id) : []))
// ยกเลิกบิล: เลือกคืนเป็น เงินสด / ธนาคาร / คะแนนสะสม (แบ่งได้) · ค่าตั้งต้น = คืนเต็มตามช่องทางที่จ่ายมา
const voidFor = ref(null)
const vd = reactive({ reason: 'ยกเลิกบิล', refunds: [], note: '', error: '' })
const voidPaid = computed(() => (voidFor.value ? orderTotals(voidFor.value).paidNet : 0))
const refundFor = ref(null) // คืนเงินบางส่วนโดยไม่ยกเลิกบิล
const voidDefault = computed(() => defaultRefundMethod(voidFor.value?.payments.find((p) => p.status === 'confirmed')?.posMethod))
function openVoid(o) {
  const paid = orderTotals(o).paidNet
  Object.assign(vd, { reason: 'ยกเลิกบิล', refunds: paid > 0 ? [{ method: defaultRefundMethod(o.payments.find((p) => p.status === 'confirmed')?.posMethod), amount: paid }] : [], note: '', error: '' })
  voidFor.value = o
}
function doVoid() {
  if (!vd.reason.trim()) return (vd.error = 'ใส่เหตุผลการยกเลิก')
  const r = voidPosSale(voidFor.value, vd.reason.trim(), vd.refunds.map((x) => ({ method: x.method, amount: Number(x.amount) })), vd.note)
  if (r.error) return (vd.error = r.error)
  voidFor.value = null
}
const buyerFor = ref(null)

// ---------- ปิดกะ ----------
const summary = computed(() => (shift.value ? shiftSummary(shift.value) : null))
const counted = ref('')
async function doClose() {
  const diff = (Number(counted.value) || 0) - summary.value.expectedCash
  if (await askConfirm({ title: 'ปิดกะ', message: `เงินสดนับได้ ${money(Number(counted.value) || 0)} · ส่วนต่าง ${money(diff)}`, okText: 'ปิดกะ' })) {
    closeShift(Number(counted.value) || 0)
    counted.value = ''
    tab.value = 'sell'
  }
}
const closedShifts = computed(() => db.shifts.filter((s) => s.closedAt).slice(0, 10))
</script>

<template>
  <div v-if="!can('pos')" class="card py-10 text-center text-stone-500">บทบาทนี้ใช้ POS ไม่ได้</div>

  <div v-else class="mx-auto max-w-page">
    <!-- หัว -->
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <RouterLink to="/admin/orders" class="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 md:hidden" aria-label="กลับ"><AppIcon name="back" :size="20" /></RouterLink>
      <h1 class="page-title">POS หน้าร้าน</h1>
      <span v-if="shift" class="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">กะเปิด {{ timeOnly(shift.openedAt) }} · {{ ROLES[shift.openedBy] }}</span>
      <button v-if="shift && can('useLoyalty')" type="button" class="btn-soft ml-auto h-9 px-3 text-sm" @click="openRedeem"><AppIcon name="star" :size="15" /> มอบของรางวัล</button>
      <div v-if="shift" class="grid grid-cols-3 gap-1 seg-grid" :class="can('useLoyalty') ? '' : 'ml-auto'">
        <button v-for="t in [{ v: 'sell', l: 'ขาย' }, { v: 'bills', l: `บิล ${bills.length}` }, { v: 'shift', l: 'ปิดกะ' }]" :key="t.v" type="button" class="h-9 rounded-lg px-3 text-sm font-medium" :class="tab === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="tab = t.v">{{ t.l }}</button>
      </div>
    </div>

    <!-- เปิดกะ -->
    <section v-if="!shift" class="card mx-auto max-w-md">
      <div class="card-title"><AppIcon name="pos" class="text-brand-600" /> เปิดกะก่อนขาย</div>
      <label class="label">เงินทอนตั้งต้นในลิ้นชัก (บาท)</label>
      <input v-model="float" type="text" v-num.dec class="input text-lg font-semibold" placeholder="0" />
      <button type="button" class="btn-primary mt-3 w-full" @click="doOpen">เปิดกะ</button>
      <div v-if="closedShifts.length" class="mt-5 border-t border-stone-100 pt-4">
        <div class="label">กะที่ผ่านมา</div>
        <ul class="space-y-1.5 text-sm">
          <li v-for="s in closedShifts" :key="s.id" class="flex justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2">
            <span>{{ dateTime(s.openedAt) }} – {{ timeOnly(s.closedAt) }}</span>
            <span :class="s.counted - s.summary.expectedCash === 0 ? 'text-stone-600' : 'text-amber-700'">{{ money(s.summary.total) }} · ต่าง {{ money(s.counted - s.summary.expectedCash) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- ขาย -->
    <div v-else-if="tab === 'sell'" class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <section class="min-w-0 pb-24 lg:pb-0">
        <div class="mb-3 flex gap-2">
          <label class="relative min-w-0 flex-1">
            <span class="sr-only">ค้นหาสินค้า</span>
            <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
            <input v-model="q" type="search" class="input bg-white pl-10" placeholder="ค้นหาสินค้า" />
          </label>
        </div>
        <div class="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
          <button type="button" class="chip" :class="!cat ? 'chip-on' : 'chip-off'" @click="cat = ''">ทั้งหมด</button>
          <button v-for="c in categories" :key="c" type="button" class="chip whitespace-nowrap" :class="cat === c ? 'chip-on' : 'chip-off'" @click="cat = c">{{ c }}</button>
          <button type="button" class="chip ml-auto whitespace-nowrap" :class="sortBest ? 'chip-on' : 'chip-off'" :aria-pressed="sortBest" @click="sortBest = !sortBest"><AppIcon name="star" :size="13" /> เรียงขายดี</button>
        </div>
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <div v-for="x in shown" :key="x.kind + x.id" class="relative">
          <button
            type="button"
            class="relative flex min-h-24 w-full flex-col justify-between rounded-3xl border-2 bg-white p-3 text-left shadow-sm transition active:scale-[0.98] disabled:opacity-50"
            :class="inCart(x) ? 'border-brand-500 bg-brand-50/60 pb-5' : 'border-transparent hover:border-brand-300'"
            :disabled="!canAdd(x)"
            @click="add(x)"
          >
            <span class="line-clamp-2 text-sm font-medium break-words text-stone-900">{{ x.name }}</span>
            <span v-if="groupsOf(x).length" class="mt-0.5 text-xs text-brand-700">มีตัวเลือก</span>
            <span v-if="pointTag(x)" class="mt-0.5 text-xs font-medium text-amber-700">คะแนน ×{{ pointTag(x).multiplier }}</span>
            <span v-if="ranks.get(x.id)?.star" class="mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold text-amber-700" :aria-label="`ขายดีอันดับ ${ranks.get(x.id).rank}`"><AppIcon name="star" :size="12" /> ขายดี #{{ ranks.get(x.id).rank }}</span>
            <span class="mt-2 flex items-end justify-between gap-1">
              <span class="text-base font-semibold text-stone-900">{{ money(x.price) }}</span>
              <span v-if="x.stock != null" class="text-xs" :class="x.stock - inCart(x) <= 0 ? 'font-semibold text-rose-700' : 'text-stone-500'">{{ x.stock - inCart(x) <= 0 ? 'หมด' : `เหลือ ${x.stock - inCart(x)}` }}</span>
            </span>
            <span v-if="inCart(x)" class="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-semibold text-white">{{ inCart(x) }}</span>
          </button>
          <button v-if="inCart(x)" type="button" class="absolute -bottom-4 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-stone-200 bg-white text-rose-700 shadow-md active:scale-95" :aria-label="`ลด ${x.name}`" @click="lessOf(x)"><AppIcon name="minus" :size="18" /></button>
          </div>
        </div>
        <p v-if="!shown.length" class="empty py-8 text-sm">ไม่พบสินค้า</p>
      </section>

      <!-- ตะกร้า (คอม = แผงขวา · มือถือ = bottom sheet) -->
      <div v-if="cartOpen" class="fixed inset-0 z-40 bg-stone-900/40 lg:hidden" @click="cartOpen = false" />
      <aside
        class="z-50 flex-col rounded-t-3xl border border-stone-200 bg-white lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:rounded-2xl"
        :class="cartOpen ? 'fixed inset-x-0 bottom-0 flex max-h-[88dvh] pb-[env(safe-area-inset-bottom)]' : 'hidden'"
      >
        <div class="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <span class="font-semibold text-stone-900">ตะกร้า <span class="text-stone-400">{{ count }}</span></span>
          <span class="flex items-center gap-3"><button v-if="cart.length" type="button" class="text-sm text-rose-700 underline" aria-label="ล้างตะกร้า" @click="clearCart">ล้างตะกร้า</button><button type="button" class="text-sm text-stone-500 lg:hidden" @click="cartOpen = false">ปิด</button></span>
        </div>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p v-if="!cart.length" class="py-6 text-center text-sm text-stone-400">แตะสินค้าเพื่อเพิ่ม</p>
          <ul class="space-y-2">
            <li v-for="l in cart" :key="lineKey(l)" class="flex items-center gap-2" @touchstart.passive="swipeStart" @touchend.passive="swipeEnd($event, l)">
              <button type="button" class="min-w-0 flex-1 text-left" :disabled="!groupsOf(itemOf(l) || {}).length" @click="openMods(itemOf(l), l)">
                <span class="block truncate text-sm font-medium text-stone-900">{{ itemOf(l)?.name }}</span>
                <span v-if="l.mods?.length" class="block truncate text-xs text-brand-700">{{ modsText(modsOf(l.mods)) }}</span>
                <span class="block text-xs text-stone-500">{{ money(linePrice(l)) }}</span>
              </button>
              <span class="flex h-9 items-center rounded-xl border border-stone-200">
                <button type="button" class="h-full w-9 text-stone-600" aria-label="ลด" @click="step(l, -1)"><AppIcon name="minus" :size="16" class="mx-auto" /></button>
                <span class="w-7 text-center text-sm font-semibold">{{ l.qty }}</span>
                <button type="button" class="h-full w-9 text-stone-600" aria-label="เพิ่ม" @click="step(l, 1)"><AppIcon name="plus" :size="16" class="mx-auto" /></button>
              </span>
              <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-rose-700 hover:bg-rose-50" :aria-label="`ลบ ${itemOf(l)?.name}`" @click="removeLine(l)"><AppIcon name="trash" :size="17" /></button>
            </li>
          </ul>

          <!-- ของแถมจากดีล + โปรที่ใกล้ถึง -->
          <ul v-if="giftLines.length" class="space-y-1.5" aria-label="ของแถม">
            <li v-for="g in giftLines" :key="g.id" class="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <span class="shrink-0 rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white">แถม</span>
              <span class="min-w-0 flex-1 truncate font-medium">{{ g.name }} × {{ g.qty }}</span>
              <span class="max-w-[40%] shrink-0 truncate text-xs text-emerald-800">{{ g.promoGift.name }}</span>
            </li>
          </ul>
          <ul v-if="promoInfo.hints.length" class="space-y-1 rounded-xl bg-sky-50 p-2.5 text-xs text-sky-900" aria-label="โปรที่ใกล้ถึง">
            <li v-for="h in promoInfo.hints" :key="h.text">💡 {{ h.text }}</li>
          </ul>

          <!-- แนะนำขายต่อ -->
          <div v-if="bundleSug.length || pairSug.length" class="space-y-2 rounded-xl bg-amber-50/70 p-2.5" aria-label="แนะนำขายต่อ">
            <div v-for="s in bundleSug" :key="s.bundle.id" class="rounded-lg bg-white p-2 text-sm">
              <div class="font-medium text-stone-900">ชุด {{ s.bundle.name }} · {{ money(s.bundle.price) }} <s class="text-xs font-normal text-stone-400">ราคาเต็ม {{ money(s.setRegular) }}</s></div>
              <div class="text-xs text-stone-600">เพิ่ม {{ s.missing.map((m) => `${m.name} ×${m.qty}`).join(', ') }} ได้ราคาชุด · ประหยัด <b class="text-rose-700">{{ money(s.saving) }}</b></div>
              <button type="button" class="btn-soft mt-1.5 h-8 px-3 text-xs" @click="addMissing(s)"><AppIcon name="plus" :size="14" /> เพิ่มให้ครบชุด</button>
            </div>
            <div v-if="pairSug.length">
              <div class="mb-1 text-xs font-semibold text-amber-800">ลูกค้ามักซื้อคู่กัน</div>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="r in pairSug" :key="r.retailId" type="button" class="chip chip-off max-w-full" :aria-label="`เพิ่ม ${r.item.name}`" @click="add(r.item)"><AppIcon name="plus" :size="13" /> <span class="truncate">{{ r.item.name }}</span> <span class="text-stone-400">{{ money(r.item.price) }}</span></button>
              </div>
            </div>
          </div>

          <!-- สมาชิก -->
          <div class="border-t border-stone-100 pt-3">
            <div class="label">สมาชิก (ไม่บังคับ)</div>
            <div v-if="member" class="rounded-xl bg-brand-50 p-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold text-brand-900">{{ member.name }}</span>
                  <span class="block text-xs text-brand-800">{{ member.phone ? formatPhone(member.phone) : '' }} · {{ customerPoints(member) }} คะแนน</span>
                </span>
                <button type="button" class="text-xs text-stone-500 underline" @click="member = null">เอาออก</button>
              </div>
              <p v-if="earn" class="mt-1.5 text-xs text-brand-800">บิลนี้จะได้ <b>{{ earn.points }}</b> คะแนน<template v-if="earn.bonus > 0"> (โบนัสโปร +{{ earn.bonus }})</template></p>
              <div class="mt-2">
                <p v-if="coupons.length" class="text-xs text-brand-800">ลูกค้ากดแสดงคูปองไว้ <b>{{ coupons.length }}</b> ใบ · เลือกใช้ได้ในขั้นตอนชำระเงิน<template v-if="couponIds.length"> (เลือกแล้ว {{ couponIds.length }})</template></p>
                <p v-if="hiddenCoupons" class="text-xs text-amber-700">ลูกค้ามีคูปอง/ของรางวัลอีก {{ hiddenCoupons }} รายการ ที่ยังไม่ได้กด "ใช้ที่ร้านตอนนี้" — ให้ลูกค้ากดเองในบัญชีของตน (ยืนยันว่าลูกค้าทำรายการเอง)</p>
                <p v-if="!coupons.length && !hiddenCoupons" class="text-xs text-stone-400">ไม่มีคูปองที่ใช้ได้</p>
              </div>
            </div>
            <template v-else>
              <input v-model="memberQ" type="search" class="input h-10" placeholder="ค้นหาเบอร์ / ชื่อ" />
              <div v-if="memberMatches.length" class="mt-1.5 space-y-1">
                <button v-for="c in memberMatches" :key="c.id" type="button" class="flex w-full justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:border-brand-300" @click="pickMember(c)">
                  <span class="truncate">{{ c.name }}</span><span class="shrink-0 text-stone-500">{{ c.phone ? formatPhone(c.phone) : '' }}</span>
                </button>
              </div>
              <button type="button" class="btn-soft mt-1.5 h-9 w-full text-sm" @click="openSignup"><AppIcon name="plus" :size="14" /> สมัครสมาชิกใหม่ (สะสมคะแนน)</button>
            </template>
          </div>

          <p v-if="usedPromos.length" class="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">โปรที่ใช้: {{ usedPromos.join(' · ') }}</p>
          <div v-if="can('adjustPrice')">
            <label class="label">ส่วนลดบิล (บาท)</label>
            <input v-model="discount" type="text" v-num.dec class="input h-10" placeholder="0" />
          </div>
        </div>
        <div class="border-t border-stone-100 p-4">
          <div class="mb-3 flex items-start justify-between gap-2">
            <span class="text-sm text-stone-500">ยอดชำระ<span v-if="preview.vatMode" class="block text-xs text-stone-400">{{ preview.vatMode === 'exclusive' ? `รวม VAT ${preview.vatRate}% บวกเพิ่ม ${money(preview.vat)}` : `รวม VAT ${preview.vatRate}% แล้ว ${money(preview.vat)}` }}</span></span>
            <DiscountDetail :full="preview.fullAll" :final="total" :lines="preview.discountLines" size="lg" />
          </div>
          <button type="button" class="btn-primary h-12 w-full text-base" :disabled="!cart.length" @click="openPay">ชำระเงิน</button>
        </div>
      </aside>

      <!-- แถบล่างมือถือ -->
      <div v-if="undo.snap" class="fixed inset-x-3 bottom-28 z-50 flex items-center justify-between gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-6 lg:left-auto lg:w-80" role="status"><span class="min-w-0 truncate">{{ undo.text }}</span><button type="button" class="shrink-0 font-semibold text-brand-200 underline" @click="undoRemove">เลิกทำ</button></div>
      <div v-if="!cartOpen" class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur lg:hidden">
        <div v-if="cart.length" class="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label="รายการในตะกร้า (แตะ ✕ เพื่อลบ)">
          <span v-for="l in cart" :key="'q' + lineKey(l)" class="flex shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-white py-1 pr-1 pl-3 text-xs text-stone-700"><span class="max-w-32 truncate">{{ lineName(l) }} ×{{ l.qty }}</span><button type="button" class="flex h-7 w-7 items-center justify-center rounded-full text-rose-700 hover:bg-rose-50" :aria-label="`ลบ ${itemOf(l)?.name} ออกจากตะกร้า`" @click="removeLine(l)">✕</button></span>
        </div>
        <button type="button" class="btn-primary h-12 w-full justify-between px-5 text-base" @click="cartOpen = true">
          <span>ตะกร้า {{ count }} ชิ้น</span><span>{{ money(total) }}</span>
        </button>
      </div>
    </div>

    <!-- บิลของกะ -->
    <section v-else-if="tab === 'bills'" class="card">
      <p v-if="!bills.length" class="py-8 text-center text-sm text-stone-500">ยังไม่มีบิลในกะนี้</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="o in bills" :key="o.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" :class="o.status === 'cancelled' ? 'opacity-60' : ''">
          <button type="button" class="min-w-0 flex-1 basis-40 text-left" @click="receipt = o">
            <span class="block font-medium text-stone-900">{{ orderNo(o.code) }} <span class="text-xs font-normal text-stone-500">{{ timeOnly(o.createdAt) }}</span></span>
            <span class="block truncate text-xs text-stone-500">{{ o.items.map((i) => `${i.name}${i.mods?.length ? ` (${modsText(i.mods)})` : ''} ×${i.qty}`).join(', ') }}<template v-if="o.customerId"> · {{ findCustomer(o.customerId)?.name }}</template></span>
          </button>
          <span class="shrink-0 text-right text-sm">
            <b class="block text-stone-900">{{ money(orderTotals(o).total) }}</b>
            <span class="text-xs text-stone-500">{{ o.status === 'cancelled' ? 'ยกเลิกแล้ว' : o.payments[0]?.method }}</span>
          </span>
          <button v-if="can('posVoid') && o.status !== 'cancelled' && (orderTotals(o).paidNet > 0 || (o.returns || []).some((r) => !r.cancelled))" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" aria-label="คืนเงินบางส่วน" @click="refundFor = o">คืนเงิน</button>
          <button v-if="can('posVoid') && o.status !== 'cancelled'" type="button" class="btn-danger h-9 shrink-0 px-2.5" aria-label="ยกเลิกบิล" @click="openVoid(o)"><AppIcon name="x" :size="16" /></button>
          <button v-if="can('changeBuyer') && o.status !== 'cancelled'" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="buyerFor = o">เปลี่ยนผู้ซื้อ</button>
          <button v-if="taxable(o)" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" aria-label="ใบกำกับภาษี" @click="taxFor = o">ใบกำกับภาษี</button>
        </li>
      </ul>
    </section>

    <!-- ปิดกะ -->
    <section v-else-if="tab === 'shift' && summary" class="card mx-auto max-w-md">
      <div class="card-title">สรุปกะ</div>
      <dl class="space-y-1.5 text-sm">
        <div class="flex justify-between"><dt class="text-stone-500">เปิดกะ</dt><dd>{{ dateTime(shift.openedAt) }}</dd></div>
        <div class="flex justify-between"><dt class="text-stone-500">บิล</dt><dd>{{ summary.bills }}<template v-if="summary.cancelled"> (ยกเลิก {{ summary.cancelled }})</template></dd></div>
        <div v-for="(label, k) in POS_METHODS" :key="k" class="flex justify-between"><dt class="text-stone-500">{{ label }}</dt><dd>{{ money(summary.byMethod[k] || 0) }}</dd></div>
        <div class="flex justify-between border-t border-stone-100 pt-1.5 font-semibold"><dt>ยอดขายรวม</dt><dd>{{ money(summary.total) }}</dd></div>
        <div class="flex justify-between"><dt class="text-stone-500">เงินทอนตั้งต้น</dt><dd>{{ money(shift.float) }}</dd></div>
        <div class="flex justify-between font-semibold"><dt>เงินสดที่ควรมีในลิ้นชัก</dt><dd>{{ money(summary.expectedCash) }}</dd></div>
      </dl>
      <label class="label mt-4">เงินสดที่นับได้ (บาท)</label>
      <input v-model="counted" type="text" v-num.dec class="input text-lg font-semibold" placeholder="0" />
      <p v-if="counted !== ''" class="mt-1 text-sm" :class="Number(counted) - summary.expectedCash === 0 ? 'text-emerald-700' : 'text-amber-700'">ส่วนต่าง {{ money(Number(counted) - summary.expectedCash) }}</p>
      <button type="button" class="btn-primary mt-3 w-full" :disabled="counted === ''" @click="doClose">ปิดกะ</button>
    </section>

    <!-- ยกเลิกบิล + คืนเงิน -->
    <AppModal v-if="voidFor" :title="`ยกเลิกบิล ${voidFor.code}`" @close="voidFor = null">
      <div class="space-y-4">
        <p v-if="invoiceOfOrder(voidFor.id)" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ออร์เดอร์นี้ออกใบกำกับภาษีไว้แล้ว ({{ invoiceOfOrder(voidFor.id).no }}) · เมื่อยกเลิกระบบจะออกใบลดหนี้ให้อัตโนมัติ</p>
        <p class="text-sm text-stone-500">ยกเลิกแล้วจะคืนสต็อก คืนคูปองที่ใช้ และตัดคะแนนที่ได้จากบิลนี้</p>
        <div><label class="label">เหตุผล <span class="text-rose-600">*</span></label><input v-model="vd.reason" class="input" maxlength="120" /></div>
        <div>
          <div class="label">คืนเงินให้ลูกค้า</div>
          <RefundEditor v-model="vd.refunds" :paid="voidPaid" :can-points="!!voidFor.customerId && !!findCustomer(voidFor.customerId) && !findCustomer(voidFor.customerId).deleted" :default-method="voidDefault" />
        </div>
        <div><label class="label">หมายเหตุการคืนเงิน</label><input v-model="vd.note" class="input" maxlength="120" /></div>
        <p v-if="vd.error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ vd.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="voidFor = null">ปิด</button>
        <button class="btn-danger flex-1 sm:flex-none" @click="doVoid">ยืนยันยกเลิกบิล</button>
      </template>
    </AppModal>
    <RefundPartialDialog v-if="refundFor" :order="refundFor" @close="refundFor = null" />
    <ChangeBuyerModal v-if="buyerFor" :order="buyerFor" @close="buyerFor = null" />

    <!-- สมัครสมาชิกที่เคาน์เตอร์ -->
    <AppModal v-if="signup.open" title="สมัครสมาชิก (สะสมคะแนน)" @close="signup.open = false">
      <div class="space-y-4">
        <div><label class="label">เบอร์โทร <span class="text-rose-600">*</span></label><PhoneInput v-model="signup.phone" /></div>
        <div><label class="label">ชื่อ <span class="text-rose-600">*</span></label><input v-model="signup.name" class="input" maxlength="100" autocomplete="off" /></div>
        <p class="text-xs text-stone-500">เบอร์ที่มีในระบบแล้วจะใช้ข้อมูลเดิม · ลูกค้าตั้ง PIN เข้าเว็บทีหลังได้ด้วยเบอร์เดิม (ต้องยืนยัน OTP)</p>
        <label class="flex items-start gap-2 text-sm text-stone-700">
          <input v-model="signup.agreed" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
          <span>ลูกค้ารับทราบ <RouterLink to="/legal/privacy" target="_blank" class="text-brand-700 underline">นโยบายความเป็นส่วนตัว</RouterLink> และ <RouterLink to="/legal/terms" target="_blank" class="text-brand-700 underline">เงื่อนไขคะแนนสะสม</RouterLink> แล้ว</span>
        </label>
        <p v-if="signup.error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ signup.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="signup.open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="doSignup">สมัครและใช้เลย</button>
      </template>
    </AppModal>

    <!-- ตัวเลือกสินค้า -->
    <AppModal v-if="modFor" :title="modFor.x.name" @close="modFor = null">
      <div class="space-y-4">
        <div v-for="g in groupsOf(modFor.x)" :key="g.id">
          <div class="label">{{ g.name }} <span v-if="g.required" class="text-rose-600">*</span><span v-else-if="g.type === 'multi'" class="font-normal text-stone-400">(เลือกได้หลายอย่าง)</span></div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              v-for="o in g.options"
              :key="o.id"
              type="button"
              class="flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-sm font-medium"
              :class="isPicked(g, o) ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-700'"
              @click="pickMod(g, o)"
            >
              {{ o.name }}<span v-if="o.price" class="text-xs font-normal text-stone-500">+{{ money(o.price) }}</span>
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="label mb-0">จำนวน</span>
          <span class="flex h-11 items-center rounded-xl border border-stone-200">
            <button type="button" class="h-full w-11" aria-label="ลด" @click="modFor.qty = Math.max(1, modFor.qty - 1)"><AppIcon name="minus" :size="18" class="mx-auto" /></button>
            <span class="w-10 text-center text-lg font-semibold">{{ modFor.qty }}</span>
            <button type="button" class="h-full w-11" aria-label="เพิ่ม" :disabled="modFor.qty >= modQtyMax" @click="modFor.qty++"><AppIcon name="plus" :size="18" class="mx-auto" /></button>
          </span>
        </div>
        <p v-if="modMissing.length" class="text-sm text-rose-700">เลือก {{ modMissing.join(', ') }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="modFor = null">ยกเลิก</button>
        <button class="btn-primary flex-[1.6] sm:flex-none" :disabled="!!modMissing.length" @click="saveMods">{{ modFor.line ? 'บันทึก' : 'ใส่ตะกร้า' }} · {{ money(modPrice) }}</button>
      </template>
    </AppModal>

    <!-- ชำระเงิน · เลย์เอาต์ใหม่: สรุปยอด → เลือกวิธีชำระ → รายการชำระ → ยืนยันปุ่มล่าง -->
    <AppModal v-if="payOpen" title="ชำระเงิน" @close="closePay">
      <div class="space-y-4">
        <div class="rounded-2xl bg-brand-50 p-4">
          <div class="flex items-end justify-between gap-3">
            <div>
              <div class="text-sm text-brand-800">ยอดชำระ</div>
              <div class="text-3xl font-semibold text-brand-900">{{ money(total) }}</div>
            </div>
            <div class="text-right">
              <div class="text-sm font-medium" :class="remaining > 0 ? 'text-amber-800' : remaining < 0 ? 'text-rose-700' : 'text-emerald-800'">{{ remaining > 0 ? 'ยังขาด' : remaining < 0 ? 'เกินยอด' : 'ครบแล้ว' }}</div>
              <div class="text-xl font-semibold" :class="remaining > 0 ? 'text-amber-900' : remaining < 0 ? 'text-rose-700' : 'text-emerald-800'">{{ money(Math.abs(remaining)) }}</div>
            </div>
          </div>
        </div>
        <p v-if="member && !coupons.length && hiddenCoupons" class="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800" role="note">ลูกค้ามีคูปองที่ยังไม่ได้กด "ใช้ที่ร้านตอนนี้" ({{ hiddenCoupons }} ใบ) — ให้ลูกค้ากดเองในบัญชีของตนก่อน คูปองจึงจะขึ้นที่นี่ (มีเวลาแสดง {{ db.loyalty.activationMin }} นาที)</p>
        <p v-if="payErr" class="rounded-xl bg-rose-50 p-2.5 text-sm text-rose-700" role="alert">{{ payErr }}</p>
        <div v-if="member && coupons.length" class="rounded-2xl border border-stone-200 p-3" aria-label="คูปองส่วนลดในขั้นชำระเงิน">
          <div class="mb-1.5 text-sm font-semibold text-stone-800">คูปองที่ {{ member.name }} กดแสดงไว้ · กดเพื่อใช้แทนเงินสด</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="c in coupons" :key="c.id" type="button" class="chip h-auto max-w-full py-1.5 text-left whitespace-normal" :class="[couponIds.includes(c.id) ? 'chip-on' : 'chip-off', couponOk(c) ? '' : 'opacity-50']" :disabled="!couponOk(c)" :aria-pressed="couponIds.includes(c.id)" @click="toggleCoupon(c.id)">{{ c.name }} −{{ money(c.amount) }}<template v-if="c.minSpend"> · ขั้นต่ำ {{ money(c.minSpend) }}</template> · เหลือ {{ mmss(c) }}</button>
          </div>
          <p v-for="c in coupons.filter((x) => !couponOk(x))" :key="'n' + c.id" class="mt-1 text-xs text-amber-700">{{ c.name }}: ยอดสินค้าต้องถึง {{ money(c.minSpend) }} (ตอนนี้ {{ money(goods) }})</p>
          <p v-if="couponIds.length" class="mt-1.5 text-xs text-emerald-700">ใช้คูปองลดแล้ว {{ money(preview.couponDiscount) }}</p>
        </div>

        <div v-if="remaining > 0" class="space-y-2">
          <div class="text-sm font-semibold text-stone-700">{{ payLines.length ? 'เพิ่มวิธีชำระอีก' : 'เลือกวิธีชำระ' }}</div>
          <div class="grid grid-cols-3 gap-2">
            <button v-for="(label, k) in POS_METHODS" :key="k" type="button" class="h-14 rounded-2xl border-2 border-brand-200 bg-white text-base font-semibold text-brand-800 active:scale-[0.98]" @click="addPayLine(k)">{{ label }}</button>
          </div>
        </div>
        <p v-if="!payLines.length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">เลือกวิธีชำระด้านบนเพื่อเริ่มรับเงิน</p>

        <div v-for="(l, i) in payLines" :key="l.key" class="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between gap-2">
            <span class="text-base font-semibold text-stone-800">{{ POS_METHODS[l.method] }}</span>
            <button v-if="!l.qrRef && (payLines.length > 1 || l.method !== 'cash')" type="button" class="rounded-full px-3 py-1 text-sm font-medium text-rose-700 hover:bg-rose-50" @click="removePayLine(i)">ลบ</button>
          </div>
          <label class="label mt-3" :for="'amt-' + l.key">ยอด (บาท)</label>
          <input :id="'amt-' + l.key" v-model="l.amount" type="text" v-num.dec class="input h-12 text-lg font-semibold" :readonly="!!l.qrRef" />

          <template v-if="l.method === 'cash'">
            <label class="label mt-3" :for="'rcv-' + l.key">รับเงินมา (บาท)</label>
            <input :id="'rcv-' + l.key" v-model="l.received" type="text" v-num.dec class="input h-12 text-xl font-semibold" placeholder="0" />
            <div class="mt-2 flex flex-wrap gap-2">
              <button v-for="v in quickFor(l)" :key="v" type="button" class="chip chip-off" @click="l.received = String(v)">{{ v === lineAmt(l) ? 'พอดี' : money(v) }}</button>
            </div>
            <div class="mt-3 flex items-center justify-between rounded-xl p-3" :class="changeOf(l) >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'">
              <span class="text-sm font-medium">{{ changeOf(l) >= 0 ? 'เงินทอน' : 'ยังขาด' }}</span>
              <span class="text-xl font-semibold">{{ money(Math.abs(changeOf(l))) }}</span>
            </div>
          </template>

          <template v-else-if="l.method === 'transfer'">
            <button v-if="!l.qrRef" type="button" class="btn-primary mt-3 h-12 w-full" :disabled="!(lineAmt(l) > 0) || lineAmt(l) > remaining + lineAmt(l) + 0.005" @click="makeQr(l)">สร้าง QR ยอด {{ money(lineAmt(l)) }}</button>

            <div v-else-if="l.status === 'cancelled'" class="mt-3 space-y-2">
              <p class="text-center text-sm text-stone-600">ยกเลิก QR แล้ว</p>
              <button type="button" class="btn-primary h-12 w-full" @click="makeQr(l)">สร้าง QR ใหม่</button>
            </div>

            <div v-else-if="l.confirmed" class="mt-3 space-y-2">
              <div class="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800"><AppIcon name="check" :size="18" /> รับชำระแล้ว{{ l.acceptedBy === 'auto' ? ' (ระบบรับอัตโนมัติ)' : '' }}</div>
              <button type="button" class="btn-outline h-11 w-full" @click="l.confirmed = false; l.acceptedBy = ''; l.maneeId = ''; l.detectedAt = 0">ยกเลิกการรับชำระ</button>
            </div>

            <div v-else class="mt-3 space-y-3">
              <div v-if="l.detectedAt" class="animate-pulse rounded-2xl bg-emerald-600 p-4 text-center text-lg font-bold text-white">ลูกค้าชำระแล้ว · {{ money(lineAmt(l)) }}</div>
              <BillerQr v-else :amount="lineAmt(l)" :ref1="db.shop.merchantCode || ''" :ref2="l.qrRef" />

              <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span v-if="l.detectedAt" class="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">พบรายการโอนแล้ว</span>
                <span v-else-if="expiredLine(l)" class="rounded-full bg-rose-100 px-3 py-1 font-medium text-rose-700">QR หมดอายุแล้ว</span>
                <span v-else class="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">รอลูกค้าชำระ</span>
                <span v-if="l.detectedAt" class="text-stone-600">ระบบรับเองใน <b class="tabular-nums">{{ autoLeft(l) }}</b></span>
                <span v-else-if="!expiredLine(l)" class="text-stone-600">หมดอายุใน <b class="tabular-nums">{{ qrLeft(l) }}</b></span>
              </div>

              <div v-if="!l.detectedAt && !expiredLine(l) && (l.candidates || []).length > 1" class="space-y-2">
                <p class="text-sm font-medium text-amber-800">พบหลายรายการที่ตรง เลือกรายการที่ใช่</p>
                <button v-for="c in l.candidates" :key="c.id" type="button" class="flex h-12 w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4" @click="pickManee(l, c)">
                  <span>{{ timeOnly(c.received_at) }}</span><span class="font-semibold">{{ money(c.amount) }} · เลือก</span>
                </button>
              </div>

              <div class="space-y-2">
                <button v-if="expiredLine(l)" type="button" class="btn-primary h-12 w-full" @click="makeQr(l)">สร้าง QR ใหม่</button>
                <button v-else-if="l.detectedAt" type="button" class="btn-primary h-12 w-full" @click="receiveNow(l)"><AppIcon name="check" :size="16" /> รับชำระ</button>
                <button v-else type="button" class="btn-outline h-12 w-full" @click="receiveNow(l)">ลูกค้าชำระแล้ว (ไม่พบอัตโนมัติ)</button>
                <div class="grid grid-cols-2 gap-2">
                  <button type="button" class="btn-outline h-11" @click="cancelQr(l)">ยกเลิก QR</button>
                  <button v-if="!l.detectedAt" type="button" class="btn-soft h-11" @click="removePayLine(i)">ย้อนกลับ</button>
                </div>
              </div>
            </div>
          </template>
          <p v-else class="mt-3 text-sm text-stone-500">รับตามยอดที่ระบุ</p>
        </div>

        <p v-if="payLines.length && remaining !== 0" class="rounded-xl p-2.5 text-center text-sm" :class="remaining > 0 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-700'">{{ remaining > 0 ? 'เพิ่มวิธีชำระให้ครบยอด' : 'ยอดเกิน ลดยอดของรายการใดรายการหนึ่ง' }}</p>
      </div>
      <template #footer>
        <div class="flex w-full gap-2">
          <button class="btn-outline h-12 flex-1" @click="closePay">ยกเลิก</button>
          <button class="btn-primary h-12 flex-[1.4]" :disabled="!canConfirm" @click="confirmPay"><AppIcon name="check" :size="18" /> ยืนยันรับเงิน</button>
        </div>
      </template>
    </AppModal>

    <!-- ใบเสร็จ -->
    <AppModal v-if="receipt" :title="`ใบเสร็จ ${receipt.code}`" @close="receipt = null">
      <Receipt :order="receipt" />
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="print"><AppIcon name="printer" :size="18" /> พิมพ์</button>
        <button v-if="taxable(receipt)" class="btn-outline flex-1 sm:flex-none" @click="taxFor = receipt">ใบกำกับภาษีเต็มรูป</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="receipt = null">ขายต่อ</button>
      </template>
    </AppModal>
    <TaxInvoiceModal v-if="taxFor" :order="taxFor" @close="taxFor = null" />
    <AppModal v-if="rd.open" title="รับของรางวัลที่ร้าน (ลูกค้ากดแสดงแล้ว)" @close="rd.open = false">
      <div class="space-y-3 text-sm">
        <div v-if="!rd.cust">
          <label class="label">ค้นหาลูกค้า (ชื่อ / เบอร์) ก่อน จึงจะแสดงของรางวัล</label>
          <input v-model="rd.q" type="search" class="input h-11" placeholder="พิมพ์ชื่อหรือเบอร์อย่างน้อย 2 ตัวอักษร" aria-label="ค้นหาลูกค้าเพื่อแลกของ" />
          <div v-if="rdMatches.length" class="mt-2 space-y-1">
            <button v-for="c in rdMatches" :key="c.id" type="button" class="flex w-full justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-left hover:border-brand-300" @click="rdPick(c)"><span class="truncate">{{ c.name }}</span><span class="shrink-0 text-stone-500">{{ c.phone ? formatPhone(c.phone) : '' }}</span></button>
          </div>
          <p v-else-if="rd.q.trim().length >= 2" class="mt-2 text-xs text-stone-400">ไม่พบลูกค้า</p>
        </div>
        <template v-else>
          <div class="flex items-center justify-between rounded-xl bg-brand-50 p-3"><div class="min-w-0"><div class="truncate font-semibold text-brand-900">{{ rd.cust.name }}</div><div class="text-xs text-brand-800">{{ rd.cust.phone ? formatPhone(rd.cust.phone) : '' }} · {{ rdPoints }} คะแนน</div></div><button type="button" class="text-xs text-stone-500 underline" @click="rd.cust = null; rd.msg = ''; rd.err = ''">เปลี่ยนลูกค้า</button></div>
          <section aria-label="ของรางวัลที่รอรับ">
            <div class="mb-1 font-semibold text-stone-800">ของรางวัลที่ลูกค้ากด "ใช้ที่ร้านตอนนี้" แล้ว</div>
            <p v-if="!rdPending.length" class="text-xs text-stone-400">ไม่มีของที่ลูกค้ากดแสดงอยู่</p>
            <ul class="space-y-1.5"><li v-for="cp in rdPending" :key="cp.id" class="flex items-center justify-between gap-2 rounded-xl border border-stone-200 p-2.5"><span class="min-w-0"><span class="block truncate font-medium">{{ cp.name }}</span><span class="block text-xs text-amber-700">เหลือเวลา {{ mmss(cp) }} · หมดเวลา = ถือว่าใช้แล้ว</span></span><button type="button" class="btn-primary h-9 shrink-0 px-3" @click="rdHand(cp)">มอบของ</button></li></ul>
          </section>
          <p v-if="rdCoupons.length" class="rounded-xl bg-emerald-50 p-2.5 text-xs text-emerald-800" role="note">ลูกค้าแสดงคูปองส่วนลดอยู่ {{ rdCoupons.length }} ใบ — ใช้ได้ที่ขั้นตอนชำระเงินของการขาย (เลือกลูกค้าเป็นสมาชิกก่อน)</p>
          <p v-if="rdHidden" class="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800" role="note">ยังมีอีก {{ rdHidden }} รายการที่ลูกค้าไม่ได้กด "ใช้ที่ร้านตอนนี้" — ให้ลูกค้ากดในระบบลูกค้าของตนเอง (ยืนยันว่าลูกค้าทำรายการเอง) รายการจึงจะขึ้นที่นี่ · ร้านแลกแทนลูกค้าไม่ได้</p>
        </template>
        <p v-if="rd.err" class="text-rose-700" role="alert">{{ rd.err }}</p>
        <p v-if="rd.msg" class="rounded-xl bg-emerald-50 p-2.5 text-emerald-800" role="status">{{ rd.msg }}</p>
      </div>
      <template #footer><button class="btn-primary flex-1 sm:flex-none" @click="rd.open = false">ปิด</button></template>
    </AppModal>
  </div>
</template>
