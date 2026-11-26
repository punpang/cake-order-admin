// ฟอร์มผู้ซื้อสำหรับออกใบกำกับภาษีของสั่งล่วงหน้า (ฟังก์ชันล้วน) · ใช้กติกาเดียวกับ taxInvoice.js
// คืน { error } เมื่อกรอกไม่ถูก หรือ { payload } ที่ส่งให้ preorder-admin (action issue_invoice)
import { cleanBuyer, buyerError } from './taxInvoice.js'

export const EMPTY_ISSUE_FORM = { name: '', taxId: '', branch: '00000', address: '' }

export function buildIssuePayload(orderId, form) {
  if (!orderId) return { error: 'ไม่พบออร์เดอร์' }
  const buyer = cleanBuyer(form)
  const err = buyerError(buyer)
  if (err) return { error: err }
  return { payload: { orderId, buyer } }
}
