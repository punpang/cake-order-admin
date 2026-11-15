// ทดสอบตัวชี้วัด dashboard · รัน: node src/lib/dashboardStats.test.mjs
import assert from 'node:assert/strict'
import { computeDashboard } from './dashboardStats.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

// now = 2026-11-11 12:00 เวลาไทย (05:00 UTC) · วันนี้ = 2026-11-11 · 7 วันย้อนหลังเริ่ม 2026-11-05
const now = new Date('2026-11-11T05:00:00Z')

const orders = [
  { id: 'o1', status: 'payment_reported', pickupAt: '2026-11-11T15:00', createdAt: '2026-11-10T02:00:00Z', customerId: 'c1' },
  { id: 'o2', status: 'preparing', pickupAt: '2026-11-11T18:00', createdAt: '2026-11-09T02:00:00Z', customerId: 'c2' },
  { id: 'o3', status: 'delivered', pickupAt: '2026-11-10T10:00', createdAt: '2026-11-01T02:00:00Z', customerId: 'c3' }, // ปิดแล้ว ไม่นับในออร์เดอร์ค้าง
  { id: 'o4', status: 'cancelled', pickupAt: '2026-11-11T11:00', createdAt: '2026-11-11T01:00:00Z', customerId: 'c4' }, // ยกเลิก ไม่นับนัดรับวันนี้
  { id: 'o5', status: 'order_confirmed', pickupAt: '2026-11-12T10:00', createdAt: '2026-11-02T02:00:00Z', customerId: 'c1' }, // ลูกค้าเดิม (ออร์เดอร์แรกเก่า)
  { id: 'o6', status: 'awaiting_payment', pickupAt: '2026-11-13T10:00', createdAt: '2026-11-11T03:00:00Z', customerId: 'c5' }, // ลูกค้าใหม่วันนี้
]

const chats = [
  { id: 'a', channel: 'facebook', unreadStaff: 0, messages: [{ from: 'customer', at: '2026-11-10T03:00:00Z' }] }, // รอตอบ (ข้อความสุดท้ายจากลูกค้า) · ทักใหม่ในช่วง 7 วัน
  { id: 'b', channel: 'facebook', unreadStaff: 0, messages: [{ from: 'customer', at: '2026-10-01T03:00:00Z' }, { from: 'staff', at: '2026-10-01T04:00:00Z' }] }, // ตอบแล้ว เก่า
  { id: 'c', channel: 'instagram', unreadStaff: 2, messages: [{ from: 'customer', at: '2026-11-11T01:00:00Z' }, { from: 'staff', at: '2026-11-11T02:00:00Z' }] }, // รอตอบ (ยังไม่อ่าน)
  { id: 'd', channel: 'facebook', unreadStaff: 0, messages: [{ from: 'staff', at: '2026-11-11T02:00:00Z' }] }, // พนักงานตอบล่าสุด
]

const base = { now, orders, chats, quotes: [{ status: 'pending' }, { status: 'accepted' }], photoRequests: [{ status: 'pending' }], reviews: [{ status: 'approved' }], deletionRequests: [{ status: 'pending' }, { status: 'pending' }] }

t('ออร์เดอร์ค้าง: ไม่นับที่ส่งมอบแล้วและยกเลิก แยกตามสถานะ', () => {
  const d = computeDashboard(base)
  assert.equal(d.orders.open, 4)
  assert.equal(d.orders.byStatus.payment_reported, 1)
  assert.equal(d.orders.byStatus.delivered, undefined)
})
t('นัดรับวันนี้: ตัดวันจากเวลานัดตรง ๆ และไม่นับยกเลิก', () => {
  const d = computeDashboard(base)
  assert.equal(d.orders.pickupToday, 2) // o1 และ o2 (o4 ยกเลิกไม่นับ)
})
t('ลูกค้าใหม่ 7 วัน: นับจากออร์เดอร์แรกในช่วง ไม่นับลูกค้าเดิม', () => {
  const d = computeDashboard(base)
  // c1 ออร์เดอร์แรก 2 พ.ย. (นอกช่วง) · c2 9 พ.ย. · c4 11 พ.ย. · c5 11 พ.ย. · c3 1 พ.ย. (นอกช่วง)
  assert.equal(d.orders.newCustomers7d, 3)
})
t('แชท Facebook: จำนวนทั้งหมด และทักใหม่ 7 วัน', () => {
  const d = computeDashboard(base)
  assert.equal(d.chats.facebookTotal, 3)
  assert.equal(d.chats.facebookNew7d, 1) // a เท่านั้น (b เก่า, d ไม่มีข้อความลูกค้า)
})
t('รอตอบ: ข้อความสุดท้ายเป็นลูกค้า หรือยังไม่อ่าน', () => {
  const d = computeDashboard(base)
  assert.equal(d.chats.awaitingReply, 2) // a และ c
  assert.equal(d.chats.awaitingFacebook, 1) // a
})
t('งานค้าง: นับเฉพาะสถานะ pending/payment_reported', () => {
  const d = computeDashboard(base)
  assert.deepEqual(d.pending, { paymentReported: 1, quotes: 1, photoRequests: 1, reviews: 0, deletionRequests: 2 })
})
t('ผู้ไม่มีสิทธิ์แชท: chats เป็น null ส่วนอื่นยังมี', () => {
  const d = computeDashboard({ ...base, chats: null })
  assert.equal(d.chats, null)
  assert.equal(d.orders.open, 4)
})
t('ไม่มีข้อมูล: ค่าศูนย์ ไม่พัง', () => {
  const d = computeDashboard({ now })
  assert.equal(d.orders.open, 0)
  assert.equal(d.orders.newCustomers7d, 0)
  assert.equal(d.pending.deletionRequests, 0)
})

console.log(`ALL PASS (${pass})`)
