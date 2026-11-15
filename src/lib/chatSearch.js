const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '')

// ค้นแชทจากข้อมูลที่เกี่ยวข้อง: ชื่อใน Facebook, ชื่อลูกค้า, เบอร์โทร, เลขออร์เดอร์ (OR-…), เลขใบเสนอ (QT-…)
// สร้างดัชนีข้อความต่อแชทครั้งเดียวต่อการค้น (ตัวพิมพ์เล็ก + เบอร์เป็นตัวเลขล้วน) แล้วเทียบด้วย includes
const lc = (v) => String(v ?? '').toLowerCase()

export function buildChatIndex(chats, customers, orders, quotes) {
  const cu = new Map(customers.map((c) => [c.id, c]))
  const ordersByCustomer = new Map()
  const orderCode = new Map(orders.map((o) => [o.id, o.code]))
  for (const o of orders) {
    if (!o.customerId) continue
    if (!ordersByCustomer.has(o.customerId)) ordersByCustomer.set(o.customerId, [])
    ordersByCustomer.get(o.customerId).push(o.code)
  }
  const quotesByChat = new Map()
  const quotesByCustomer = new Map()
  for (const q of quotes) {
    if (q.chatId) { if (!quotesByChat.has(q.chatId)) quotesByChat.set(q.chatId, []); quotesByChat.get(q.chatId).push(q.code) }
    if (q.customerId) { if (!quotesByCustomer.has(q.customerId)) quotesByCustomer.set(q.customerId, []); quotesByCustomer.get(q.customerId).push(q.code) }
  }
  const index = new Map()
  for (const c of chats) {
    const parts = [c.profileName, c.externalId]
    const k = c.customerId ? cu.get(c.customerId) : null
    if (k) parts.push(k.name, k.phone, digitsOnly(k.phone))
    if (k) parts.push(...(ordersByCustomer.get(k.id) || []), ...(quotesByCustomer.get(k.id) || []))
    parts.push(...(quotesByChat.get(c.id) || []))
    for (const m of c.messages || []) if (m?.orderId && orderCode.has(m.orderId)) parts.push(orderCode.get(m.orderId))
    index.set(c.id, lc(parts.filter(Boolean).join(' ')) + ' ' + digitsOnly(parts.join(' ')))
  }
  return index
}

// ตรงตามคำค้นหรือไม่ (คำค้นที่เป็นเบอร์ ใช้ตัวเลขเทียบได้ไม่ว่าพิมพ์ขีดหรือไม่)
export function chatMatchesQuery(index, chatId, query) {
  const s = lc(query).trim()
  if (!s) return true
  const hay = index.get(chatId) || ''
  if (hay.includes(s)) return true
  const d = digitsOnly(s)
  return d.length >= 3 && hay.includes(d)
}

// คีย์สำหรับค้นแชทบนเซิร์ฟเวอร์ (แชทนอกชุดล่าสุด): ลูกค้า/ออร์เดอร์/ใบเสนอที่ตรงคำค้น ซึ่งข้อมูลเหล่านี้ดึงไว้ในเครื่องครบแล้ว
export function remoteSearchKeys(q, customers, orders, quotes) {
  const s = lc(q).trim()
  const d = digitsOnly(s)
  const customerIds = new Set()
  if (!s) return { customerIds: [], chatIds: [] }
  for (const c of customers) {
    if (c.deleted) continue
    if (lc(c.name).includes(s) || (d && digitsOnly(c.phone).includes(d))) customerIds.add(c.id)
  }
  for (const o of orders) if (o.customerId && lc(o.code).includes(s)) customerIds.add(o.customerId)
  const chatIds = (quotes || []).filter((x) => x.chatId && lc(x.code).includes(s)).map((x) => x.chatId)
  return { customerIds: [...customerIds], chatIds: [...new Set(chatIds)] }
}
