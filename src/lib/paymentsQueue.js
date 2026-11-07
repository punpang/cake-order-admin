// คิวการชำระเงินของออร์เดอร์ (ฟังก์ชันล้วน · ไม่รวมบิล POS) สำหรับหน้า #/admin/payments
// tab: review = มีงวดที่แจ้งไว้รอตรวจ/รอรับเงิน · due = ยังค้างชำระ · paid = ชำระครบ หรือมีคืนเงิน
import { orderTotals } from './pricing'
import { orderDue, dueState, customerPending, pendingExtension } from './payDue'

export const PAY_TABS = [{ v: 'review', l: 'รอตรวจ' }, { v: 'due', l: 'ค้างชำระ' }, { v: 'paid', l: 'ชำระครบ / คืนเงิน' }]

const eligible = (o) => o.channel !== 'pos' && o.status !== 'draft'
const live = (o) => eligible(o) && o.status !== 'cancelled'

// ออร์เดอร์นี้อยู่แท็บไหนบ้าง (หนึ่งออร์เดอร์อยู่ได้หลายแท็บ)
export function paymentTabsOf(o, t = orderTotals(o)) {
  const out = []
  if (!eligible(o)) return out
  if (live(o) && (o.payments || []).some((p) => p.status === 'reported')) out.push('review')
  if (live(o) && t.balance > 0) out.push('due')
  if ((live(o) && t.balance <= 0 && t.paid > 0) || (o.returns || []).some((x) => !x.cancelled)) out.push('paid')
  return out
}

// เรียงเร่งด่วนก่อน: ลูกค้าแจ้งเองรอตรวจ → เลยกำหนดชำระ → กำหนดชำระใกล้สุด → วันนัดรับ
function urgency(o, now) {
  const due = orderDue(o, now)
  return [customerPending(o).length ? 0 : 1, due?.state === 'overdue' ? 0 : 1, due ? new Date(due.dueAt).getTime() : Infinity, new Date(o.pickupAt).getTime() || Infinity]
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0 }

// orders = db.orders · textOf(o) = ข้อความที่ค้นหาได้ (เลข/ชื่อ/เบอร์) · คืน [{ o, t, due, pending, ext }]
export function paymentQueue(orders, { tab = 'review', q = '', textOf = (o) => o.code, now = new Date() } = {}) {
  const s = String(q || '').trim().toLowerCase()
  return orders
    .map((o) => ({ o, t: orderTotals(o) }))
    .filter(({ o, t }) => paymentTabsOf(o, t).includes(tab) && (!s || textOf(o).toLowerCase().includes(s)))
    .sort((a, b) => (tab === 'paid' ? String(b.o.pickupAt).localeCompare(String(a.o.pickupAt)) : cmp(urgency(a.o, now), urgency(b.o, now))))
    .map(({ o, t }) => ({ o, t, due: orderDue(o, now), pending: customerPending(o), ext: pendingExtension(o) }))
}

export function paymentCounts(orders, now = new Date()) {
  const c = { review: 0, due: 0, paid: 0, overdue: 0, slips: 0 }
  for (const o of orders) {
    const tabs = paymentTabsOf(o)
    for (const k of tabs) c[k]++
    if (tabs.includes('due') && orderDue(o, now)?.state === 'overdue') c.overdue++
    c.slips += o.status === 'cancelled' ? 0 : customerPending(o).length
  }
  return c
}
export { dueState }
