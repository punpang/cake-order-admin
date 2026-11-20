<script setup>
import { couponQuoteOf, quoteCouponList, couponTermsText } from '../lib/coupons'
import { resolveCouponScan, resolveMemberScan } from '../lib/scan'
import MoneyInput from '../components/MoneyInput.vue'
import { orderNo } from '../lib/format'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  db, can, currentShift, openShift, closeShift, shiftSummary, shiftBills, posPromoInfo, posSale, voidPosSale, addPosPartial, editPosPending, finishPosBill, pointsFor, vatNow,
  customerPoints, posCoupons, findCustomer, modsOf, modsText, lineKey, pendingRewards, notShownCount, posHandOver, posCouponProblem, sweepCoupons, claimPosCoupons, releaseCoupons,
  newPosQrRef, posQrExpired, issueLuckyToken, reserveBillId, prepQueue, markPrepDone, remoteCustomerSearch, searchCustomersNow,
} from '../data/store'
import { activeSecondsLeft, expiringSoon, pointBalance, conversionPlan } from '../lib/loyalty'
import { orderTotals, discountLines } from '../lib/pricing'
import { pointPromoFor } from '../lib/posPromo'
import { coBought, rankSellers, suggestBundles } from '../lib/posRec'
import { POS_METHODS, ROLES } from '../lib/constants'
import { askConfirm } from '../lib/confirm'
import { isUnsaved, needBind, closeGuard, canBindCash } from '../lib/payBind'
import { cartOfBill } from '../lib/billEdit'
import { refreshLabels, labelsLoadedAt } from '../lib/staffAuth'
import { waitSaved } from '../lib/syncStatus'
import { showToast } from '../lib/toast'
import { quietly } from '../lib/loading'
import { watchTable } from '../lib/liveWatch'
import { isNative, getDeviceConfig, pushDisplay, showDisplay, displayCount } from '../lib/nativeDevices'
import { printOrderReceipt } from '../lib/receiptRaster'
import { billerIdOf, promptPayBillerPayload } from '../lib/promptpay'
import DeviceSettings from '../components/DeviceSettings.vue'
import { money, dateTime, timeOnly, dateOnly, toDateStr, phoneDigits, formatPhone, phoneValid } from '../lib/format'
import AppIcon from '../components/AppIcon.vue'
import { kb } from '../lib/viewportFit'
import AppModal from '../components/AppModal.vue'
import DiscountDetail from '../components/DiscountDetail.vue'
import Receipt from '../components/Receipt.vue'
import RefundEditor from '../components/RefundEditor.vue'
import RefundPartialDialog from '../components/RefundPartialDialog.vue'
import ExchangeModal from '../components/ExchangeModal.vue'
import ChangeBuyerModal from '../components/ChangeBuyerModal.vue'
import TaxInvoiceModal from '../components/TaxInvoiceModal.vue'
import { invoiceOfOrder } from '../data/acct'
import { defaultRefundMethod, returnedQtyOf } from '../lib/refund'
import BillerQr from '../components/BillerQr.vue'
import { listTransfersOfRef } from '../lib/maneeRemote'
import { labelsFresh, LABEL_REFRESH_EVERY_S, PAID_FLASH_MS } from '../lib/payFresh'
import { watchRefs, reservedOf, isWatched, canBindLine, adoptPatch, notDismissed } from '../lib/qrWatch'
import { adsForDisplay } from '../lib/displayAds'

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
  if (!memberChoice.value && !editBill.value) return
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
// ข้อมูลคะแนนของสมาชิกที่เลือก: คะแนนที่มี และคะแนนที่จะหมดอายุภายในจำนวนวันตั้งค่า
const memberPts = computed(() => (member.value ? pointBalance(member.value.ledger || [], toDateStr(new Date())) : 0))
const memberSoon = computed(() => (member.value ? expiringSoon(member.value.ledger || [], toDateStr(new Date()), Number(db.shop.pointsExpireDays ?? 30)) : null))
// ข้อมูลก่อนเลือกสมาชิก: คูปองที่มี · ของรางวัลที่แลกได้จากคะแนน · รางวัลที่ยังขาดอีกกี่แต้ม · คะแนนแปลงเป็นส่วนลดได้เท่าไร
const redeemInfo = (c) => {
  const pts = customerPoints(c)
  return {
    pts,
    value: conversionPlan(c.ledger || [], toDateStr(new Date()), db.loyalty.pointValue)?.amount ?? 0,
    soon: expiringSoon(c.ledger || [], toDateStr(new Date()), Number(db.shop.pointsExpireDays ?? 30)),
    coupons: posCoupons(c, nowIso.value).map((x) => x.name),
    rewards: db.rewards.filter((r) => r.active !== false).map((r) => {
      const points = Number(r.points) || 0
      return { id: r.id, name: r.name, points, ok: pts >= points, need: Math.max(0, points - pts) }
    }).sort((a, b) => a.points - b.points),
  }
}
const memberSearchOpen = ref(false)
// คิวไปทำ (หมวดที่ตั้งว่าต้องเตรียม) · อัปเดตเมื่อขาย/กดเสร็จ
const prepList = computed(() => (db.shop.prepCategories?.length ? prepQueue() : []))
function prepDone(p) { markPrepDone(p.orderId, p.itemId) }
// ทุกการขายต้องเลือกก่อนว่า มีสมาชิก หรือ ไม่มี (null = ยังไม่เลือก → ยังเพิ่มสินค้าไม่ได้)
const memberChoice = ref(null)
function chooseNoMember() { member.value = null; couponIds.value = []; memberQ.value = ''; memberChoice.value = 'none' }
const memberInputEl = ref(null)
const gateInputEl = ref(null)
watch(memberSearchOpen, (v) => { if (v) nextTick(() => memberInputEl.value?.focus()) })
const memberInfoOf = ref(null) // สมาชิกที่เปิดดูข้อมูลในไดอะล็อกแยก // กดปุ่ม "สมาชิก" ก่อน แล้วจึงแสดงช่องค้นหา
const member = ref(null)
const memberMatches = computed(() => {
  const s = memberQ.value.trim().toLowerCase()
  if (s.length < 2) return []
  // เบอร์ต้องพิมพ์ครบจึงค้นได้ (ไม่ค้นจากเลขบางส่วน) · รหัสสแกนที่มีตัวอักษรไม่ถูกตีความเป็นเบอร์
  const d = /^[\d\s-]+$/.test(s) ? phoneDigits(s) : ''
  if (d.length < 10) return [] // เบอร์มือถือ 10 หลัก: แสดงผลเมื่อพิมพ์ครบ
  return db.customers.filter((c) => c.active !== false && c.phone && c.phone.includes(d)).slice(0, 5)
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
// ---------- โหมดแป้นพิมพ์ (หน้าชำระเงิน): กดคีย์บอร์ด → โหมดแป้นพิมพ์ · แตะหน้าจอ → กลับเป็นแป้นบนจอ ----------
const kbMode = ref('touch')
const payField = () => {
  const l = focusLine.value
  if (!l || l.locked || l.confirmed) return null
  if (l.method === 'cash') return { l, field: padField(l) }
  if (l.method === 'transfer' && !l.qrRef) return { l, field: 'amount' }
  return null
}
function onPayKey(e) {
  if (!payOpen.value || e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  const inMemberBox = t && t.getAttribute && t.getAttribute('aria-label') === 'ค้นหาสมาชิกสะสมแต้ม' && !memberQ.value.trim()
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable]') && !(e.key === 'Enter' && inMemberBox)) return // ช่องค้นหาสมาชิกยังพิมพ์ได้ตามปกติ · Enter ในช่องว่างใช้เป็นคำสั่งชำระ
  if (e.key === 'Enter') {
    const q = focusLine.value
    if (q && q.method === 'transfer' && !q.qrRef && !q.locked && !q.confirmed) { e.preventDefault(); kbMode.value = 'keyboard'; makeQr(q); return } // โอน: Enter = สร้าง QR
    if (canConfirm.value) { e.preventDefault(); kbMode.value = 'keyboard'; confirmPay(); return }
    // เงินสดที่กรอกยอดแล้ว: Enter = กดปุ่ม "บันทึกยอดเงินสดนี้" (ตรงกับคำแนะนำ "Enter ยืนยันรับเงิน")
    if (q && q.method === 'cash' && !q.locked && !q.confirmed && lineAmt(q) > 0 && changeOf(q) >= 0 && !binding.value) { e.preventDefault(); kbMode.value = 'keyboard'; keepAndAddMore() }
    return
  }
  const f = payField()
  if (!f) return
  if (/^[0-9]$/.test(e.key) || e.key === '.') { e.preventDefault(); kbMode.value = 'keyboard'; padInput(f.l, f.field, e.key) }
  else if (e.key === 'Backspace') { e.preventDefault(); kbMode.value = 'keyboard'; padInput(f.l, f.field, 'back') }
}
function onPayTouch() { if (payOpen.value) kbMode.value = 'touch' }
onMounted(() => { window.addEventListener('keydown', onPayKey); window.addEventListener('pointerdown', onPayTouch) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onPayKey); window.removeEventListener('pointerdown', onPayTouch) })
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
// สแกนรหัสสมาชิกในช่องแลกของรางวัล = เลือกลูกค้าให้ทันที
watch([() => rd.q, () => db.customers.length], ([v]) => { remoteCustomerSearch(v); const c = resolveMemberScan(v, db.customers); if (c) rdPick(c) })
watch(memberQ, (v) => remoteCustomerSearch(v)) // โหมดโหลดลูกค้าเฉพาะที่ใช้: ค้นที่เซิร์ฟเวอร์ด้วย
async function rdHand(cp) {
  rd.msg = rd.err = ''
  if (!(await askConfirm({ title: 'มอบของรางวัล', message: `${cp.name} ให้ ${rd.cust.name} · มอบแล้วถือว่าใช้แล้ว`, okText: 'มอบแล้ว' }))) return
  const r = posHandOver(rd.cust.id, cp.id)
  if (r.error) rd.err = r.error
  else rd.msg = `มอบ ${cp.name} แล้ว`
}
const couponIds = ref([])
const discount = ref('')
function clearMemberPick() { chooseNoMember() }
function pickMember(c) {
  member.value = c
  memberChoice.value = 'yes'
  memberQ.value = ''
  memberSearchOpen.value = false
  couponIds.value = []
}
// พิมพ์เบอร์ครบ: แสดงผลค้นหาพร้อมข้อมูลสิทธิ์ให้ดูก่อน แล้วกดเลือกเอง (ไม่เลือกอัตโนมัติ) · เครื่องสแกนยังเลือกด้วย Enter (onMemberScan)
// เครื่องสแกน USB ส่งรหัสคูปองมาแล้วกด Enter: เลือกลูกค้าเจ้าของคูปองและเลือกคูปองนั้นให้เลย (เฉพาะที่ลูกค้ากดแสดงที่ร้านอยู่)
const scanMsg = ref('')
// สแกนคูปองของลูกค้าในหน้าชำระเงิน (ไดอะล็อกจากปุ่ม · เครื่องสแกน USB ยิงรหัสแล้วกด Enter)
// ยังไม่ได้เลือกลูกค้า → เลือกเจ้าของคูปองให้เลย (เหมือนช่องสแกนหน้าเริ่มขาย) · ใช้ได้เฉพาะคูปองที่ลูกค้ากดแสดงที่ร้านแล้วและยังไม่หมดเวลา
// หลังเริ่มรับชำระแล้ว เพิ่มคูปองหรือเปลี่ยนลูกค้าไม่ได้
const cpScanQ = ref('')
const cpScanMsg = ref('')
const cpScanOpen = ref(false)
const cpScanInputEl = ref(null)
watch(cpScanOpen, (v) => { if (v) nextTick(() => cpScanInputEl.value?.focus()) })
function onCouponScan() {
  const raw = cpScanQ.value
  cpScanQ.value = ''
  cpScanMsg.value = ''
  if (!String(raw).trim()) return
  if (resumeOrder.value) { cpScanMsg.value = 'บิลค้างรับส่วนที่เหลือ ใช้คูปองเพิ่มไม่ได้'; return }
  if (memberLocked.value) { cpScanMsg.value = 'เริ่มรับชำระแล้ว เพิ่มคูปองหรือเปลี่ยนลูกค้าไม่ได้'; return }
  const hit = resolveCouponScan(raw, db.coupons)
  if (!hit) { cpScanMsg.value = 'ไม่พบคูปองนี้'; return }
  if (member.value && hit.customerId !== member.value.id) { cpScanMsg.value = 'ไม่พบคูปองนี้ของลูกค้าคนนี้'; return }
  const owner = member.value || findCustomer(hit.customerId)
  if (!owner) { cpScanMsg.value = 'กำลังโหลดข้อมูลลูกค้า ลองสแกนอีกครั้ง'; return }
  if (!posCoupons(owner, nowIso.value).some((c) => c.id === hit.id)) { cpScanMsg.value = `คูปอง ${hit.name} ยังไม่ได้กด "ใช้ที่ร้านตอนนี้" หรือหมดเวลาแล้ว`; return }
  if (!couponOk(hit)) { cpScanMsg.value = couponReason(hit) || `คูปอง ${hit.name} ใช้กับบิลนี้ไม่ได้`; return }
  if (!member.value) pickMember(owner)
  if (!couponIds.value.includes(hit.id)) couponIds.value = [...couponIds.value, hit.id]
  cpScanOpen.value = false
}
async function onMemberScan() {
  scanMsg.value = ''
  if (!resolveMemberScan(memberQ.value, db.customers)) await searchCustomersNow(memberQ.value) // ยังไม่มีในเครื่อง → ค้นที่เซิร์ฟเวอร์ก่อน
  const mem = resolveMemberScan(memberQ.value, db.customers)
  if (mem) { pickMember(mem); return }
  const hit = resolveCouponScan(memberQ.value, db.coupons)
  if (!hit) return
  const cust = findCustomer(hit.customerId)
  if (!cust) return
  if (!posCoupons(cust, nowIso.value).some((c) => c.id === hit.id)) {
    memberQ.value = ''
    scanMsg.value = `คูปอง ${hit.name} ยังไม่ได้กด "ใช้ที่ร้านตอนนี้" หรือหมดเวลาแล้ว`
    return
  }
  pickMember(cust)
  couponIds.value = [hit.id]
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
const usedPromos = computed(() => [...new Set(lineItems.value.flatMap((i) => (i.discounts || []).filter((d) => d.kind === 'promo' || d.kind === 'bundle' || d.kind === 'gift').map((d) => d.name)))])
// แก้รายการบิลค้าง (แอดมิน): บิลที่กำลังแก้ · คูปองเดิมในบิลที่ยังไม่ได้เอาออก · ใช้คิดยอดตอนแก้
const editBill = ref(null) // null = ขายใหม่จากตะกร้า
// กันข้อมูลหายตอนรีเฟรช/เปลี่ยนหน้า: เก็บบิลที่กำลังขาย (ตะกร้า สมาชิก คูปอง ส่วนลด) ไว้ใน sessionStorage ของแท็บนี้ แล้วคืนให้หลังโหลดใหม่
const DRAFT_KEY = 'pos-draft-v1'
function readDraft() { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') } catch { return null } }
let draftReady = false // ยังไม่ได้ลองคืนบิลเดิม → ห้ามเขียนทับ/ลบบิลที่เก็บไว้
function writeDraft() {
  if (!draftReady) return
  try {
    const empty = !cart.value.length && !member.value && !couponIds.value.length && !discount.value
    if (empty || editBill.value || !shift.value) sessionStorage.removeItem(DRAFT_KEY)
    else sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ shiftId: shift.value.id, cart: cart.value, memberId: member.value?.id || null, memberChoice: memberChoice.value, couponIds: couponIds.value, discount: discount.value }))
  } catch { /* เบราว์เซอร์ไม่ให้เก็บ: ใช้งานต่อได้ตามปกติ */ }
}
function restoreDraft() {
  const d = readDraft()
  draftReady = true
  if (!d || d.shiftId !== shift.value?.id || cart.value.length) return // บิลของกะอื่น หรือเริ่มขายใหม่ไปแล้ว
  cart.value = (d.cart || []).filter((l) => catalog.value.some((x) => x.id === l.refId && x.kind === l.kind))
  memberChoice.value = d.memberChoice || null
  couponIds.value = Array.isArray(d.couponIds) ? d.couponIds : []
  discount.value = d.discount || ''
  if (!d.memberId) return
  const c = findCustomer(d.memberId)
  if (c) { member.value = c; return }
  // ลูกค้ายังไม่อยู่ในเครื่อง (โหมดโหลดลูกค้าเฉพาะที่ใช้ → findCustomer สั่งดึงแล้ว) → ใส่เมื่อมาถึง ถ้ายังไม่ได้เปลี่ยนสมาชิก
  let stopMember = null
  stopMember = watch(() => findCustomer(d.memberId), (x) => { if (x && !member.value) member.value = x; if (x) stopMember?.() })
  setTimeout(() => stopMember?.(), 15000)
}
// คืนบิลเมื่อกะและรายการสินค้าพร้อม (หลังรีเฟรช ข้อมูลกะ/สินค้าอาจมาหลังหน้าเปิด · คืนก่อนพร้อม = รายการในตะกร้าหายหมด)
let stopRestore = null
let restoreDone = false
stopRestore = watch(() => !!shift.value && catalog.value.length > 0, (ready) => {
  if (!ready || restoreDone) return
  restoreDone = true
  restoreDraft()
  stopRestore?.()
}, { immediate: true })
watch([cart, member, memberChoice, couponIds, discount, editBill], writeDraft, { deep: true })
const needMemberChoice = computed(() => !!shift.value && tab.value === 'sell' && !memberChoice.value && !editBill.value)
watch(needMemberChoice, (v) => { if (v) nextTick(() => gateInputEl.value?.focus()) })
const editDrop = ref([]) // คูปองเดิมในบิลที่เลือกเอาออก (มีผลตอนบันทึก)
const billKept = computed(() => (editBill.value ? editBill.value.couponsUsed.filter((c) => !editDrop.value.includes(c.couponId)) : []))
// คูปองแบบ % / ซื้อสินค้าคิดจากรายการในตะกร้า จึงคิดใหม่ทุกครั้งที่รายการหรือคูปองที่เลือกเปลี่ยน (กติกาเดียวกับตอนบันทึกจริง)
const billBase = computed(() => ({
  items: lineItems.value, fulfillment: 'pickup', payments: [],
  adjustment: editBill.value ? editBill.value.adjustment : { amount: -(Number(discount.value) || 0), reason: 'ส่วนลดหน้าร้าน' }, pointsUsed: null, vat: editBill.value ? editBill.value.vat : vatNow(),
}))
const keptQ = computed(() => quoteCouponList({ ...billBase.value, couponsUsed: [] }, billKept.value.map((u) => db.coupons.find((x) => x.id === u.couponId)).filter(Boolean)))
const keptProblem = computed(() => (keptQ.value.rejected[0] ? `คูปอง ${keptQ.value.rejected[0].coupon.name} ไม่เข้าเงื่อนไขแล้ว: ${keptQ.value.rejected[0].reason} · เอาออกก่อนจึงบันทึกได้` : ''))
const billWithKept = computed(() => ({ ...billBase.value, couponsUsed: keptQ.value.used }))
const couponOk = (c) => couponQuoteOf(c, billWithKept.value).ok
const couponReason = (c) => couponQuoteOf(c, billWithKept.value).reason
const pickedCoupons = computed(() => quoteCouponList(billWithKept.value, coupons.value.filter((c) => couponIds.value.includes(c.id))).used)
watch([billWithKept, coupons], () => (couponIds.value = couponIds.value.filter((id) => coupons.value.some((c) => c.id === id && couponOk(c)))))
const orderLike = computed(() => ({ ...billWithKept.value, couponsUsed: [...billWithKept.value.couponsUsed, ...pickedCoupons.value] }))
const preview = computed(() => orderTotals(orderLike.value))
const resumeOrder = ref(null) // บิลค้างที่กำลังรับชำระส่วนที่เหลือ (null = ขายใหม่จากตะกร้า)
const total = computed(() => (resumeOrder.value ? Math.max(orderTotals(resumeOrder.value).total, 0) : Math.max(preview.value.total, 0)))
// คะแนนที่สมาชิกจะได้จากบิลนี้ (ยอดสุทธิ + โปรคะแนนพิเศษ)
const earn = computed(() => (member.value && cart.value.length ? pointsFor(orderLike.value, new Date()) : null))

// ---------- ชำระเงิน ----------
const payOpen = ref(false)
// รายการชำระของบิลนี้: เงินสด / โอน (มี QR หมดอายุตามตั้งค่า) / บัตร · หลายรายการได้ ยอดรวมต้องพอดี
const payLines = ref([])
const payNow = ref(Date.now())
let payTimer = null
let payTick = 0
let maneePolling = false
// รายการโอนเข้าใหม่ (Realtime บนตาราง tungngern_transfers) → ตรวจทันที · ไม่มี Realtime = โพลล์ทุก 5 วินาทีเหมือนเดิม
let transferWatch = null
let transferWatchOff = true
const pollEvery = () => (transferWatch?.isLive() ? 30 : 5)
async function startTransferWatch() {
  transferWatchOff = false
  if (transferWatch || !can('pos')) return
  const w = await watchTable({ table: 'tungngern_transfers', event: 'INSERT' }, () => quietly(pollManee))
  if (transferWatchOff) w.stop(); else transferWatch = w
}
function stopTransferWatch() {
  transferWatchOff = true
  transferWatch?.stop()
  transferWatch = null
}
const lineAmt = (l) => Math.round((Number(l.amount) || 0) * 100) / 100
const compactLine = (l) => l.method === 'transfer' && !!l.confirmed // รายการโอนที่รับแล้วแสดงเป็นแถวเดียวในหน้าชำระ
const paidSum = computed(() => Math.round(payLines.value.reduce((s, l) => s + reservedOf(l, lineAmt(l)), 0) * 100) / 100) // QR ที่ยกเลิกแล้วไม่กันยอด
const remaining = computed(() => Math.round((total.value - paidSum.value) * 100) / 100)
// เปลี่ยนสมาชิกได้จนกว่าจะมีรายการที่สร้าง QR หรือรับชำระแล้ว (กันยอดที่แจ้งไปแล้วเปลี่ยน)
const memberLocked = computed(() => payLines.value.some((l) => l.qrRef || l.confirmed || l.locked))
const newKey = () => Math.random().toString(36).slice(2)
const expiredLine = (l) => !l.detectedAt && !l.confirmed && l.status !== 'cancelled' && posQrExpired(l, payNow.value)
const AUTO_ACCEPT_MS = 3 * 60 * 1000 // พบรายการโอนแล้ว พนักงานไม่กดรับภายใน 3 นาที ระบบรับเอง
const autoLeft = (l) => { const sec = Math.max(0, Math.ceil((l.detectedAt + AUTO_ACCEPT_MS - payNow.value) / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }
const changeOf = (l) => (Number(l.received) || 0) - lineAmt(l)
const quickFor = (l) => { const a = lineAmt(l); return [...new Set([a, Math.ceil(a / 100) * 100, Math.ceil(a / 500) * 500, Math.ceil(a / 1000) * 1000])].filter((v) => v >= a) }
const qrLeft = (l) => { const sec = Math.max(0, Math.ceil((new Date(l.qrExpiresAt).getTime() - payNow.value) / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }
// มีจอลูกค้าต่ออยู่ (แอปเครื่อง) → QR แสดงที่จอลูกค้าเท่านั้น ฝั่งร้านไม่แสดง · ไม่มีจอ → แสดง QR ฝั่งร้านเป็นทางสำรอง
const customerScreen = ref(false)
async function checkCustomerScreen() {
  if (!native) return
  customerScreen.value = (await displayCount().catch(() => 0)) > 0
}
function openPay() {
  checkCustomerScreen()
  if (!cart.value.length || editBill.value) return
  payErr.value = ''
  payLines.value = []
  focusKey.value = ''
  seenPaid = []
  payNow.value = Date.now()
  clearInterval(payTimer)
  payTimer = setInterval(() => {
    payNow.value = Date.now(); tickLines()
    if (++payTick % pollEvery() === 0) quietly(pollManee)
    // ระหว่างรอการโอน โหลดสต็อก/กะล่วงหน้าเป็นช่วง ๆ เพื่อให้การยืนยันอัตโนมัติไม่ต้องรอ
    if (payTick % LABEL_REFRESH_EVERY_S === 0 && waitingTransfer()) refreshLabelsNow()
  }, 1000)
  payOpen.value = true
  startTransferWatch()
  if (!payLines.value.length && remaining.value > 0) startMethod('transfer') // ค่าเริ่มต้น: QR
}
function closePay() {
  payOpen.value = false
  payLines.value = []
  focusKey.value = ''
  resumeOrder.value = null
  clearInterval(payTimer)
  stopTransferWatch()
}
onBeforeUnmount(() => {
  clearInterval(payTimer)
  stopTransferWatch()
  clearTimeout(thanksTimer)
  // ออกจากหน้าขาย: จอลูกค้ากลับเป็นหน้ายินดีต้อนรับ (ไม่ค้างตะกร้า/การชำระ/QR)
  if (native) pushDisplay({ status: 'idle', shopName: db.shop?.name || '', ads: adsForDisplay(db.storefront?.displayAds) })
})
onMounted(() => { if (native) showDisplay().catch(() => {}) })
function addPayLine(method) {
  if (remaining.value <= 0) return
  payLines.value.push({ key: newKey(), method, amount: String(remaining.value), received: '', qrRef: '', qrExpiresAt: '', confirmed: false })
}
function removePayLine(i) {
  payLines.value.splice(i, 1)
}
// ข้อมูลสต็อก/กะที่โหลดไว้ล่าสุด: ระหว่างรอการโอนโหลดเบื้องหลังเป็นช่วง ๆ (ไม่ขึ้นหน้าจอหมุน) ให้การยืนยันอัตโนมัติไม่ต้องรอโหลดก่อนบันทึก
const LABEL_NAMES = ['สินค้า', 'กะ POS']
let labelsAt = 0
let labelsLoading = null
const waitingTransfer = () => payLines.value.some((l) => l.method === 'transfer' && l.qrRef && !l.confirmed && l.status !== 'cancelled')
// รอบที่กำลังโหลดอยู่จะถูกใช้ร่วมกัน ไม่ยิงซ้ำ · เวลาที่ใช้ได้ = เวลาโหลดสำเร็จเก่าที่สุดของสองตาราง
function refreshLabelsNow() {
  if (!labelsLoading) {
    labelsLoading = quietly(() => refreshLabels(LABEL_NAMES)).finally(() => { labelsAt = labelsLoadedAt(LABEL_NAMES); labelsLoading = null })
  }
  return labelsLoading
}
// ยืนยันอัตโนมัติ: ข้อมูลที่โหลดสำเร็จไม่เกิน 5 วินาทีใช้ได้เลย · ไม่สดจึงโหลดก่อน
async function labelsForAutoBind() {
  if (labelsFresh(labelsAt)) return
  await refreshLabelsNow()
}
// ดึงรายการโอนที่มีรหัสธุรกรรมตรงกับ QR ที่ยังรอชำระ: เมื่อมีรายการเข้า (realtime) และสำรองตามรอบ (ทุก 5 วินาที · 30 วินาทีเมื่อ realtime ทำงาน)
// พบรายการเดียว → ขึ้นสถานะ "ลูกค้าชำระแล้ว" (อนิเมชัน) รอพนักงานกดรับ · พบหลายรายการ → ให้พนักงานเลือกเอง
// มีเหตุการณ์เข้ามาระหว่างรอบที่กำลังค้นหา → ค้นอีกรอบทันทีเมื่อรอบนั้นจบ (ไม่ทิ้งเหตุการณ์)
let maneeAgain = false
// ค้นรายการโอนของทุกรหัส QR ของรายการ (รหัสปัจจุบัน + รหัสเดิม) · ติด error = null (ข้ามรอบนี้)
async function findTransfers(l) {
  const found = []
  for (const ref of watchRefs(l)) {
    const r = await listTransfersOfRef({ ref, amount: lineAmt(l) })
    if (r.error) return null
    found.push(...r.rows.map((row) => ({ ...row, ref })))
  }
  return found
}
async function pollManee() {
  if (maneePolling) { maneeAgain = true; return }
  maneePolling = true
  try {
    do {
      maneeAgain = false
      let autoOk = false
      for (const l of payLines.value) {
        if (!isWatched(l, expiredLine(l))) continue
        const got = await findTransfers(l)
        if (!got) continue
        const found = notDismissed(got, l.dismissed)
        // บิลรับครบแล้วจากวิธีอื่น → ไม่ผูกเอง แจ้งให้พนักงานตัดสิน
        if (!canBindLine(lineAmt(l), remaining.value, reservedOf(l, lineAmt(l)))) { l.lateNotice = found; continue }
        if (found.length) l.candidates = found
        if (found.length !== 1) continue
        Object.assign(l, adoptPatch(l, found[0].ref, found[0]))
        if (db.shop.posAutoAcceptNow) { Object.assign(l, { confirmed: true, acceptedBy: 'auto' }); autoOk = true }
      }
      if (autoOk) autoBindAndFinish()
    } while (maneeAgain && payOpen.value)
  } finally { maneePolling = false }
}
// รับเองเมื่อครบ 3 นาทีหลังพบรายการ (เฉพาะกรณีพบรายการเดียว)
function tickLines() {
  let autoOk = false
  for (const l of payLines.value) {
    if (l.method === 'transfer' && l.detectedAt && !l.confirmed && l.status !== 'cancelled' && Date.now() - l.detectedAt >= AUTO_ACCEPT_MS) { Object.assign(l, { confirmed: true, acceptedBy: 'auto' }); autoOk = true }
  }
  if (autoOk) autoBindAndFinish()
}
function pickManee(l, c) {
  if (!canBindLine(lineAmt(l), remaining.value, reservedOf(l, lineAmt(l)))) return (payErr.value = 'บิลนี้รับยอดครบแล้ว ให้พนักงานตัดสินเอง')
  Object.assign(l, adoptPatch(l, c.ref, c), { confirmed: true, acceptedBy: 'staff' })
  bindPaid()
}
// ค้นการโอนของ QR เดิมด้วยมือ (ทุกรหัสที่เคยออก) · บิลรับครบแล้ว → แสดงให้พนักงานตัดสิน ไม่ให้ผูก
async function searchLate(l) {
  const found = await findTransfers(l)
  if (!found) return (payErr.value = 'ดึงรายการโอนไม่สำเร็จ ลองอีกครั้ง')
  l.searched = true
  if (!canBindLine(lineAmt(l), remaining.value, reservedOf(l, lineAmt(l)))) { l.lateNotice = found; l.candidates = []; return }
  l.lateNotice = []
  l.candidates = found
}
// พนักงานปิดการแจ้งเตือนของการโอนที่ไม่ได้ผูก · จำไว้ไม่ให้แจ้งซ้ำ
function dismissLate(l) {
  l.dismissed = [...new Set([...(l.dismissed || []), ...l.lateNotice.map((r) => r.id)])]
  l.lateNotice = []
}
function receiveNow(l) {
  Object.assign(l, { confirmed: true, acceptedBy: 'staff' })
  bindPaid()
}
function cancelQr(l) {
  // รายการที่เคยพบหรือเคยเสนอแล้ว ไม่จับคู่ซ้ำหลังยกเลิก (กันพบกลับทันที) · ค้นด้วยมือยังเห็นได้
  const seen = [l.maneeId, ...(l.candidates || []).map((c) => c.id)].filter(Boolean)
  Object.assign(l, { status: 'cancelled', confirmed: false, detectedAt: 0, maneeId: '', candidates: [], dismissed: [...new Set([...(l.dismissed || []), ...seen])] })
}
function makeQr(l) {
  const a = lineAmt(l)
  if (!(a > 0) || !canBindLine(a, remaining.value, reservedOf(l, a))) return
  const ref = newPosQrRef()
  if (!ref) return (payErr.value = 'สร้างรหัส QR ไม่สำเร็จ ลองอีกครั้ง')
  const mins = db.shop.posQrExpireMin || 10
  // เก็บรหัสเดิมไว้เฝ้าต่อ: ลูกค้าอาจยังจ่ายด้วย QR เดิม
  Object.assign(l, { prevRefs: watchRefs(l), qrRef: ref, qrCreatedAt: new Date().toISOString(), qrExpiresAt: new Date(Date.now() + mins * 60000).toISOString(), status: 'waiting', confirmed: false, detectedAt: 0, acceptedBy: '', maneeId: '', candidates: [], lateNotice: [], searched: false })
}
const lineOk = (l) => {
  const a = lineAmt(l)
  if (!(a > 0)) return false
  if (l.method === 'cash') return (Number(l.received) || 0) >= a
  if (l.method === 'transfer') return !!l.qrRef && l.confirmed
  return true
}
// รายการที่ยอด 0 ถูกข้าม (ไม่นับและไม่ส่งไปบันทึก)
const activeLines = computed(() => payLines.value.filter((l) => lineAmt(l) > 0 && l.status !== 'cancelled'))
const canConfirm = computed(() => activeLines.value.length > 0 && remaining.value === 0 && activeLines.value.every(lineOk))
// บันทึกบิลค้างได้เมื่อยังขาดยอดและมีรายการที่รับแล้วซึ่งยังไม่ได้บันทึก (รายการที่ยังไม่รับจะไม่ถูกบันทึก)
const canSavePartial = computed(() => remaining.value > 0 && payLines.value.some((l) => l.confirmed && !l.locked && lineAmt(l) > 0))
// ---------- หน้าชำระแบบเป็นขั้น: เลือกวิธี → ทำรายการนั้นทีละอย่าง → ยืนยัน (ตรรกะรับเงินเดิมไม่เปลี่ยน) ----------
const focusKey = ref('')
// รายการที่จบแล้ว (ไม่ต้องทำอะไรต่อในขั้นนั้น): ผูกบิลแล้ว · โอนที่รับแล้วหรือยกเลิก QR แล้ว
const lineDone = (l) => !!l.locked || (l.method === 'transfer' && (!!l.confirmed || l.status === 'cancelled')) || ((l.method === 'cash' || l.method === 'card') && !!l.confirmed)
// รายการที่กำลังทำ: ที่เลือกไว้ หรือ QR ที่ยังรอโอนอยู่ (ต้องเห็น QR จนกว่าจะรับหรือยกเลิก)
const focusLine = computed(() => payLines.value.find((l) => l.key === focusKey.value && !lineDone(l)) || payLines.value.find((l) => l.method === 'transfer' && l.qrRef && !lineDone(l)) || null)
// รับแล้ว: เงินสดที่รับครบยอดนับทันที (ไม่ต้องกดยืนยันแยก) · บัตร/โอนนับเมื่อกดยืนยันรับแล้ว
const isReceived = (l) => l.status !== 'cancelled' && lineAmt(l) > 0 && (l.confirmed || (l.method === 'cash' && lineOk(l)))
const receivedSum = computed(() => Math.round(payLines.value.filter(isReceived).reduce((s, l) => s + lineAmt(l), 0) * 100) / 100)
const listedLines = computed(() => payLines.value.filter((l) => l !== focusLine.value && l.status !== 'cancelled' && lineAmt(l) > 0))
const cancelledQrs = computed(() => payLines.value.filter((l) => l.method === 'transfer' && l.status === 'cancelled'))
// แท็บวิธีชำระ: QR (ค่าเริ่มต้น) · เงินสด · อื่น ๆ (ไว้เพิ่มช่องทางในอนาคต)
const PAY_TABS = [['transfer', 'QR'], ['cash', 'เงินสด'], ['card', 'อื่น ๆ']]
function startMethod(k) {
  if (remaining.value <= 0 || binding.value) return
  addPayLine(k)
  const l = payLines.value[payLines.value.length - 1]
  focusKey.value = l.key // โอนเงิน: ใส่ยอดแล้วกด "สร้าง QR" เอง
}
// กลับไปเลือกวิธีอื่น: QR ที่รออยู่ถูกยกเลิก (ยังเฝ้าการโอนเข้า QR เดิมจนปิดหน้า) · รายการที่ยังไม่รับถูกลบ
function backToMethods(l) {
  if (l && !l.locked && !l.confirmed) {
    if (l.qrRef) { if (l.status !== 'cancelled') cancelQr(l) } else removePayLine(payLines.value.indexOf(l))
  }
  focusKey.value = ''
}
// แบ่งจ่ายด้วยโอน: ยกเลิก QR ยอดเต็ม แล้วให้ใส่ยอดใหม่ก่อนสร้าง QR
function splitTransfer(l) {
  if (l.qrRef && l.status !== 'cancelled') cancelQr(l)
  addPayLine('transfer')
  const nl = payLines.value[payLines.value.length - 1]
  nl.split = true // แสดงแป้นตัวเลขให้ใส่ยอดใหม่ทันที
  focusKey.value = nl.key
}
// เปลี่ยนวิธีจากแท็บได้เมื่อรายการยังไม่สร้าง QR และยังไม่รับเงิน (QR ต้องกด "ยกเลิก QR" เอง กันกดพลาด)
const canSwitch = (l) => !l.qrRef && !l.detectedAt && !l.locked && !l.confirmed && !binding.value
function pickMethod(k) {
  const l = focusLine.value
  if (l) {
    if (l.method === k || !canSwitch(l)) return
    backToMethods(l)
  }
  startMethod(k)
}
// เงินทอนรวมของบิล (แสดงตอนรับครบแล้ว)
const changeTotal = computed(() => payLines.value.filter((l) => l.method === 'cash' && l.status !== 'cancelled' && !l.locked).reduce((s, l) => s + Math.max(changeOf(l), 0), 0))
// เก็บยอดเงินสดหรือบัตรนี้ไว้ แล้วไปรับส่วนที่เหลือด้วยวิธีอื่น
const keepAndAddMore = () => { focusKey.value = '' }
// แป้นตัวเลข (เงินสด: รับเงินมา · โอน: ยอดก่อนสร้าง QR) · ค่าเป็นข้อความเพื่อให้พิมพ์จุดทศนิยมได้
const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']
// แป้นตัวเลขเงินสดแก้ได้ 2 ช่องสลับกัน: ยอดเงินสดครั้งนี้ (เมื่อแบ่งจ่ายและเลือกไว้) หรือรับเงินมา (ค่าเริ่มต้น)
const padField = (l) => (l.split && l.padTarget === 'amount' && !l.locked && !l.confirmed ? 'amount' : 'received')
function padInput(l, field, k) {
  if (l.locked || l.confirmed) return
  const fresh = !!l.padFresh // เพิ่งเลือกช่องนี้: พิมพ์ทับค่าเดิม ไม่ต่อท้าย
  l.padFresh = false
  const cur = fresh ? '' : String(l[field] ?? '')
  if (k === 'back') return (l[field] = cur.slice(0, -1))
  if (k === '.') return (l[field] = cur.includes('.') ? cur : (cur || '0') + '.')
  if (cur.includes('.') && cur.split('.')[1].length >= 2) return
  if (cur.replace('.', '').length >= 9) return
  l[field] = cur === '0' ? k : cur + k
}
// ---------- เครื่องพิมพ์และจอลูกค้า (แอป Android) ----------
const native = isNative()
const deviceOpen = ref(false)
const thanks = ref({ until: 0, total: 0 })
let thanksTimer = null
// รายการบนจอลูกค้า: จำนวน × ราคาต่อหน่วย (ราคาเต็มถ้ามีส่วนลดรายการ) + ป้ายส่วนลด/ของแถม
const displayLines = computed(() => lineItems.value.map((i) => ({
  name: i.name, qty: i.qty, unit: i.unitPrice, fullUnit: i.fullPrice ?? i.unitPrice,
  amount: i.unitPrice * i.qty, gift: !!i.promoGift,
  tags: discountLines(i.discounts, i.qty).map((l) => l.label),
})))
// สรุปยอดครบทุกส่วนลด (ตรงกับใบเสร็จ): ราคาเต็ม · ส่วนลดทุกรายการ · ปรับราคาเพิ่ม · VAT
const displayPricing = computed(() => {
  const t = preview.value
  const discounts = (t.discountLines || []).map((l) => ({ label: l.label, amount: Number(l.amount) || 0 }))
  return {
    full: t.full,
    discounts,
    saved: discounts.reduce((sum, l) => sum + l.amount, 0),
    surcharge: Math.max(0, Number(t.adjustment) || 0),
    vatMode: t.vatMode, vatRate: t.vatRate, vat: t.vat,
  }
})
// แนะนำเพิ่มให้ลูกค้า (ใช้ตรรกะเดียวกับที่พนักงานเห็น): โปรที่ใกล้ถึง · บันเดิ้ลที่ขาดอีกนิด · ซื้อคู่กัน · สินค้าขายดีอันดับ 1
const displaySuggest = computed(() => {
  const hints = (promoInfo.value.hints || []).slice(0, 4).map((h) => h.text)
  const bundles = bundleSug.value.slice(0, 3).map((b) => ({
    name: b.bundle.name, price: Number(b.bundle.price) || 0, saving: b.saving,
    add: b.missing.map((m) => (m.qty > 1 ? `${m.name} ×${m.qty}` : m.name)),
  }))
  const pairs = pairSug.value.slice(0, 4).map((r) => ({ name: r.item.name, price: Number(r.item.price) || 0 }))
  const inCart = new Set(cartRetail.value.map((l) => l.retailId))
  const top = [...ranks.value].find(([, v]) => v.rank === 1)
  const topItem = top && !inCart.has(top[0]) ? catalog.value.find((x) => x.id === top[0]) : null
  const best = topItem ? { name: topItem.name, price: Number(topItem.price) || 0 } : null
  return { hints, bundles, pairs, best }
})
// ฟลาช "รับชำระแล้ว" บนจอลูกค้า: เมื่อมีรายการถูกรับชำระ (โอนพบ / รับเอง / รับเงินสด) แสดงชั่วครู่ แล้วกลับไปหน้าการชำระเงิน
const paidFlash = ref({ until: 0, amount: 0 })
let paidFlashTimer = null
let seenPaid = []
watch(() => payLines.value.filter((l) => l.confirmed).map((l) => l.key), (keys) => {
  const fresh = payLines.value.filter((l) => l.confirmed && !seenPaid.includes(l.key))
  seenPaid = keys
  if (!fresh.length || !payOpen.value) return
  paidFlash.value = { until: Date.now() + PAID_FLASH_MS, amount: lineAmt(fresh[fresh.length - 1]) }
  clearTimeout(paidFlashTimer)
  paidFlashTimer = setTimeout(() => { paidFlash.value = { until: 0, amount: 0 } }, PAID_FLASH_MS)
})
const displayState = computed(() => {
  const shopName = db.shop?.name || ''
  if (thanks.value.until > Date.now()) return { status: 'thanks', shopName, total: thanks.value.total, saved: thanks.value.saved }
  if (payOpen.value && paidFlash.value.until > Date.now()) return { status: 'paid', shopName, amount: paidFlash.value.amount, total: total.value, remaining: remaining.value }
  if (payOpen.value) {
    const bid = billerIdOf(db.shop?.billerId)
    const qrLine = payLines.value.find((l) => l.method === 'transfer' && l.qrRef && !l.confirmed && l.status !== 'cancelled')
    const qrAmount = qrLine ? lineAmt(qrLine) : 0
    return {
      status: 'paying', shopName, total: total.value, remaining: remaining.value,
      lines: displayLines.value, pricing: displayPricing.value,
      payLines: payLines.value.map((l) => ({ method: POS_METHODS[l.method], amount: lineAmt(l), done: !!l.confirmed })),
      qr: qrLine && bid && qrAmount > 0 ? { amount: qrAmount, payload: promptPayBillerPayload(bid, qrAmount, db.shop?.merchantCode || '', qrLine.qrRef) } : null,
    }
  }
  if (cart.value.length) return { status: 'shopping', shopName, total: total.value, lines: displayLines.value, pricing: displayPricing.value, suggest: displaySuggest.value }
  // ว่าง: ส่งสื่อโฆษณา (ถ้าเปิดใช้) ให้จอลูกค้าวนแสดง · มีสินค้าในตะกร้าเมื่อไรจอสลับเป็นรายการทันที
  return { status: 'idle', shopName, ads: adsForDisplay(db.storefront?.displayAds) }
})
watch(displayState, (st) => { if (native) pushDisplay(st) }, { deep: true })
const receipt = ref(null)
// QR ลุ้นโชคของใบเสร็จที่เพิ่งขาย (ผูกกับบิลนั้น ไม่ติดไปกับบิลอื่นตอนพิมพ์ซ้ำ)
const receiptLucky = ref(null)
const receiptLuckyUrl = computed(() => (receipt.value && receiptLucky.value?.orderId === receipt.value.id ? receiptLucky.value.url : ''))
const taxFor = ref(null) // บิลที่กำลังออกใบกำกับภาษีเต็มรูป
const taxable = (o) => can('taxInvoice') && o.status !== 'cancelled' && orderTotals(o).vat > 0
// สรุปยอดใบเสร็จ: ยอดสุทธิ รับแล้ว และส่วนต่าง (ค้าง > 0 · เกิน < 0) ใช้แสดงสถานะที่หัวใบเสร็จ
const receiptInfo = computed(() => {
  if (!receipt.value) return null
  const o = receipt.value
  const total = orderTotals(o).total
  const paid = Math.round((o.payments || []).filter((p) => p.status === 'confirmed').reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100
  return { total, paid, diff: Math.round((total - paid) * 100) / 100 }
})
const payErr = ref('')
let selling = false
async function confirmPay() {
  if (!canConfirm.value || selling) return
  selling = true
  try {
    await refreshLabels(['สินค้า', 'กะ POS']) // สต็อก/กะล่าสุดจากเซิร์ฟเวอร์ก่อนตัดขาย
    if (resumeOrder.value) return finishResume()
    await sellNow()
  } finally { selling = false }
}
// ---------- บิลค้าง (รับชำระบางส่วน) ----------
const toPosLine = (l) => ({ method: l.method, amount: lineAmt(l), received: l.method === 'cash' ? Number(l.received) : null, qrRef: l.qrRef || null, qrExpiresAt: l.qrExpiresAt || null, confirmed: !!l.confirmed, maneeId: l.maneeId || '', acceptedBy: l.acceptedBy || '' })
// เปิดบิลค้าง: ยอดที่รับแล้วแสดงเป็นรายการที่ล็อกไว้ · รับส่วนที่เหลือแล้วปิดบิล
function resumeBill(o) {
  if (editBill.value) return showToast('บันทึกหรือยกเลิกการแก้ไขบิลก่อน', 6000, 'error')
  payErr.value = ''
  resumeOrder.value = o
  payLines.value = o.payments.filter((p) => p.status === 'confirmed').map((p) => ({ key: newKey(), method: p.posMethod || 'cash', amount: String(p.amount), received: String(p.received ?? ''), qrRef: p.qrRef || '', qrExpiresAt: '', confirmed: true, locked: true, acceptedBy: p.qrAccept || 'staff', maneeId: p.maneeId || '' }))
  // รับส่วนที่เหลือของบิลค้าง: รายการที่รับไว้แล้วไม่แสดงฟลาชซ้ำ
  seenPaid = payLines.value.filter((l) => l.confirmed).map((l) => l.key)
  focusKey.value = ''
  payNow.value = Date.now()
  clearInterval(payTimer)
  payTimer = setInterval(() => {
    payNow.value = Date.now(); tickLines()
    if (++payTick % pollEvery() === 0) quietly(pollManee)
    if (payTick % LABEL_REFRESH_EVERY_S === 0 && waitingTransfer()) refreshLabelsNow()
  }, 1000)
  payOpen.value = true
  startTransferWatch()
}
function finishResume() {
  const r = finishPosBill(resumeOrder.value, payLines.value.filter((l) => !l.locked && lineAmt(l) > 0 && l.status !== 'cancelled').map(toPosLine))
  if (r.error) return (payErr.value = r.error)
  receipt.value = r.order
  closePay()
}
async function saveBillPartial() {
  if (selling) return
  selling = true
  try {
    if (resumeOrder.value) {
      const r = addPosPartial(resumeOrder.value, payLines.value.filter((l) => l.confirmed && !l.locked && lineAmt(l) > 0).map(toPosLine))
      if (r.error) return (payErr.value = r.error)
      closePay()
      return
    }
    await refreshLabels(['สินค้า', 'กะ POS'])
    await sellNow({ partial: true, lines: payLines.value.filter((l) => l.confirmed && lineAmt(l) > 0).map(toPosLine) })
  } finally { selling = false }
}
// ---------- ผูกยอดโอนที่รับแล้วเป็นบิลค้างทันที ----------
// รับชำระโอนแล้วและยังขาดยอด → บันทึกเป็นบิลค้างเลย (ยอดนี้ล็อกไว้ในบิล ปิดหน้าชำระหรือเพิ่มรายการก็ไม่หาย)
// หน้าชำระยังเปิดอยู่ รับส่วนที่เหลือต่อได้ทันที · ครบยอดแล้วให้กดยืนยันรับเงินตามปกติ
const binding = ref(false)
async function bindOnce(auto = false) {
  const bound = payLines.value.filter(isUnsaved) // เฉพาะรายการที่ยังไม่ได้ผูก (รายการที่รับเพิ่มระหว่างผูกจะรอรอบถัดไป)
  const lines = bound.map(toPosLine)
  if (resumeOrder.value) {
    const r = addPosPartial(resumeOrder.value, lines)
    if (r.error) { payErr.value = r.error; return false }
  } else {
    if (auto) await labelsForAutoBind() // ยืนยันอัตโนมัติ: ใช้ข้อมูลที่โหลดไว้ไม่เกิน 5 วินาทีได้ (ระหว่างรอโอนโหลดล่วงหน้าอยู่แล้ว)
    else await refreshLabels(LABEL_NAMES) // รับด้วยมือ: โหลดสต็อก/กะล่าสุดจากเซิร์ฟเวอร์ก่อนบันทึกบิลค้างเสมอ
    const o = await sellNow({ partial: true, keepOpen: true, lines })
    if (!o?.id) return false // ไม่สำเร็จ: sellNow ตั้งข้อความ payErr แล้ว
    resumeOrder.value = o
  }
  bound.forEach((l) => { l.locked = true }) // ผูกแล้ว: ล็อกไว้ ยกเลิกการรับชำระไม่ได้
  return true
}
// เรียกทุกครั้งที่มียอดรับแล้ว (กดเอง / ระบบรับเอง) · ผูกจนไม่มีรายการค้างผูก
// ผูกไม่สำเร็จ → หยุดและเก็บรายการไว้ ให้กดบันทึกบิลค้างไว้ลองใหม่ (ไม่วนลองซ้ำเอง)
async function bindPaid(auto = false) {
  if (binding.value || selling || !payOpen.value) return
  binding.value = true
  selling = true
  payErr.value = ''
  try {
    while (payOpen.value && needBind(payLines.value, remaining.value)) {
      if (!(await bindOnce(auto))) break
    }
  } catch (e) {
    payErr.value = `บันทึกบิลค้างไม่สำเร็จ: ${e.message || e}`
  } finally {
    binding.value = false
    selling = false
  }
}
// ระบบรับอัตโนมัติแล้ว: ผูกยอดที่ค้าง แล้วถ้ายอดครบบิลให้ปิดบิลเอง (เหมือนกดยืนยันรับเงิน)
// วิธีอื่นหรือรับเองยังต้องกดยืนยันรับเงิน · กันปิดซ้ำด้วย selling ใน confirmPay/bindPaid
async function autoBindAndFinish() {
  try {
    await bindPaid(true)
    if (payOpen.value && canConfirm.value) await confirmPay()
  } catch (e) {
    payErr.value = `ปิดบิลอัตโนมัติไม่สำเร็จ กดยืนยันรับเงินเองได้: ${e.message || e}`
  }
}
// ปิดหน้าชำระ: ถ้ายังมียอดรับแล้วที่ไม่ได้ผูก ห้ามปิด (กันยอดหาย)
function requestClose() {
  if (binding.value) return
  const g = closeGuard(payLines.value, remaining.value)
  if (g.block) { payErr.value = g.message; return }
  closePay()
}
// เงินสดที่รับไม่ครบยอด: กดผูกเป็นบิลค้างได้ (ยอดรับ ≥ ยอดชำระของรายการ) · ยกเลิกได้เฉพาะตอนยังไม่ผูก
function bindCash(l) {
  Object.assign(l, { confirmed: true, acceptedBy: 'staff' })
  bindPaid()
}
function cancelCash(l) {
  Object.assign(l, { confirmed: false, acceptedBy: '' })
}
// ---------- แก้รายการบิลค้าง (แอดมิน) ----------
// เปิดบิลค้างในหน้าขาย: ตะกร้าคือรายการเดิมของบิล · บันทึกแล้วคิดโปร/บันเดิ้ลรวมทั้งบิลใหม่ · ยอดที่รับไปแล้วไม่เปลี่ยน
function startEdit(o) {
  if (!can('editItems') || editBill.value || payOpen.value || resumeOrder.value) return
  if (o.status !== 'pos_pending' || !shift.value || o.shiftId !== shift.value.id) return showToast('แก้รายการได้เฉพาะบิลค้างในกะที่เปิดอยู่', 6000, 'error')
  payErr.value = ''
  editBill.value = o
  editDrop.value = []
  cart.value = cartOfBill(o.items, lineKey)
  member.value = (o.customerId && findCustomer(o.customerId)) || null
  memberChoice.value = member.value ? 'yes' : 'none'
  couponIds.value = []
  discount.value = ''
  cartOpen.value = false
  tab.value = 'sell'
}
function exitEdit() {
  editBill.value = null
  editDrop.value = []
  cart.value = []
  member.value = null
  memberChoice.value = null
  couponIds.value = []
  discount.value = ''
}
function toggleDrop(id) {
  editDrop.value = editDrop.value.includes(id) ? editDrop.value.filter((x) => x !== id) : [...editDrop.value, id]
}
async function saveEdit() {
  if (!editBill.value || selling) return
  selling = true
  try {
    await refreshLabels(['สินค้า', 'กะ POS']) // สต็อก/ราคา/กะล่าสุดจากเซิร์ฟเวอร์ก่อนแก้บิล
    const target = db.orders.find((o) => o.id === editBill.value.id) || editBill.value
    const addIds = couponIds.value.filter((id) => !target.couponsUsed.some((c) => c.couponId === id))
    const claim = addIds.length ? await claimPosCoupons(addIds, { orderId: target.id, amounts: quotedAmounts() }) : { ok: true, claimed: [] }
    if (claim.error) return showToast(claim.error, 8000, 'error')
    const r = editPosPending(target, cart.value, { dropCouponIds: editDrop.value, addCouponIds: addIds })
    if (r.error) { await releaseCoupons(claim.claimed, target.id); return showToast(r.error, 10000, 'error') }
    showToast(`บันทึกการแก้ไขบิล ${r.order.code} แล้ว · ยอดรวม ${money(orderTotals(r.order).total)}`, 8000)
    exitEdit()
  } finally { selling = false }
}
// ยอดที่คิดจริงของคูปองในบิลตอนนี้ { couponId: ยอด } ใช้จองยอดคูปองคืนเงินให้ตรงกับตอนขาย
const quotedAmounts = () => Object.fromEntries(pickedCoupons.value.map((x) => [x.couponId, x.amount]))
async function sellNow(opts = {}) {
  payErr.value = member.value ? posCouponProblem({ customerId: member.value.id, couponIds: couponIds.value }) : ''
  if (payErr.value) { couponIds.value = couponIds.value.filter((id) => coupons.value.some((c) => c.id === id)); return }
  // จองคูปองกับเซิร์ฟเวอร์ก่อนขาย (อะตอมิก) ด้วยรหัสบิลที่จะเกิดจริง · ขายไม่สำเร็จ = คืนคูปองที่จองไว้
  const billId = reserveBillId()
  const claim = couponIds.value.length ? await claimPosCoupons(couponIds.value, { orderId: billId, amounts: quotedAmounts() }) : { ok: true, claimed: [] }
  if (claim.error) return (payErr.value = claim.error)
  const o = posSale({
    cart: cart.value, customerId: member.value?.id || null, couponIds: couponIds.value,
    discount: can('adjustPrice') ? Number(discount.value) || 0 : 0,
    lines: opts.lines || activeLines.value.map(toPosLine), partial: !!opts.partial, billId,
  })
  if (!o) { await releaseCoupons(claim.claimed, billId); return (payErr.value = 'ขายไม่สำเร็จ ตรวจกะ/ตะกร้า/คูปองอีกครั้ง') }
  // คูปองที่จองไว้ผูกกับบิลจริงแล้ว (รหัสบิลเดียวกัน) และซิงก์แถวคูปองตามปกติ
  if (!opts.keepOpen) closePay() // ผูกยอดโอนเป็นบิลค้าง: หน้าชำระเปิดอยู่ต่อ
  cartOpen.value = false
  if (opts.keepOpen) showToast(`บันทึกยอดที่รับแล้วเป็นบิลค้าง ${o.code} · รับส่วนที่เหลือต่อในหน้านี้`, 8000)
  else if (opts.partial) showToast(`บันทึกบิลค้าง ${o.code} แล้ว · รับชำระส่วนที่เหลือได้ที่แท็บบิล`, 8000)
  else receipt.value = o
  // ลุ้นโชคท้ายบิล: ออก QR เฉพาะบิลที่ขายเสร็จ (ไม่ใช่บิลค้าง) และอยู่ในช่วงเวลาที่เปิดลุ้น
  const lucky = opts.partial ? null : await issueLuckyToken(o)
  receiptLucky.value = lucky ? { orderId: o.id, url: lucky.url } : null
  if (native && !opts.partial) {
    const oT = orderTotals(o)
    thanks.value = { until: Date.now() + 8000, total: oT.total, saved: (oT.discountLines || []).reduce((sum, l) => sum + (Number(l.amount) || 0), 0) }
    clearTimeout(thanksTimer)
    thanksTimer = setTimeout(() => { thanks.value = { until: 0, total: 0, saved: 0 } }, 8000)
    if (getDeviceConfig().printer?.address) printOrderReceipt(o, { luckyUrl: lucky?.url || '' }).catch((e) => showToast(`พิมพ์ใบเสร็จไม่สำเร็จ: ${e.message || e}`))
  }
  cart.value = []
  member.value = null
  memberChoice.value = null
  couponIds.value = []
  discount.value = ''
  // ขายแล้ว (ใบเสร็จแสดงได้) แต่ต้องแจ้งตามจริงถ้ายังบันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ
  waitSaved().then((r) => { if (!r.ok) showToast(`บิล ${o.code} ยังบันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (${r.error}) · ระบบจะลองส่งซ้ำเอง ดูสถานะที่แถบด้านบน`, 12000, 'error') })
  return o
}
const print = () => {
  if (!native) return window.print()
  if (!receipt.value) return
  printOrderReceipt(receipt.value, { luckyUrl: receiptLuckyUrl.value }).catch((e) => showToast(`พิมพ์ไม่สำเร็จ: ${e.message || e}`))
}

// ---------- บิลของกะ ----------
const bills = computed(() => (shift.value ? shiftBills(shift.value.id) : []))
// ยกเลิกบิล: เลือกคืนเป็น เงินสด / ธนาคาร / คะแนนสะสม (แบ่งได้) · ค่าตั้งต้น = คืนเต็มตามช่องทางที่จ่ายมา
const voidFor = ref(null)
const vd = reactive({ reason: 'ยกเลิกบิล', refunds: [], note: '', error: '' })
const voidPaid = computed(() => (voidFor.value ? orderTotals(voidFor.value).paidNet : 0))
const refundFor = ref(null) // คืนเงินบางส่วนโดยไม่ยกเลิกบิล
// แลกสินค้า: คืนสินค้าเดิมในบิลนี้ + ขายสินค้าใหม่เป็นบิลใหม่ที่ผูกกัน (ดูหน้าต่าง ExchangeModal)
const exchangeFor = ref(null)
const canExchange = (o) => can('pos') && can('posVoid') && o.status !== 'cancelled' && o.status !== 'pos_pending'
  && (o.items || []).some((i) => i.kind === 'retail' && i.qty - returnedQtyOf(o, i.id) > 0)
function onExchanged(newOrder) {
  receipt.value = newOrder
  showToast(`แลกสินค้าแล้ว · บิลใหม่ ${newOrder.code}`, 8000)
}
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

  <div v-else class="mx-auto max-w-page px-4 pt-3 lg:px-8" :class="tab === 'sell' && shift ? 'flex h-full flex-col overflow-hidden' : 'h-full overflow-y-auto'">
    <!-- หัว -->
    <div class="head-safe mb-3 flex shrink-0 flex-wrap items-center gap-2">
      <RouterLink to="/admin/orders" class="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 md:hidden" aria-label="กลับ"><AppIcon name="back" :size="20" /></RouterLink>
      <h1 class="page-title">POS หน้าร้าน</h1>
      <span v-if="shift" class="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 max-sm:hidden">กะเปิด {{ timeOnly(shift.openedAt) }} · {{ ROLES[shift.openedBy] }}</span>
      <button v-if="native" type="button" class="btn-soft ml-auto h-9 px-3 text-sm" @click="deviceOpen = true">เครื่องพิมพ์/จอ</button>
      <button v-if="shift && can('useLoyalty')" type="button" class="btn-soft ml-2 h-10 px-3 text-sm max-sm:ml-auto max-sm:w-10 max-sm:px-0" aria-label="มอบของรางวัล" @click="openRedeem"><AppIcon name="star" :size="16" /> <span class="max-sm:sr-only">มอบของรางวัล</span></button>
      <template v-if="shift && tab === 'sell' && can('useLoyalty') && !needMemberChoice">
        <button type="button" class="btn-soft ml-2 h-9 max-w-[12rem] truncate px-3 text-sm" :aria-label="member ? 'เปลี่ยนสมาชิก' : 'เลือกสมาชิก'" @click="memberSearchOpen = true">{{ member ? `สมาชิก: ${member.name}` : '+ สมาชิก' }}</button>
        <button v-if="member" type="button" class="btn-soft h-9 w-9 shrink-0 text-sm" aria-label="เอาสมาชิกออก" @click="clearMemberPick">✕</button>
      </template>
      <div v-if="shift" class="grid grid-cols-4 gap-1 seg-grid max-sm:order-last max-sm:w-full" :class="can('useLoyalty') ? '' : 'ml-auto'">
        <button v-for="t in [{ v: 'sell', l: 'ขาย' }, { v: 'bills', l: `บิล ${bills.length}` }, { v: 'queue', l: `คิว ${prepList.length}` }, { v: 'shift', l: 'สรุปกะ' }]" :key="t.v" type="button" class="h-9 rounded-lg px-2 text-sm font-medium whitespace-nowrap sm:px-3" :class="tab === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="tab = t.v">{{ t.l }}</button>
      </div>
    </div>

    <!-- เปิดกะ -->
    <section v-if="!shift" class="card mx-auto max-w-md">
      <div class="card-title"><AppIcon name="pos" class="text-brand-600" /> เปิดกะก่อนขาย</div>
      <label class="label">เงินทอนตั้งต้นในลิ้นชัก (บาท)</label>
      <MoneyInput v-model="float" class="input text-lg font-semibold" placeholder="0" />
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
    <div v-else-if="tab === 'sell'" class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]" :class="editBill ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'">
      <div v-if="editBill" class="col-span-full flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        <span>กำลังแก้รายการบิลค้าง <b>{{ orderNo(editBill.code) }}</b> · รับไปแล้ว {{ money(orderTotals(editBill).paidNet) }} · ยอดรวมหลังแก้ต้องไม่ต่ำกว่านี้</span>
        <span v-if="editBill.couponsUsed?.length" class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs text-amber-800">คูปองในบิล (แตะเพื่อเอาออก):</span>
          <button v-for="c in editBill.couponsUsed" :key="c.couponId" type="button" class="chip h-auto py-1" :class="editDrop.includes(c.couponId) ? 'chip-off line-through' : 'chip-on'" :aria-pressed="editDrop.includes(c.couponId)" @click="toggleDrop(c.couponId)">{{ c.name }} −{{ money(c.amount) }}</button>
        </span>
      </div>
      <section class="relative flex min-h-0 min-w-0 flex-col">
        <div v-if="needMemberChoice" class="absolute inset-y-0 -inset-x-4 z-20 flex flex-col gap-3 bg-cream p-4 md:inset-x-0 md:rounded-3xl">
          <div class="flex gap-2">
            <input ref="gateInputEl" :value="memberQ" @input="(e) => { e.target.value = e.target.value.replace(/[^0-9a-z]/gi, ''); memberQ = e.target.value }" type="text" inputmode="numeric" data-numpad="int" class="input h-14 min-w-0 flex-1 text-lg" placeholder="กรอกเบอร์สมาชิก" aria-label="เบอร์สมาชิก" @keydown.enter.prevent="onMemberScan" />
            <button type="button" class="btn-outline h-14 shrink-0 px-5 text-base" @click="chooseNoMember">ไม่มี</button>
          </div>
          <p v-if="scanMsg" class="text-xs text-rose-700" role="alert">{{ scanMsg }}</p>
          <p v-else-if="!memberQ" class="text-sm text-stone-600">เริ่มขาย: กรอกเบอร์สมาชิก 10 หลัก หรือสแกนบาร์โค้ดสมาชิก · ลูกค้าทั่วไปกด "ไม่มี"</p>
          <div v-if="memberMatches.length" class="space-y-2">
            <div v-for="c in memberMatches" :key="c.id" class="flex w-full items-stretch gap-2 rounded-xl border border-stone-200 bg-white text-sm hover:border-brand-300">
              <button v-for="r in [redeemInfo(c)]" :key="'gp' + c.id" type="button" class="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 text-left" @click="pickMember(c)">
                <span class="flex items-baseline justify-between gap-2">
                  <span class="truncate text-base font-semibold text-stone-900">{{ c.name }}</span>
                  <span class="shrink-0 text-stone-500">{{ c.phone ? formatPhone(c.phone) : '' }}</span>
                </span>
                <span class="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span class="font-semibold tabular-nums text-stone-900">{{ r.pts.toLocaleString() }} แต้ม</span>
                  <span v-if="r.value > 0" class="text-emerald-800">ลดได้ <b class="tabular-nums">{{ money(r.value) }}</b></span>
                  <span v-if="r.soon" class="text-amber-800">หมดอายุ {{ r.soon.points.toLocaleString() }} แต้ม · {{ dateOnly(r.soon.date) }}</span>
                  <span v-if="r.coupons.length" class="text-stone-600">คูปอง {{ r.coupons.length }} ใบ</span>
                </span>
              </button>
            </div>
          </div>
          <p v-else-if="memberQ.length >= 10" class="text-sm text-stone-500">ไม่พบสมาชิกเบอร์นี้</p>
        </div>
        <div class="mb-3 flex shrink-0 gap-2">
          <label class="relative min-w-0 flex-1">
            <span class="sr-only">ค้นหาสินค้า</span>
            <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
            <input v-model="q" type="search" class="input bg-white pl-10" placeholder="ค้นหาสินค้า" />
          </label>
        </div>
        <div class="-mx-4 mb-3 flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
          <button type="button" class="chip" :class="!cat ? 'chip-on' : 'chip-off'" @click="cat = ''">ทั้งหมด</button>
          <button v-for="c in categories" :key="c" type="button" class="chip whitespace-nowrap" :class="cat === c ? 'chip-on' : 'chip-off'" @click="cat = c">{{ c }}</button>
          <button type="button" class="chip ml-auto whitespace-nowrap" :class="sortBest ? 'chip-on' : 'chip-off'" :aria-pressed="sortBest" @click="sortBest = !sortBest"><AppIcon name="star" :size="13" /> เรียงขายดี</button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-24 lg:pb-4">
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <div v-for="x in shown" :key="x.kind + x.id" class="relative h-full">
          <button
            type="button"
            class="relative flex h-full min-h-24 w-full flex-col justify-between rounded-3xl border-2 bg-white p-3 text-left shadow-sm transition active:scale-[0.98] disabled:opacity-50"
            :class="inCart(x) ? 'border-brand-500 bg-brand-50/60' : 'border-transparent hover:border-brand-300'"
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
        </div>
      </section>

      <!-- ตะกร้า (คอม = แผงขวา · มือถือ = bottom sheet) -->
      <div v-if="cartOpen" class="fixed inset-0 z-40 bg-stone-900/40 lg:hidden" @click="cartOpen = false" />
      <aside
        class="z-50 flex-col rounded-2xl border border-stone-200 bg-white shadow-2xl lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:shadow-none"
        :class="cartOpen ? 'fixed inset-x-4 top-1/2 flex max-h-[80dvh] -translate-y-1/2 sm:mx-auto sm:w-full sm:max-w-md' : 'hidden'"
      >
        <div class="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <span class="font-semibold text-stone-900">ตะกร้า <span class="text-stone-400">{{ count }}</span></span>
          <span class="flex items-center gap-3"><button v-if="cart.length" type="button" class="text-sm text-rose-700 underline" aria-label="ล้างตะกร้า" @click="clearCart">ล้างตะกร้า</button><button type="button" class="text-sm text-stone-500 lg:hidden" @click="cartOpen = false">ปิด</button></span>
        </div>
        <div class="border-b border-stone-100 p-4">
          <div class="mb-3 flex items-start justify-between gap-2">
            <span class="text-sm text-stone-500">ยอดชำระ<span v-if="preview.vatMode" class="block text-xs text-stone-400">{{ preview.vatMode === 'exclusive' ? `รวม VAT ${preview.vatRate}% บวกเพิ่ม ${money(preview.vat)}` : `รวม VAT ${preview.vatRate}% แล้ว ${money(preview.vat)}` }}</span></span>
            <DiscountDetail :full="preview.fullAll" :final="total" :lines="preview.discountLines" size="lg" />
          </div>
          <template v-if="editBill">
            <button type="button" class="btn-primary h-12 w-full text-base" :disabled="!cart.length" @click="saveEdit">บันทึกการแก้ไขบิล {{ orderNo(editBill.code) }}</button>
            <button type="button" class="btn-outline mt-2 h-11 w-full" @click="exitEdit">ยกเลิกการแก้ไข</button>
          </template>
          <button v-else type="button" class="h-12 w-full text-base" :class="cart.length ? 'btn-primary' : 'btn bg-stone-200 text-stone-500 opacity-100!'" :disabled="!cart.length" @click="openPay">{{ cart.length ? 'ชำระเงิน' : 'เพิ่มสินค้าก่อนชำระเงิน' }}</button>
        </div>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p v-if="!cart.length" class="py-6 text-center text-sm text-stone-400">แตะสินค้าเพื่อเพิ่ม</p>
          <ul class="space-y-2">
            <li v-for="l in cart" :key="lineKey(l)" class="flex items-center gap-2 rounded-2xl bg-white p-2.5 ring-1 ring-stone-200" @touchstart.passive="swipeStart" @touchend.passive="swipeEnd($event, l)">
              <button type="button" class="min-w-0 flex-1 text-left" :disabled="!groupsOf(itemOf(l) || {}).length" @click="openMods(itemOf(l), l)">
                <span class="block truncate text-base font-semibold text-stone-900">{{ itemOf(l)?.name }}</span>
                <span v-if="l.mods?.length" class="block truncate text-xs font-medium text-brand-700">{{ modsText(modsOf(l.mods)) }}</span>
                <span class="block text-sm font-semibold tabular-nums text-stone-700">{{ money(linePrice(l)) }}</span>
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
          <ul v-if="promoInfo.hints.length" class="space-y-1.5" aria-label="โปรที่ใกล้ถึง">
            <li v-for="h in promoInfo.hints" :key="h.text" class="rounded-xl border-l-4 border-sky-500 bg-sky-100 px-3 py-2 text-sm font-medium text-sky-950">💡 {{ h.text }}</li>
          </ul>

          <!-- แนะนำขายต่อ -->
          <div v-if="bundleSug.length || pairSug.length" class="space-y-2" aria-label="แนะนำขายต่อ">
            <div class="text-xs font-bold uppercase tracking-wide text-amber-800">แนะนำขายต่อ</div>
            <div v-for="s in bundleSug" :key="s.bundle.id" class="rounded-2xl border-2 border-amber-400 bg-amber-100 p-3 text-sm">
              <div class="font-semibold text-stone-900">ชุด {{ s.bundle.name }} · {{ money(s.bundle.price) }} <s class="text-xs font-normal text-stone-400">ราคาเต็ม {{ money(s.setRegular) }}</s></div>
              <div class="text-xs text-stone-600">เพิ่ม {{ s.missing.map((m) => `${m.name} ×${m.qty}`).join(', ') }} ได้ราคาชุด · ประหยัด <b class="text-rose-700">{{ money(s.saving) }}</b></div>
              <button type="button" class="btn-soft mt-1.5 h-8 px-3 text-xs" @click="addMissing(s)"><AppIcon name="plus" :size="14" /> เพิ่มให้ครบชุด</button>
            </div>
            <div v-if="pairSug.length">
              <div class="mb-1.5 text-xs font-bold text-amber-900">ลูกค้ามักซื้อคู่กัน</div>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="r in pairSug" :key="r.retailId" type="button" class="chip chip-off max-w-full" :aria-label="`เพิ่ม ${r.item.name}`" @click="add(r.item)"><AppIcon name="plus" :size="13" /> <span class="truncate">{{ r.item.name }}</span> <span class="text-stone-400">{{ money(r.item.price) }}</span></button>
              </div>
            </div>
          </div>

        </div>
      </aside>

      <!-- แถบล่างมือถือ -->
      <div v-if="undo.snap" class="fixed inset-x-3 bottom-28 z-50 flex items-center justify-between gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-6 lg:left-auto lg:w-80" role="status"><span class="min-w-0 truncate">{{ undo.text }}</span><button type="button" class="shrink-0 font-semibold text-brand-200 underline" @click="undoRemove">เลิกทำ</button></div>
      <div v-if="!cartOpen" class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden">
        <div v-if="cart.length" class="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label="รายการในตะกร้า (แตะ ✕ เพื่อลบ)">
          <span v-for="l in cart" :key="'q' + lineKey(l)" class="flex shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-white py-1 pr-1 pl-3 text-xs text-stone-700"><span class="max-w-32 truncate">{{ lineName(l) }} ×{{ l.qty }}</span><button type="button" class="flex h-7 w-7 items-center justify-center rounded-full text-rose-700 hover:bg-rose-50" :aria-label="`ลบ ${itemOf(l)?.name} ออกจากตะกร้า`" @click="removeLine(l)">✕</button></span>
        </div>
        <button type="button" class="h-12 w-full justify-between px-5 text-base" :class="cart.length ? 'btn-primary' : 'btn-soft'" @click="cartOpen = true">
          <span>ตะกร้า {{ count }} ชิ้น</span><span>{{ money(total) }}</span>
        </button>
      </div>
    </div>

    <!-- บิลของกะ -->
    <section v-else-if="tab === 'bills'" class="card">
      <div class="mb-2 flex justify-end"><RouterLink to="/admin/pos/bills" class="text-sm font-medium text-brand-700 underline">ดูบิลที่ปิดแล้วทุกกะ →</RouterLink></div>
      <p v-if="!bills.length" class="py-8 text-center text-sm text-stone-500">ยังไม่มีบิลในกะนี้</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="o in bills" :key="o.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" :class="o.status === 'cancelled' ? 'opacity-60' : ''">
          <button type="button" class="min-w-0 flex-1 basis-40 text-left" @click="receipt = o">
            <span class="block font-medium text-stone-900">{{ orderNo(o.code) }} <span class="text-xs font-normal text-stone-500">{{ timeOnly(o.createdAt) }}</span></span>
            <span class="block truncate text-xs text-stone-500">{{ o.items.map((i) => `${i.name}${i.mods?.length ? ` (${modsText(i.mods)})` : ''} ×${i.qty}`).join(', ') }}<template v-if="o.customerId"> · {{ findCustomer(o.customerId)?.name }}</template></span>
          </button>
          <span class="shrink-0 text-right text-sm">
            <b class="block text-stone-900">{{ money(orderTotals(o).total) }}</b>
            <span class="text-xs text-stone-500">{{ o.status === 'cancelled' ? 'ยกเลิกแล้ว' : o.status === 'pos_pending' ? `รอชำระ · คงเหลือ ${money(orderTotals(o).balance)}` : o.payments[0]?.method }}</span>
          </span>
          <button v-if="o.status === 'pos_pending' && can('pos')" type="button" class="btn-primary h-9 shrink-0 px-2.5 text-xs" @click="resumeBill(o)">รับชำระต่อ</button>
          <button v-if="o.status === 'pos_pending' && can('editItems')" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="startEdit(o)">แก้รายการ</button>
          <button v-if="can('posVoid') && o.status !== 'cancelled' && (orderTotals(o).paidNet > 0 || (o.returns || []).some((r) => !r.cancelled))" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" aria-label="คืนเงินบางส่วน" @click="refundFor = o">คืนเงิน</button>
          <button v-if="canExchange(o)" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="exchangeFor = o">แลกสินค้า</button>
          <button v-if="can('posVoid') && o.status !== 'cancelled'" type="button" class="btn-danger h-9 shrink-0 px-2.5" aria-label="ยกเลิกบิล" @click="openVoid(o)"><AppIcon name="x" :size="16" /></button>
          <button v-if="can('changeBuyer') && o.status !== 'cancelled'" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="buyerFor = o">เปลี่ยนผู้ซื้อ</button>
          <button v-if="taxable(o)" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" aria-label="ใบกำกับภาษี" @click="taxFor = o">ใบกำกับภาษี</button>
        </li>
      </ul>
    </section>

    <!-- ปิดกะ -->
    <section v-if="tab === 'queue' && shift" class="mx-auto w-full max-w-2xl">
      <p v-if="!db.shop.prepCategories?.length" class="card text-sm text-stone-500">ยังไม่ได้ตั้งหมวดที่ต้องเตรียม (ตั้งที่ ตั้งค่าร้าน)</p>
      <p v-else-if="!prepList.length" class="card py-10 text-center text-stone-500">ไม่มีรายการรอเตรียม</p>
      <ul v-else class="space-y-2">
        <li v-for="p in prepList" :key="p.orderId + p.itemId" class="card flex items-center gap-3 p-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-base font-semibold text-stone-900">{{ p.name }} × {{ p.qty }}</div>
            <div v-if="p.mods?.length" class="truncate text-xs font-medium text-brand-700">{{ modsText(p.mods) }}</div>
            <ul v-if="p.recipe?.length" class="mt-1 space-y-0.5 rounded-lg bg-stone-50 px-2.5 py-1.5 text-sm text-stone-700" aria-label="สูตรเตรียม">
              <li v-for="(x, i) in p.recipe" :key="i" class="flex justify-between gap-2"><span class="truncate">{{ x.name }}</span><span class="shrink-0 tabular-nums">{{ x.amount }} {{ x.unit }}<span v-if="x.per === 'pound'" class="text-xs text-stone-400"> ต่อปอนด์</span></span></li>
            </ul>
            <div class="text-xs text-stone-500">{{ orderNo(p.orderCode) }} · {{ timeOnly(p.at) }}</div>
          </div>
          <button type="button" class="btn-primary h-12 shrink-0 px-5" @click="prepDone(p)">เสร็จ</button>
        </li>
      </ul>
    </section>
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
      <MoneyInput v-model="counted" class="input text-lg font-semibold" placeholder="0" />
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
          <RefundEditor v-model="vd.refunds" :paid="voidPaid" :can-credit="!!voidFor.customerId && !!findCustomer(voidFor.customerId) && !findCustomer(voidFor.customerId).deleted" :default-method="voidDefault" />
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
    <ExchangeModal v-if="exchangeFor" :order="exchangeFor" @close="exchangeFor = null" @done="onExchanged" />
    <ChangeBuyerModal v-if="buyerFor" :order="buyerFor" @close="buyerFor = null" />


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

    <DeviceSettings v-if="deviceOpen" @close="deviceOpen = false" />
    <!-- ชำระเงิน · เต็มจอ ไม่เลื่อน: ซ้าย = สรุปยอด สมาชิก คูปอง และรายการที่รับแล้ว · ขวา = เลือกวิธี และทำรายการนั้น -->
    <!-- สแกนคูปองของลูกค้าในหน้าชำระเงิน: ไดอะล็อกแยกจากปุ่ม (เหมือนค้นหาสมาชิก) · เครื่องสแกน USB ยิงรหัสแล้วกด Enter -->
    <AppModal v-if="cpScanOpen" top title="สแกนคูปองของลูกค้า" @close="cpScanOpen = false; cpScanQ = ''; cpScanMsg = ''">
      <div class="space-y-3">
        <input ref="cpScanInputEl" v-model="cpScanQ" type="text" inputmode="none" autocomplete="off" class="input h-14 w-full text-lg" placeholder="ยิงบาร์โค้ดจากโทรศัพท์ของลูกค้า" aria-label="สแกนบาร์โค้ดคูปอง" @keydown.enter.prevent="onCouponScan" />
        <p v-if="cpScanMsg" class="text-sm text-rose-700" role="alert">{{ cpScanMsg }}</p>
        <p v-else class="text-sm text-stone-600">ให้ลูกค้าเปิดบาร์โค้ดคูปองในหน้าสมาชิกของเขา (ต้องกด "ใช้ที่ร้านตอนนี้" ก่อน)</p>
      </div>
    </AppModal>
    <!-- ค้นหาสมาชิก: ไดอะล็อกแยก เปิดจากปุ่ม "สมาชิก" · พิมพ์เบอร์หรือสแกนแล้วกดเลือกรายการ -->
    <AppModal v-if="memberSearchOpen" top title="ค้นหาสมาชิก" @close="memberSearchOpen = false; memberQ = ''">
      <div class="space-y-3">
              <div class="flex gap-2">
          <input ref="memberInputEl" :value="memberQ" @input="(e) => { e.target.value = e.target.value.replace(/[^0-9a-z]/gi, ''); memberQ = e.target.value }" type="text" inputmode="numeric" data-numpad="int" class="input h-11 min-w-0 flex-1" placeholder="เบอร์ / สแกนบาร์โค้ด" aria-label="ค้นหาสมาชิกสะสมแต้ม" @keydown.enter.prevent="onMemberScan" />
          <button v-if="memberQ" type="button" class="btn-outline h-11 shrink-0 px-4" @click="memberQ = ''; memberInputEl?.focus()">ล้าง</button>
        </div>
        <p v-if="scanMsg" class="text-xs text-rose-700" role="alert">{{ scanMsg }}</p>
        <div v-if="memberMatches.length" class="w-full space-y-2 max-md:basis-full">
        <div v-for="c in memberMatches" :key="c.id" class="flex w-full items-stretch gap-2 rounded-xl border border-stone-200 text-sm hover:border-brand-300">
          <button type="button" class="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left" @click="pickMember(c)">
            <span class="truncate text-base font-semibold text-stone-900">{{ c.name }}</span>
            <span class="text-stone-500">{{ c.phone ? formatPhone(c.phone) : '' }}</span>
          </button>
          <button type="button" class="shrink-0 border-l border-stone-200 px-4 text-sm font-semibold text-brand-700" :aria-label="'ดูข้อมูลของ ' + c.name" @click="memberInfoOf = c">ข้อมูล ›</button>
        </div>
        </div>
      </div>
    </AppModal>
    <!-- ข้อมูลสมาชิก: ไดอะล็อกแยก เปิดจากผลค้นหา · กดเลือกสมาชิกจากในไดอะล็อก -->
    <AppModal v-if="memberInfoOf" title="ข้อมูลสมาชิก" @close="memberInfoOf = null">
      <template v-for="r in [redeemInfo(memberInfoOf)]" :key="'mi' + memberInfoOf.id">
        <div class="space-y-3 text-sm">
          <div>
            <div class="text-lg font-semibold text-stone-900">{{ memberInfoOf.name }}</div>
            <div class="text-stone-500">{{ memberInfoOf.phone ? formatPhone(memberInfoOf.phone) : '' }}</div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-2xl bg-stone-900 px-4 py-3 text-white">
              <div class="text-xs text-stone-300">คะแนนที่มี</div>
              <div class="text-3xl font-bold tabular-nums">{{ r.pts.toLocaleString() }}</div>
              <div v-if="r.value > 0" class="mt-1 text-xs text-stone-300">ใช้เป็นส่วนลดได้ <b class="tabular-nums text-white">{{ money(r.value) }}</b></div>
            </div>
            <div class="rounded-2xl px-4 py-3" :class="r.soon ? 'bg-amber-100 text-amber-950' : 'bg-stone-100 text-stone-600'">
              <div class="text-xs" :class="r.soon ? 'text-amber-900' : 'text-stone-500'">จะหมดอายุ</div>
              <div class="text-3xl font-bold tabular-nums">{{ r.soon ? r.soon.points.toLocaleString() : '0' }}</div>
              <div class="mt-1 text-xs">{{ r.soon ? `วันที่ ${dateOnly(r.soon.date)}` : 'ไม่มีคะแนนใกล้หมดอายุ' }}</div>
            </div>
          </div>
          <div class="rounded-2xl bg-white px-4 py-3 ring-1 ring-stone-200">
            <div class="text-xs text-stone-500">แลกได้ตอนนี้</div>
            <div class="mb-3 mt-1 space-y-1">
              <div v-for="x in r.rewards.filter((x) => x.ok)" :key="'ok' + x.id" class="flex items-center justify-between gap-2 font-semibold text-emerald-800">
                <span>{{ x.name }}</span>
                <span class="text-xs">แลกได้</span>
              </div>
              <div v-if="!r.rewards.some((x) => x.ok)" class="font-semibold text-stone-700">ยังไม่มี</div>
            </div>
            <div v-if="r.rewards.some((x) => !x.ok)" class="text-xs text-stone-500">อีกนิดจะแลกได้</div>
            <div v-for="x in r.rewards.filter((x) => !x.ok)" :key="'no' + x.id" class="mt-1 flex items-center justify-between gap-2 text-stone-700">
              <span>{{ x.name }}</span>
              <span class="shrink-0 text-xs tabular-nums text-stone-500">ขาดอีก {{ x.need }} แต้ม</span>
            </div>
          </div>
          <div class="rounded-2xl bg-white px-4 py-3 ring-1 ring-stone-200">
            <div class="text-xs text-stone-500">คูปองที่มี</div>
            <div class="font-semibold text-stone-800">{{ r.coupons.length ? r.coupons.join(' · ') : 'ไม่มี' }}</div>
          </div>
        </div>
      </template>
      <template #footer>
        <button type="button" class="btn-outline h-12 flex-1" @click="memberInfoOf = null">ปิด</button>
        <button type="button" class="btn-primary h-12 flex-1" @click="pickMember(memberInfoOf); memberInfoOf = null">เลือกสมาชิกนี้</button>
      </template>
    </AppModal>
    <AppModal v-if="payOpen" title="ชำระเงิน" big fit @close="requestClose">
      <div class="flex h-full min-h-0 flex-col gap-3">
      <div class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:grid-rows-1">
        <!-- ซ้าย: สมาชิก คูปอง รายการ -->
        <aside class="flex min-h-0 flex-col gap-3 overflow-y-auto p-0.5 max-md:max-h-[40dvh]" aria-label="ข้อมูลลูกค้าและรายการชำระ">
          <!-- สรุป: ยอดชำระ · รับแล้ว · คงค้าง/เกิน -->
          <div class="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200 max-md:p-3" aria-label="สรุปการชำระ">
            <div class="text-sm font-medium text-stone-700">ยอดชำระ</div>
            <div class="text-3xl font-bold tabular-nums text-stone-900 max-md:text-2xl">{{ money(total) }}</div>
            <dl class="mt-3 grid grid-cols-2 gap-2 text-sm max-md:mt-2 max-md:gap-1.5">
              <div class="rounded-2xl bg-stone-200 px-3 py-2"><dt class="text-stone-700">รับแล้ว</dt><dd class="text-lg font-semibold tabular-nums text-stone-950">{{ money(receivedSum) }}</dd></div>
              <div class="rounded-2xl px-3 py-2" :class="total - receivedSum < 0 ? 'bg-rose-200 text-rose-950 ring-1 ring-rose-400' : total - receivedSum > 0 ? 'bg-amber-200 text-amber-950 ring-1 ring-amber-400' : 'bg-emerald-200 text-emerald-950 ring-1 ring-emerald-500'">
                <dt class="opacity-80">{{ total - receivedSum < 0 ? 'เกิน' : 'คงค้าง' }}</dt><dd class="text-lg font-semibold tabular-nums">{{ money(Math.abs(total - receivedSum)) }}</dd>
              </div>
            </dl>
          </div>

          <!-- สมาชิกสะสมแต้ม: เปลี่ยนได้จนกว่าจะสร้าง QR หรือรับชำระรายการแรก -->
          <div v-if="!member && !memberLocked" class="space-y-1.5 rounded-2xl bg-white p-3 ring-1 ring-stone-200 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-2 max-md:space-y-0 max-md:p-2" aria-label="เบอร์สะสมแต้ม">
            <div class="text-sm font-semibold text-stone-800 max-md:shrink-0">เบอร์สะสมแต้ม <span class="font-normal text-stone-400">(ไม่บังคับ)</span></div>
            <button type="button" class="btn-outline h-11 max-md:flex-1" @click="memberSearchOpen = true">สมาชิก · กดเพื่อค้นหา</button>
          </div>
          <div v-else-if="member" class="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-800" aria-hidden="true"><AppIcon name="user" :size="18" /></span>
            <div class="min-w-0 flex-1"><div class="truncate font-semibold text-stone-800">{{ member.name }}</div><div class="text-xs text-stone-500">{{ member.phone ? formatPhone(member.phone) : '' }}</div></div>
            <button v-if="!memberLocked" type="button" class="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-stone-500 underline" @click="member = null; couponIds = []">เปลี่ยน</button>
            <div class="grid basis-full grid-cols-2 gap-2 text-sm" aria-label="คะแนนสมาชิก">
              <div class="rounded-xl bg-stone-50 px-3 py-2"><div class="text-xs text-stone-500">คะแนนที่มี</div><div class="font-semibold tabular-nums text-stone-900">{{ memberPts.toLocaleString() }} แต้ม</div></div>
              <div class="rounded-xl px-3 py-2" :class="memberSoon ? 'bg-amber-100 text-amber-950' : 'bg-stone-50'"><div class="text-xs" :class="memberSoon ? 'text-amber-900' : 'text-stone-500'">คะแนนที่จะหมดอายุ</div><div class="font-semibold tabular-nums">{{ memberSoon ? `${memberSoon.points.toLocaleString()} แต้ม · ${dateOnly(memberSoon.date)}` : 'ไม่มี' }}</div></div>
            </div>
          </div>

          <button v-if="!memberLocked && !resumeOrder" type="button" class="btn-outline h-11 w-full" @click="cpScanOpen = true">สแกนบาร์โค้ดคูปองของลูกค้า</button>
          <div v-if="member && coupons.length" class="rounded-2xl bg-white p-3 ring-1 ring-stone-200" aria-label="คูปองส่วนลด">
            <div class="mb-1.5 text-sm font-semibold text-stone-800">คูปอง · กดเพื่อใช้</div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="c in coupons" :key="c.id" type="button" class="chip h-auto max-w-full py-1.5 text-left whitespace-normal" :class="[couponIds.includes(c.id) ? 'chip-on' : 'chip-off', couponOk(c) ? '' : 'opacity-50']" :disabled="!couponOk(c) || memberLocked" :aria-pressed="couponIds.includes(c.id)" @click="toggleCoupon(c.id)">{{ c.name }} · {{ couponTermsText(c) }} · เหลือ {{ mmss(c) }}</button>
            </div>
            <p v-for="c in coupons.filter((x) => !couponOk(x))" :key="'n' + c.id" class="mt-1 text-xs text-amber-700">{{ c.name }}: {{ couponReason(c) }}</p>
            <p v-if="keptProblem" class="mt-1 text-xs text-rose-700" role="alert">{{ keptProblem }}</p>
            <p v-if="couponIds.length" class="mt-1.5 text-xs text-emerald-700">ใช้คูปองลดแล้ว {{ money(preview.couponDiscount) }}</p>
          </div>
          <p v-else-if="member && hiddenCoupons" class="rounded-2xl bg-amber-50 p-3 text-xs text-amber-800" role="note">ลูกค้ามีคูปอง {{ hiddenCoupons }} ใบที่ยังไม่ได้กด "ใช้ที่ร้านตอนนี้" ให้ลูกค้ากดในบัญชีของตนก่อน คูปองจึงจะขึ้นที่นี่ (มีเวลาแสดง {{ db.loyalty.activationMin }} นาที)</p>

          <!-- รายการชำระของบิลนี้ -->
          <ul v-if="listedLines.length" class="space-y-2" aria-label="รายการชำระของบิลนี้">
            <li v-for="l in listedLines" :key="l.key" class="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2 ring-1 ring-stone-200">
              <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full" :class="l.confirmed || l.locked || lineOk(l) ? 'bg-emerald-600 text-white' : 'bg-stone-200 text-stone-600'" aria-hidden="true"><AppIcon name="check" :size="14" /></span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold text-stone-800">{{ POS_METHODS[l.method] }} <span class="tabular-nums">{{ money(lineAmt(l)) }}</span></div>
                <div class="text-xs text-stone-500">
                  <template v-if="l.method === 'cash' && !l.locked">รับมา {{ money(Number(l.received) || 0) }} · ทอน {{ money(Math.max(changeOf(l), 0)) }}</template>
                  <template v-else-if="l.locked">บันทึกแล้ว</template>
                  <template v-else-if="l.acceptedBy === 'auto'">รับอัตโนมัติ</template>
                </div>
              </div>
              <button v-if="!l.locked && !l.confirmed && l.method !== 'transfer' && !binding" type="button" class="h-8 shrink-0 rounded-full px-2.5 text-xs font-medium text-stone-700 ring-1 ring-stone-300" @click="focusKey = l.key">แก้</button>
              <button v-if="!l.locked && l.confirmed && !binding" type="button" class="h-8 shrink-0 rounded-full px-2.5 text-xs font-medium text-stone-700 ring-1 ring-stone-300" @click="l.confirmed = false; l.acceptedBy = ''; l.maneeId = ''; l.detectedAt = 0">ยกเลิก</button>
              <button v-else-if="!l.locked && !l.qrRef && !binding" type="button" class="h-8 shrink-0 rounded-full px-2 text-xs font-medium text-rose-700 hover:bg-rose-50" @click="removePayLine(payLines.indexOf(l))">ลบ</button>
            </li>
          </ul>

          <!-- QR ที่ยกเลิกแล้ว: ระบบยังเฝ้าการโอนเข้าจนปิดหน้าชำระ -->
          <div v-for="l in cancelledQrs" :key="'x' + l.key" class="space-y-2 rounded-2xl bg-stone-100 p-3 text-xs">
            <p class="text-stone-700">QR ที่ยกเลิก {{ money(lineAmt(l)) }} · ระบบยังตรวจการโอนเข้าให้</p>
            <button type="button" class="font-medium text-stone-700 underline" @click="searchLate(l)">ค้นการโอนของ QR นี้</button>
            <div v-if="(l.candidates || []).length" class="space-y-2">
              <p class="font-medium text-amber-800">พบการโอนเข้า QR เดิม เลือกรายการที่ใช่</p>
              <button v-for="c in l.candidates" :key="c.id" type="button" class="flex h-10 w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3 text-sm" @click="pickManee(l, c)">
                <span>{{ timeOnly(c.received_at) }}</span><span class="font-semibold">{{ money(c.amount) }} · เลือก</span>
              </button>
            </div>
            <div v-if="(l.lateNotice || []).length" class="rounded-xl bg-amber-50 p-2.5 text-amber-900">
              <p class="font-semibold">พบการโอนเข้า QR เดิม {{ money(l.lateNotice[0].amount) }} แต่บิลนี้รับยอดครบแล้ว</p>
              <p class="mt-1">ระบบไม่ผูกให้เอง · พนักงานตรวจสอบและจัดการนอกระบบ</p>
              <button type="button" class="mt-1.5 font-medium underline" @click="dismissLate(l)">ปิดการแจ้งเตือน</button>
            </div>
            <p v-else-if="l.searched && !(l.candidates || []).length" class="text-stone-500">ยังไม่พบการโอนเข้า QR เดิม</p>
          </div>
        </aside>

        <!-- ขวา: วิธีชำระ -->
        <section class="flex min-h-0 flex-col gap-3 overflow-y-auto p-0.5 max-md:gap-2" aria-label="รับชำระ">
          <p v-if="payErr" class="rounded-xl bg-rose-50 p-2.5 text-sm text-rose-700" role="alert">{{ payErr }}</p>
          <p v-if="binding" class="rounded-xl bg-emerald-50 p-2.5 text-center text-sm text-emerald-800" role="status">กำลังบันทึกยอดที่รับแล้ว…</p>

          <!-- แท็บวิธีชำระ: แท็บที่เลือกเป็นสีเข้ม · เปลี่ยนวิธีได้จนกว่าจะสร้าง QR หรือรับเงิน -->
          <div v-if="remaining > 0 || focusLine" class="grid shrink-0 grid-cols-3 gap-2 rounded-3xl bg-stone-200/60 p-1.5" role="group" aria-label="เลือกวิธีชำระ">
            <button
              v-for="[k, label] in PAY_TABS" :key="k" type="button"
              class="h-12 rounded-2xl text-lg font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed"
              :class="focusLine?.method === k ? 'bg-brand-600 text-white shadow-md' : 'text-stone-700 hover:bg-white/70 disabled:opacity-40'"
              :aria-pressed="focusLine?.method === k"
              :disabled="binding || (!!focusLine && focusLine.method !== k && !canSwitch(focusLine))"
              @click="pickMethod(k)"
            >{{ label }}</button>
          </div>

          <!-- ยังไม่เลือกวิธี -->
          <div v-if="!focusLine && remaining > 0" class="grid min-h-0 flex-1 place-items-center rounded-3xl border-2 border-dashed border-stone-300 p-6 text-center">
            <div>
              <div class="text-sm text-stone-500">{{ listedLines.length ? 'ยอดที่เหลือ' : 'ยอดที่ต้องรับ' }}</div>
              <div class="text-5xl font-bold tabular-nums text-stone-900">{{ money(remaining) }}</div>
              <p class="mt-2 text-base text-stone-600">เลือกวิธีชำระด้านบน</p>
            </div>
          </div>

          <!-- รับครบแล้ว -->
          <div v-if="!focusLine && remaining <= 0" class="grid min-h-0 flex-1 place-items-center rounded-3xl bg-emerald-50 p-6 text-center text-emerald-900" role="status">
            <div>
              <span class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-white" aria-hidden="true"><AppIcon name="check" :size="32" /></span>
              <div class="mt-3 text-2xl font-bold">รับเงินครบแล้ว</div>
              <div v-if="changeTotal > 0" class="mt-2 text-lg">เงินทอน <b class="text-3xl tabular-nums">{{ money(changeTotal) }}</b></div>
              <p class="mt-2 text-sm text-emerald-800">{{ canConfirm ? 'กด "ยืนยันรับเงิน" ด้านล่างเพื่อปิดบิล' : 'ตรวจรายการชำระทางซ้าย' }}</p>
            </div>
          </div>

          <!-- รายการที่กำลังทำ -->
          <template v-for="l in focusLine ? [focusLine] : []" :key="l.key">
            <!-- เงินสด -->
            <div v-if="l.method === 'cash'" class="flex min-h-0 flex-1 flex-col gap-3">
              <div class="flex flex-col gap-3">
                <div class="rounded-3xl bg-white p-4 ring-1 ring-stone-200 max-md:p-3">
                  <div class="flex items-center justify-between gap-2 text-sm" :class="l.split ? 'max-md:hidden' : ''">
                    <span class="text-stone-500">ยอดเงินสด <b class="tabular-nums text-stone-800">{{ money(lineAmt(l)) }}</b></span>
                    <button v-if="!l.locked && !l.confirmed && !l.split" type="button" class="font-medium text-brand-700 underline" @click="l.split = true">แบ่งจ่าย (เปลี่ยนยอด)</button>
                  </div>
                  <div v-if="l.split && !l.locked && !l.confirmed" class="mt-2 rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-300">
                    <label class="block text-sm text-stone-600" :for="'cash-amt-' + l.key">ยอดเงินสดครั้งนี้</label>
                    <MoneyInput :id="'cash-amt-' + l.key" v-model="l.amount" data-numpad="dec" class="input h-12 text-2xl font-bold" />
                  </div>
                  <div class="mt-3 rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-300">
                    <label class="block text-sm text-stone-600" :for="'cash-rec-' + l.key">รับเงินมา</label>
                    <MoneyInput :id="'cash-rec-' + l.key" v-model="l.received" data-numpad="dec" :disabled="!!l.locked || !!l.confirmed" class="input h-14 text-4xl font-bold max-md:h-12 max-md:text-3xl" />
                  </div>
                </div>
                <div class="flex items-center justify-between rounded-3xl px-4 py-3 max-md:py-2" :class="changeOf(l) >= 0 ? 'bg-emerald-600 text-white' : 'bg-amber-200 text-amber-950 ring-1 ring-amber-400'">
                  <span class="text-base font-semibold">{{ changeOf(l) >= 0 ? 'เงินทอน' : 'ยังขาด' }}</span>
                  <span class="text-3xl font-bold tabular-nums">{{ money(Math.abs(changeOf(l))) }}</span>
                </div>
                <div v-if="kbMode === 'keyboard'" class="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-stone-100 px-3 py-2 text-sm text-stone-700" aria-label="ปุ่มลัดคีย์บอร์ด">
                  <div class="flex items-center gap-1.5"><kbd class="rounded-md bg-white px-2 py-0.5 font-semibold ring-1 ring-stone-300">0–9</kbd> พิมพ์จำนวน</div>
                  <div class="flex items-center gap-1.5"><kbd class="rounded-md bg-white px-2 py-0.5 font-semibold ring-1 ring-stone-300">Enter</kbd> ยืนยันรับเงิน</div>
                  <div class="flex items-center gap-1.5"><kbd class="rounded-md bg-white px-2 py-0.5 font-semibold ring-1 ring-stone-300">.</kbd> จุดทศนิยม</div>
                  <div class="flex items-center gap-1.5"><kbd class="rounded-md bg-white px-2 py-0.5 font-semibold ring-1 ring-stone-300">⌫</kbd> ลบตัวอักษร</div>
                  <p class="basis-full text-xs text-stone-500">แตะหน้าจอเพื่อกลับเป็นแป้นบนจอ</p>
                </div>
                <div v-if="kbMode !== 'keyboard'" class="grid grid-cols-4 gap-2" aria-label="จำนวนเงินด่วน">
                  <button v-for="v in quickFor(l)" :key="v" type="button" class="h-12 rounded-2xl bg-white text-base font-semibold max-md:h-10 max-md:px-1 max-md:text-sm text-stone-800 ring-1 ring-stone-300 active:scale-[0.98] disabled:opacity-40" :class="Number(l.received) === v ? 'ring-2 ring-brand-600' : ''" :disabled="!!l.locked || !!l.confirmed" @click="l.received = String(v)">{{ v === lineAmt(l) ? 'พอดี' : money(v) }}</button>
                </div>
                <div v-if="(remaining > 0 && changeOf(l) >= 0 && !binding) || (canBindCash(l, remaining) && !binding)" class="grid grid-cols-2 gap-2">
                  <button v-if="remaining > 0 && changeOf(l) >= 0 && !binding" type="button" class="btn-outline h-11 w-full max-md:h-10 max-md:text-sm" @click="keepAndAddMore">รับส่วนที่เหลือ {{ money(remaining) }} ด้วยวิธีอื่น</button>
                  <button v-if="canBindCash(l, remaining) && !binding" type="button" class="btn-soft h-11 w-full max-md:h-10 max-md:text-sm" @click="bindCash(l)">บันทึกเงินสดนี้เป็นบิลค้าง</button>
                </div>
                <div v-if="l.confirmed && !l.locked" class="space-y-2">
                  <div class="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800"><AppIcon name="check" :size="18" /> รับเงินสดแล้ว</div>
                  <button v-if="!binding" type="button" class="btn-outline h-11 w-full" @click="cancelCash(l)">ยกเลิกการรับชำระ</button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2" aria-label="ล้างหรือบันทึกยอดเงินสด">
                <button type="button" class="h-11 rounded-2xl text-sm font-medium text-stone-600 ring-1 ring-stone-300 active:scale-[0.98] disabled:opacity-40 max-md:h-10 max-md:text-xs" :disabled="!!l.locked || !!l.confirmed" @click="l[padField(l)] = ''">ล้าง{{ padField(l) === 'amount' ? 'ยอดเงินสดครั้งนี้' : 'รับเงินมา' }}</button>
                <button v-if="!l.locked && !l.confirmed && lineAmt(l) > 0 && changeOf(l) >= 0 && !binding" type="button" class="btn-primary h-12 w-full text-lg max-md:h-10 max-md:text-base" @click="keepAndAddMore">บันทึกยอดเงินสดนี้</button>
              </div>
            </div>

            <!-- บัตร -->
            <div v-else-if="l.method === 'card'" class="flex min-h-0 flex-1 flex-col gap-3">
              <div class="rounded-3xl bg-white p-6 text-center ring-1 ring-stone-200">
                <div class="text-sm text-stone-500">รับชำระด้วยบัตร</div>
                <div class="text-4xl font-bold tabular-nums text-stone-900">{{ money(lineAmt(l)) }}</div>
                <p class="mt-2 text-sm text-stone-600">รูดบัตรที่เครื่องรับบัตรให้สำเร็จ แล้วกดปุ่มด้านล่าง</p>
                <button v-if="!l.locked && !l.confirmed && !l.split" type="button" class="mt-2 text-sm font-medium text-brand-700 underline" @click="l.split = true">แบ่งจ่าย (เปลี่ยนยอด)</button>
                <div v-if="l.split && !l.locked && !l.confirmed" class="mx-auto mt-2 max-w-48">
                  <label class="sr-only" :for="'amt-' + l.key">ยอดบัตร</label>
                  <MoneyInput :id="'amt-' + l.key" v-model="l.amount" class="input h-11 text-center text-lg font-semibold" />
                </div>
              </div>
              <button v-if="!l.confirmed && !binding" type="button" class="btn-primary h-14 w-full text-lg" @click="l.confirmed = true; l.acceptedBy = 'staff'">รับชำระด้วยบัตรแล้ว</button>
              <div v-else-if="l.confirmed && !l.locked" class="space-y-2">
                <div class="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800"><AppIcon name="check" :size="18" /> รับชำระด้วยบัตรแล้ว</div>
                <button v-if="!binding" type="button" class="btn-outline h-11 w-full" @click="l.confirmed = false; l.acceptedBy = ''">ยกเลิกการรับชำระ</button>
              </div>
            </div>

            <!-- โอน: ยังไม่มี QR · ยอดเต็มกดสร้างได้ทันที แบ่งจ่ายจึงแสดงแป้นตัวเลข -->
            <div v-else-if="!l.qrRef" class="flex min-h-0 flex-1 flex-col gap-3">
              <div class="flex min-h-0 flex-1 flex-col items-center justify-center rounded-3xl bg-white p-6 text-center ring-1 ring-stone-200">
                <div class="text-base text-stone-500">ยอดโอนครั้งนี้</div>
                <div class="text-4xl font-bold tabular-nums whitespace-nowrap text-stone-900">{{ money(lineAmt(l)) }}</div>
                <button v-if="!l.split" type="button" class="mt-2 text-sm font-medium text-brand-700 underline" @click="l.split = true">แบ่งจ่าย (เปลี่ยนยอด)</button>
                <p v-else class="mt-2 text-sm text-stone-500">พิมพ์ยอดด้วยคีย์บอร์ด · ล้างค่าเพื่อเริ่มใหม่</p>
              </div>
              <div class="grid gap-2" :class="l.split ? 'grid-cols-[1fr_2fr]' : 'grid-cols-1'">
                <button v-if="l.split" type="button" class="btn-outline h-14" @click="l.amount = ''">ล้างค่า</button>
                <button type="button" class="btn-primary h-14 w-full text-lg" :disabled="!(lineAmt(l) > 0) || lineAmt(l) > remaining + lineAmt(l) + 0.005" @click="makeQr(l)">สร้าง QR ยอด {{ money(lineAmt(l)) }}</button>
              </div>
            </div>
            <!-- โอน: พบการโอนแล้ว รอพนักงานกดรับ (ระบบรับเองเมื่อครบเวลา) -->
            <div v-else-if="l.detectedAt" class="flex min-h-0 flex-1 flex-col gap-3">
              <div class="pay-pop relative overflow-hidden rounded-3xl bg-emerald-600 p-6 text-white">
                <div class="flex items-center gap-4">
                  <span class="relative grid h-14 w-14 shrink-0 place-items-center">
                    <span class="pay-ring absolute inset-0 rounded-full bg-white/40" aria-hidden="true" />
                    <span class="relative grid h-14 w-14 place-items-center rounded-full bg-white/20">
                      <svg class="pay-check h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
                    </span>
                  </span>
                  <div class="min-w-0">
                    <div class="text-base font-medium text-emerald-50">ลูกค้าโอนแล้ว · พบรายการโอน</div>
                    <div class="text-5xl font-bold tabular-nums">{{ money(lineAmt(l)) }}</div>
                  </div>
                </div>
                <p class="mt-3 text-sm text-emerald-50">ระบบรับให้เองใน <b class="tabular-nums text-white">{{ autoLeft(l) }}</b></p>
              </div>
              <button type="button" class="btn-primary h-16 w-full text-xl" :disabled="binding" @click="receiveNow(l)"><AppIcon name="check" :size="20" /> รับชำระ</button>
            </div>

            <!-- โอน: รอลูกค้าโอน (QR แสดงที่จอลูกค้าถ้ามี) -->
            <div v-else class="grid min-h-0 flex-1 content-center items-center justify-items-center gap-4 rounded-3xl bg-white p-4 ring-1 ring-stone-200 landscape:grid-cols-2">
              <BillerQr v-if="!customerScreen" :amount="lineAmt(l)" :ref1="db.shop.merchantCode || ''" :ref2="l.qrRef" :show-amount="false" />
              <div class="w-full space-y-3 text-center landscape:text-left">
                <div>
                  <div class="text-sm text-stone-500">ยอดโอน</div>
                  <div class="text-4xl font-bold tabular-nums text-stone-900">{{ money(lineAmt(l)) }}</div>
                </div>
                <div v-if="expiredLine(l)" class="space-y-2">
                  <p class="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">QR หมดอายุแล้ว สร้าง QR ใหม่ให้ลูกค้าสแกน</p>
                  <button type="button" class="btn-primary h-12 w-full" @click="makeQr(l)">สร้าง QR ใหม่</button>
                </div>
                <div v-else class="flex items-center justify-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-amber-900 landscape:justify-start">
                  <span class="relative grid h-3 w-3 place-items-center" aria-hidden="true"><span class="motion-safe:animate-ping absolute inset-0 rounded-full bg-amber-400/70" /><span class="relative h-2.5 w-2.5 rounded-full bg-amber-500" /></span>
                  <span class="font-semibold">รอลูกค้าโอน</span>
                  <span class="text-sm">· หมดอายุใน <b class="tabular-nums">{{ qrLeft(l) }}</b></span>
                </div>
                <p v-if="customerScreen && !expiredLine(l)" class="rounded-xl bg-brand-50 p-2.5 text-sm font-medium text-brand-800">QR แสดงที่จอลูกค้าแล้ว ให้ลูกค้าสแกนที่จอนั้น</p>
                <p v-if="!expiredLine(l)" class="text-xs text-stone-500">ระบบตรวจการโอนเข้าให้อัตโนมัติ ไม่ต้องกดอะไร</p>
                <div v-if="!expiredLine(l) && (l.candidates || []).length > 1" class="space-y-2">
                  <p class="text-sm font-medium text-amber-800">พบหลายรายการที่ตรง เลือกรายการที่ใช่</p>
                  <button v-for="c in l.candidates" :key="c.id" type="button" class="flex h-11 w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4" @click="pickManee(l, c)">
                    <span>{{ timeOnly(c.received_at) }}</span><span class="font-semibold">เลือก</span>
                  </button>
                </div>
                <button v-if="!expiredLine(l) && !binding" type="button" class="btn-outline h-auto min-h-11 w-full py-2 whitespace-normal" @click="receiveNow(l)">ลูกค้าโอนแล้วแต่ระบบยังไม่พบ (ตรวจสลิปแล้ว)</button>
                <div class="grid grid-cols-2 gap-2">
                  <button v-if="!binding" type="button" class="btn-outline h-11" @click="splitTransfer(l)">แบ่งจ่าย (เปลี่ยนยอด)</button>
                  <button v-if="!l.detectedAt && !l.confirmed && !binding" type="button" class="btn-outline h-11 text-rose-700" @click="backToMethods(l)">ยกเลิก QR</button>
                </div>
              </div>
            </div>
          </template>
        </section>
      </div>
      </div>

      <template #footer>
        <div class="flex w-full gap-2">
          <button class="btn-outline h-14 flex-1" :disabled="binding" @click="requestClose">ยกเลิก</button>
          <button v-if="canSavePartial" class="btn-soft h-14 flex-1" :disabled="binding" @click="saveBillPartial">บันทึกบิลค้างไว้</button>
          <button v-if="canConfirm" class="btn-primary h-14 flex-[2] text-lg" :disabled="binding" @click="confirmPay"><AppIcon name="check" :size="20" /> ยืนยันรับเงิน</button>
        </div>
      </template>
    </AppModal>

    <!-- ใบเสร็จ -->
    <AppModal v-if="receipt" title="ใบเสร็จรับเงิน" @close="receipt = null">
      <div v-if="receiptInfo" class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-stone-200 bg-white px-4 py-3">
        <div class="min-w-0">
          <div class="truncate font-mono text-xs text-stone-500">{{ receipt.code }}</div>
          <div class="text-xl font-bold tabular-nums text-stone-900">{{ money(receiptInfo.total) }}</div>
        </div>
        <span class="shrink-0 rounded-full px-3 py-1 text-sm font-semibold" :class="receiptInfo.diff > 0 ? 'bg-amber-100 text-amber-800' : receiptInfo.diff < 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'">
          {{ receiptInfo.diff > 0 ? `ยังค้าง ${money(receiptInfo.diff)}` : receiptInfo.diff < 0 ? `ชำระเกิน ${money(-receiptInfo.diff)}` : 'ชำระครบแล้ว' }}
        </span>
      </div>
      <Receipt :order="receipt" :lucky-url="receiptLuckyUrl" />
      <template #footer>
        <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <div class="flex gap-2">
            <button class="btn-soft h-11 flex-1 sm:flex-none sm:px-4" @click="print"><AppIcon name="printer" :size="18" /> พิมพ์</button>
            <button v-if="taxable(receipt)" class="btn-soft h-11 flex-1 sm:flex-none sm:px-4" @click="taxFor = receipt">ใบกำกับภาษีเต็มรูป</button>
          </div>
          <button class="btn-primary h-12 w-full sm:min-w-[8rem] sm:flex-1" @click="receipt = null">ขายต่อ</button>
        </div>
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
