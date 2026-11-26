// ใบกำกับภาษีเต็มรูปของสั่งล่วงหน้า (ฟังก์ชันล้วน) — ใช้ร่วมกับ Edge Function preorder-admin (action issue_invoice)
// กติกาออกใบตามกติกาเดียวกับออร์เดอร์ปกติ (taxInvoice.js) แต่ไม่มีกรอบเวลาของลูกค้า เพราะพนักงานเป็นผู้ออก
// ดู docs/superpowers/specs/2026-11-26-preorder-tax-invoice-design.md
import { orderTotals } from './pricing.js'
import { buyerError, sellerCheck, cleanBuyer } from './taxInvoice.js'

// ใบที่ยังไม่ถูกยกเลิกของออร์เดอร์นี้ (ไม่มี voidedBy) · ใช้ตรวจว่าเคยออกแล้วหรือยัง
export function activeInvoiceOf(invoices) {
  return (invoices || []).find((i) => i.type === 'invoice' && !i.voidedBy) || null
}

// '' เมื่อออกใบได้ หรือข้อความภาษาไทยที่แสดงให้พนักงาน
// order = ออร์เดอร์ที่รวมฟิลด์จาก data แล้ว (items, payments, fulfillment ฯลฯ) · invoices = ใบทั้งหมดของออร์เดอร์นี้
export function preorderInvoiceBlock(order, invoices, buyer, seller) {
  if (!order) return 'ไม่พบออร์เดอร์'
  if (order.status !== 'delivered') return 'ออกใบกำกับภาษีได้เมื่อส่งมอบแล้วเท่านั้น'
  if (!(Number(order.vat?.rate) > 0)) return 'ออร์เดอร์นี้ไม่ได้คิดภาษีมูลค่าเพิ่ม'
  if (orderTotals(order).balance > 0.004) return 'ชำระยังไม่ครบ ออกใบกำกับภาษีไม่ได้'
  if (activeInvoiceOf(invoices)) return 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว'
  const sellerErr = sellerCheck(seller)
  if (sellerErr) return sellerErr
  return buyerError(cleanBuyer(buyer))
}
