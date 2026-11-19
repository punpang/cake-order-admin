// แปลงใบเสนอ ↔ แถว punpang_quotes (แยกจาก chatSync.js ให้โมดูลที่ใช้แค่ตัวแปลงไม่ดึงตัวซิงก์แชททั้งชุดเข้าไฟล์หลัก)
export function quoteToRow(q) {
  const { id, code, chatId, customerId, status, orderId, ...rest } = q
  return { id, code, chat_id: chatId, customer_id: customerId || null, status, order_id: orderId || null, data: rest }
}
export function rowToQuote(r) {
  return { ...(r.data || {}), id: r.id, code: r.code, chatId: r.chat_id, customerId: r.customer_id || null, status: r.status, orderId: r.order_id || null }
}
