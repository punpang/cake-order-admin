// ข้อมูลใบเสร็จชุดเดียวสำหรับทั้งจอ (Receipt.vue) และเครื่องพิมพ์ความร้อน (receiptRaster.js) เพื่อให้หน้าจอกับกระดาษตรงกัน
// ฟังก์ชันล้วน: ผู้เรียกส่งข้อมูลร้าน/ลูกค้าเข้ามาเอง ไม่อ่าน store
// ฟิลด์เฉพาะออเดอร์ (นัดรับ/จัดส่ง, ลูกค้าโทร, กำหนดชำระ) จะว่างเมื่อ channel = pos
import { orderTotals } from './pricing.js'
import { money, dateTime, phoneDigits } from './format.js'

const SAMPLE_ADDRESS = /ตัวอย่าง/ // ที่อยู่ตัวอย่างจากค่าเริ่มต้นของหน้าตั้งค่าร้าน ไม่พิมพ์ลงใบเสร็จ
const clean = (s) => String(s ?? '').trim()
const norm = (s) => clean(s).replace(/\s+/g, ' ') // เทียบชื่อหลังยุบช่องว่างซ้ำ
// เบอร์ลูกค้าบนใบที่พิมพ์: ซ่อนเลขกลาง เช่น 089-123-2018 → 089-xxx-2018 (บนจอยังแสดงเต็มตามเดิม)
export function maskPhone(s) {
  const d = phoneDigits(s)
  if (!d) return ''
  if (d.length < 9) return 'xxx-xxxx'
  return `${d.slice(0, d.length === 10 ? 3 : 2)}-xxx-${d.slice(-4)}`
}

// เวลาเปิด-ปิดบนใบเสร็จ: ใช้ตารางหน้าร้าน (storefront.hours) · ถ้าไม่มีตาราง ใช้เวลาเปิด-ปิดของร้าน
function hoursOf(storefront, shop) {
  const rows = (storefront.hours || []).map((h) => ({ days: clean(h.days), time: clean(h.time) })).filter((h) => h.days && h.time)
  if (rows.length) return rows
  return shop.open && shop.close ? [{ days: 'ทุกวัน', time: `${shop.open}–${shop.close}` }] : []
}

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
    shopHours: hoursOf(storefront, shop),
    cancelled,
    vatMode: t.vatMode,
    vatRate: t.vatRate,
    vatLegalName: t.vatMode && norm(shop.vat?.legalName) !== norm(shop.name) ? clean(shop.vat?.legalName) : '', // ซ้ำกับชื่อร้านบนสุดให้ซ่อน
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
