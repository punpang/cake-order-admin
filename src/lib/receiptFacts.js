// ข้อมูลใบเสร็จชุดเดียวสำหรับทั้งจอ (Receipt.vue) และเครื่องพิมพ์ความร้อน (receiptRaster.js) เพื่อให้หน้าจอกับกระดาษตรงกัน
// ฟังก์ชันล้วน: ผู้เรียกส่งข้อมูลร้าน/ลูกค้าเข้ามาเอง ไม่อ่าน store
// ฟิลด์เฉพาะออเดอร์ (นัดรับ/จัดส่ง, ลูกค้าโทร, กำหนดชำระ) จะว่างเมื่อ channel = pos
import { orderTotals } from './pricing.js'
import { money, dateTime } from './format.js'

const SAMPLE_ADDRESS = /ตัวอย่าง/ // ที่อยู่ตัวอย่างจากค่าเริ่มต้นของหน้าตั้งค่าร้าน ไม่พิมพ์ลงใบเสร็จ
const clean = (s) => String(s ?? '').trim()

export function receiptFacts(order, { shop = {}, legal = {}, storefront = {}, customer = null, points = null } = {}) {
  const t = orderTotals(order)
  const isOrder = order.channel !== 'pos'
  const cancelled = order.status === 'cancelled'
  const storeAddress = clean(storefront.address)
  const payments = (order.payments || []).filter((p) => p.status === 'confirmed')
  // งวดที่ยังไม่ได้รับและมีกำหนดชำระ: เอางวดที่ถึงกำหนดเร็วที่สุด
  const nextDue = isOrder
    ? (order.payments || [])
        .filter((p) => p.status === 'reported' && p.dueAt && !Number.isNaN(new Date(p.dueAt).getTime()))
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0] || null
    : null
  return {
    shopName: clean(shop.name) || 'ร้าน',
    shopAddress: clean(legal.contact?.address) || (SAMPLE_ADDRESS.test(storeAddress) ? '' : storeAddress),
    shopPhone: clean(legal.contact?.phone),
    cancelled,
    vatMode: t.vatMode,
    vatRate: t.vatRate,
    vatLegalName: t.vatMode ? clean(shop.vat?.legalName) : '',
    vatTaxId: t.vatMode ? clean(shop.vat?.taxId) : '',
    full: t.full,
    discountLines: t.discountLines,
    vat: t.vat,
    beforeVat: t.beforeVat,
    total: t.total,
    payments: payments.map((p) => ({ method: p.method, amount: p.amount, received: p.received, change: p.change, qrRef: clean(p.qrRef) })),
    paidTotal: t.paid,
    balance: t.balance,
    nextDue: nextDue ? { at: dateTime(nextDue.dueAt), amount: money(nextDue.requested ?? nextDue.amount) } : null,
    fulfillment: isOrder
      ? {
          label: order.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน',
          at: order.pickupAt ? dateTime(order.pickupAt) : '',
          address: order.fulfillment === 'delivery' ? clean(order.detail) : '',
        }
      : null,
    customer: customer
      ? {
          label: isOrder ? 'ลูกค้า' : 'สมาชิก',
          name: clean(customer.name),
          phone: isOrder ? clean(customer.phone) : '',
          earned: Number(order.loyalty?.points) || 0,
          bonus: Number(order.loyalty?.bonus) || 0,
          pointsLeft: !cancelled && points != null ? points : null,
        }
      : null,
  }
}
