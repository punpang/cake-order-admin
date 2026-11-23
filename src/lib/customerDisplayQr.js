// จอลูกค้า (จอที่ 2) ของแอปร้าน: ตัวกลางส่งสถานะไปจอ
// ลำดับ: QR ถุงเงินที่ค้างจากหน้าออร์เดอร์ > สถานะจาก POS > ต้อนรับ/โฆษณา · ชำระแล้วฉลองสั้น ๆ แล้วคืนจอ
import { db } from '../data/store'
import { isNative, pushDisplay, showDisplay, displayCount } from './nativeDevices'
import { billerIdOf, promptPayBillerPayload } from './promptpay'
import { adsForDisplay } from './displayAds'
import { idleDisplay, orderQrDisplay, orderPaidDisplay, pickDisplay, holdStatusOf } from './customerDisplayState'

const HOLD_FALLBACK_MS = 30 * 60 * 1000 // ไม่มีวันชำระ → ค้าง QR ไม่เกิน 30 นาที
const PAID_MS = 3000
const TICK_MS = 2000
const OFF_KEY = 'punpang.customerScreen.off'

let hold = null // { orderId, paymentId, amount, payload, expiresAt }
let lastPos = null // สถานะล่าสุดจาก POS (null = ไม่มี POS อยู่ ใช้ยินดีต้อนรับ/โฆษณา)
let paid = null // { amount, until } ช่วงฉลองหลังชำระ
let timer = null

const shopName = () => db.shop?.name || ''
const welcome = () => idleDisplay(shopName(), adsForDisplay(db.storefront?.displayAds))

// ส่งสถานะจริงไปจอ · posState ให้ส่งเมื่อ POS เปลี่ยนสถานะ (ระบุ = จำไว้เป็นสถานะของ POS)
export function refreshDisplay(posState) {
  if (posState !== undefined) lastPos = posState
  if (!isNative()) return
  if (paid && paid.until > Date.now()) return pushDisplay(orderPaidDisplay(paid.amount, shopName()))
  const holdState = hold ? orderQrDisplay(hold, shopName()) : null
  pushDisplay(pickDisplay(holdState, lastPos || welcome()))
}

// เริ่มแสดง QR ค้างบนจอ จนกว่าจะชำระ/ยกเลิก/หมดเวลา
export function holdOrderQr({ orderId, paymentId, amount, payload, dueAt }) {
  const due = Date.parse(dueAt)
  hold = { orderId, paymentId, amount: Number(amount) || 0, payload, expiresAt: Number.isFinite(due) ? due : Date.now() + HOLD_FALLBACK_MS }
  paid = null
  refreshDisplay()
}

// ตรวจสถานะรายการที่ค้างทุก 2 วินาที (ทำงานทุกหน้าของแอป)
function tick() {
  const now = Date.now()
  if (paid) {
    if (now >= paid.until) { paid = null; refreshDisplay() }
    return
  }
  if (!hold) return
  const o = db.orders.find((x) => x.id === hold.orderId)
  const p = (o?.payments || []).find((x) => x.id === hold.paymentId)
  const st = holdStatusOf(p, now, hold.expiresAt)
  if (st === 'waiting') return
  if (st === 'paid') paid = { amount: hold.amount, until: now + PAID_MS }
  hold = null
  refreshDisplay()
}

// เปิดจอตอนเริ่มแอป (ถ้ามีจอที่สองและผู้ใช้ไม่ได้ปิดไว้) แล้วเริ่มตรวจสถานะ
export async function startCustomerScreen() {
  if (!isNative()) return () => {}
  timer = setInterval(tick, TICK_MS)
  if (!customerScreenOff()) {
    const n = await displayCount().catch(() => 0)
    if (n > 0) await showDisplay().catch(() => {})
  }
  refreshDisplay()
  return () => { clearInterval(timer); timer = null }
}

export function customerScreenOff() {
  try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false }
}
export function setCustomerScreenOff(off) {
  try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY) } catch { /* เก็บค่าไม่ได้ = เปิดตามปกติ */ }
}

// QR ของ payload ตามรูปแบบ Biller เดียวกับ POS (ใช้ร่วมกับหน้าออร์เดอร์)
export function orderQrPayload(amount, qrRef) {
  const bid = billerIdOf(db.shop?.billerId)
  return bid ? promptPayBillerPayload(bid, amount, db.shop?.merchantCode || '', qrRef) : null
}
