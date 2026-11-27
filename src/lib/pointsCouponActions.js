// การกระทำของการสร้างคูปองจากคะแนน (แยกจาก store เพื่อไม่ให้ไฟล์หลักใหญ่ขึ้น): โหมดเซิร์ฟเวอร์ + โหมดจำลอง
// กติกาตรวจที่ pointsCoupon.js · กติกาเดียวกับ punpang_cust_make_coupon ฝั่งเซิร์ฟเวอร์
import { db, refreshCustomerBundle } from '../data/store'
import { takePoints, addDays, pointBalance } from './loyalty'
import { toDateStr } from './format'
import { callLoyalty, readSessionToken, injectBundle } from './customerRemote'
import { pointsCouponQuote, POINTS_COUPON } from './pointsCoupon'

// โหมดเซิร์ฟเวอร์ (ลูกค้าล็อกอิน): หักคะแนนกับสร้างคูปองในขั้นตอนเดียวที่ฐานข้อมูล แล้วรับข้อมูลลูกค้า/คูปองกลับมา
export async function makeCouponRemote(amount) {
  const r = await callLoyalty('make_coupon', { session: readSessionToken(), amount: Number(amount) })
  if (r.error) return { error: r.error }
  injectBundle(db, r)
  await refreshCustomerBundle() // ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์ ให้คะแนนบนหน้าตรงกับยอดจริง
  return { ok: true, coupon: r.result?.coupon || null, points: Number(r.result?.coupon?.points) || 0, balance: Number(r.result?.balance) }
}

// โหมดจำลอง (ไม่มีเซิร์ฟเวอร์): ตัดคะแนนตามลำดับหมดอายุ แล้วออกคูปองลดเป็นบาทใบเดียว · คืน error เป็นรหัส (invalid/not_divisible/insufficient)
export function makePointsCouponLocal(c, amount) {
  const today = toDateStr(new Date())
  const q = pointsCouponQuote(amount, db.loyalty.pointValue, pointBalance(c.ledger, today))
  if (!q.ok) return { error: q.reason }
  const a = Number(amount)
  const takes = takePoints(c.ledger, q.points, today)
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  c.ledger.push({ id: `pt${stamp}`, at: new Date().toISOString(), delta: -q.points, reason: `สร้างคูปองจากคะแนน ${a} บาท`, orderId: null, takes })
  const cp = { id: `cp${stamp}`, customerId: c.id, status: 'pending', createdAt: new Date().toISOString(), expiresAt: addDays(today, POINTS_COUPON.days), type: 'discount', mode: 'fixed', amount: a, minSpend: 0, pct: 0, cap: 0, productId: '', productName: '', name: `คูปองจากคะแนน ${a} บาท`, source: 'points_coupon', points: q.points }
  db.coupons.unshift(cp)
  return { ok: true, coupon: cp, points: q.points, balance: pointBalance(c.ledger, today) }
}
