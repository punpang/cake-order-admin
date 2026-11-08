import { money, dateTime } from './format'

// ข้อความสรุปออร์เดอร์/ใบเสนอสำหรับส่งเป็นข้อความธรรมดาไป Messenger (ปุ่มยืนยัน/ขอแก้ยังไม่รองรับ → ให้ลูกค้าตอบเป็นข้อความ)
const itemLines = (items) => (items || []).slice(0, 15).map((i) => `• ${i.name || 'สินค้า'} × ${i.qty || 1}`)
const where = (o) => (o.fulfillment === 'delivery' ? `จัดส่ง${o.placeName ? ` · ${o.placeName}` : ''}` : 'รับที่ร้าน')

export function orderCardText(order, totals, shopName = '') {
  const lines = [`${shopName ? shopName + ' · ' : ''}สรุปออร์เดอร์ ${order.code || ''}`.trim(), ...itemLines(order.items)]
  if ((order.items || []).length > 15) lines.push(`… และอีก ${order.items.length - 15} รายการ`)
  lines.push(`${where(order)} · ${dateTime(order.pickupAt)}`)
  lines.push(`ยอดรวม ${money(totals.total)} บาท`)
  if (totals.balance > 0.004) lines.push(`ค้างชำระ ${money(totals.balance)} บาท`)
  return lines.join('\n')
}

export function quoteCardText(quote, totals, shopName = '') {
  const p = quote.payload || {}
  const lines = [`${shopName ? shopName + ' · ' : ''}ใบเสนอราคา ${quote.code || ''}`.trim(), ...itemLines(p.items)]
  lines.push(`${where(p)} · ${dateTime(p.pickupAt)}`)
  if (p.shippingFee) lines.push(`ค่าส่ง ${money(p.shippingFee)} บาท`)
  lines.push(`ยอดรวม ${money(totals.total)} บาท`)
  lines.push('กดปุ่มด้านล่างเพื่อยืนยันสั่ง หรือขอแก้ไขได้เลยค่ะ')
  return lines.join('\n')
}

// ---------- การ์ด Messenger (generic template) ----------
// หัวข้อ/บรรทัดรองของการ์ดยาวได้ไม่เกิน 80 ตัวอักษร → รายการสินค้าส่งเป็นข้อความนำหน้าการ์ด
const clip = (s, n = 80) => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v }
const detailLines = (o, items) => {
  const lines = itemLines(items)
  if ((items || []).length > 15) lines.push(`… และอีก ${items.length - 15} รายการ`)
  lines.push(`${where(o)} · ${dateTime(o.pickupAt)}`)
  return lines.join('\n')
}
// → { text: ข้อความนำ, card: { kind, title, subtitle, image?, url?, pay? } }
// opts: { image: https ของรูปบนการ์ด (ไม่มี = ไม่ใส่รูป), url: ลิงก์ออร์เดอร์สำหรับปุ่ม "ดูออร์เดอร์" }
const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\/\S+$/i.test(u) && u.length <= 500 ? u : '')
export function orderCardMsg(order, totals, shopName = '', opts = {}) {
  const owe = totals.balance > 0.004
  const sub = [`ยอดรวม ${money(totals.total)}`, owe ? `ค้างชำระ ${money(totals.balance)}` : 'ชำระครบแล้ว'].join(' · ')
  const url = httpsOnly(opts.url)
  return { text: detailLines(order, order.items), card: { kind: 'order', title: clip(`ออร์เดอร์ ${order.code || ''}`), subtitle: clip(sub), ...(httpsOnly(opts.image) ? { image: opts.image } : {}), ...(url ? { url, pay: owe } : {}) } }
}
export function quoteCardMsg(quote, totals, shopName = '', opts = {}) {
  const p = quote.payload || {}
  const sub = [`ยอดรวม ${money(totals.total)}`, p.shippingFee ? `รวมค่าส่ง ${money(p.shippingFee)}` : ''].filter(Boolean).join(' · ')
  return { text: detailLines(p, p.items), card: { kind: 'quote', title: clip(`ใบเสนอราคา ${quote.code || ''}`), subtitle: clip(sub), ...(httpsOnly(opts.image) ? { image: opts.image } : {}) } }
}
export function linkCardMsg(order, url, shopName = '', opts = {}) {
  return { text: '', card: { kind: 'link', title: clip(`ออร์เดอร์ ${order.code || ''}`), subtitle: 'เปิดดูสถานะออร์เดอร์ (ดูอย่างเดียว)', url, ...(httpsOnly(opts.image) ? { image: opts.image } : {}) } }
}
// การ์ด "ได้รับชำระ": หัวข้อ = ยอดที่ชำระครั้งนี้ · บรรทัดรอง = ชำระแล้ว/คงค้าง · ปุ่มดูออร์เดอร์ (ถ้ามีลิงก์) → คืนเฉพาะ card
export function payCard(order, totals, { paid = null, url = '', image = '' } = {}) {
  const owe = totals.balance > 0.004
  const sub = owe ? `ชำระแล้ว ${money(totals.paid)} · คงค้าง ${money(totals.balance)}` : `ชำระครบ ${money(totals.total)} แล้ว ขอบคุณค่ะ`
  const link = httpsOnly(url)
  return { kind: 'order', title: clip(`${paid != null ? `ได้รับชำระ ${money(paid)}` : 'ได้รับชำระ'} · ${order.code || ''}`), subtitle: clip(sub), ...(httpsOnly(image) ? { image } : {}), ...(link ? { url: link, pay: owe } : {}) }
}
