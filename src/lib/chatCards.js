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
