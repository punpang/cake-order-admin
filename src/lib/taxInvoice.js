// ใบกำกับภาษีเต็มรูปฝั่งลูกค้า (ฟังก์ชันล้วน) — ใช้ร่วมกันทั้งแอป (แสดงสถานะ/ตรวจเบื้องต้น) และ Edge Function tax-invoice (ตัดสินและบันทึกจริงที่เซิร์ฟเวอร์)
// กติกาเหมือนหลังบ้าน (acct.js) · ต่างที่ข้อความที่ลูกค้าเห็น และเลขที่/รหัสเอกสารที่ฐานข้อมูลเป็นผู้กำหนด
import { orderTotals } from './pricing.js'
import { invoiceDeadline, invoiceWindowOpen } from './acct/taxWindow.js'
import { validTaxId, validBranch } from './acct/taxid.js'
import { bahtText } from './acct/thaiBaht.js'
import { toB, toS } from './acct/money.js'

export const MAX_CUSTOMER_REVISIONS = 3
// ข้อความที่ลูกค้าเห็นเมื่อข้อมูลร้านยังไม่พร้อม (ไม่พูดถึงหน้าตั้งค่าของพนักงาน)
export const CUSTOMER_SELLER_MSG = 'ร้านยังไม่พร้อมออกใบกำกับภาษี กรุณาติดต่อร้านเพื่อขอใบ'

// วันที่ชำระ (YYYY-MM-DD) จากการยืนยันชำระล่าสุด · ไม่มี = ''
export function paidDateOf(order) {
  const ps = (order.payments || []).filter((p) => p.status === 'confirmed')
  const last = ps.map((p) => String(p.confirmedAt || p.paidAt || '').slice(0, 10)).filter(Boolean).sort().at(-1)
  return last || ''
}

// ข้อมูลผู้ซื้อที่บันทึกได้ (เลขและสาขาเหลือเฉพาะตัวเลข)
export function cleanBuyer(buyer) {
  const b = buyer || {}
  return {
    name: String(b.name || '').trim().slice(0, 120),
    taxId: String(b.taxId || '').replace(/\D/g, ''),
    branch: String(b.branch || '00000').replace(/\D/g, ''),
    address: String(b.address || '').trim().slice(0, 300),
  }
}

export function buyerError(b) {
  if (!String(b.name || '').trim()) return 'ไม่มีชื่อผู้ซื้อ'
  if (!validTaxId(b.taxId)) return 'เลขประจำตัวผู้เสียภาษีผู้ซื้อไม่ถูกต้อง (13 หลัก)'
  if (!validBranch(b.branch)) return 'รหัสสาขาผู้ซื้อต้อง 5 หลัก (สำนักงานใหญ่ = 00000)'
  if (!String(b.address || '').trim()) return 'ไม่มีที่อยู่ผู้ซื้อ'
  return ''
}

// ความพร้อมของข้อมูลผู้ขาย (ตั้งค่าร้าน → VAT) · '' เมื่อพร้อม หรือข้อความสำหรับพนักงาน
export function sellerCheck(vat) {
  const v = vat || {}
  if (!v.enabled) return 'ร้านยังไม่เปิดใช้ VAT'
  if (!validTaxId(v.taxId)) return 'เลขประจำตัวผู้เสียภาษีของร้านไม่ถูกต้อง (ตั้งค่าร้าน → VAT)'
  if (!String(v.legalName || '').trim() || !String(v.address || '').trim()) return 'กรอกชื่อและที่อยู่ผู้ประกอบการในตั้งค่า VAT ก่อน'
  return ''
}

// สถานะการขอ/แก้ใบของลูกค้า 1 ออร์เดอร์ · invoices = ใบทั้งหมดของออร์เดอร์นี้ (รวมใบลดหนี้และใบที่ถูกยกเลิกแล้ว)
// todayStr = วันนี้ตามเวลาไทย (YYYY-MM-DD) ส่งเข้ามาเพื่อให้ผลเหมือนกันทั้งเครื่องและเซิร์ฟเวอร์
export function customerInvoiceState(order, invoices, todayStr) {
  const history = (invoices || []).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  const invoice = history.find((i) => i.type === 'invoice' && !i.voidedBy) || null
  const paid = paidDateOf(order)
  const deadline = invoiceDeadline(paid)
  const base = { deadline, invoice, history }
  if (!order.vat || !(Number(order.vat.rate) > 0)) return { ...base, eligible: false, reason: 'ออร์เดอร์นี้ไม่ได้คิดภาษีมูลค่าเพิ่ม' }
  if (order.status === 'cancelled' || order.status === 'draft') return { ...base, eligible: false, reason: 'ออร์เดอร์นี้ออกใบกำกับภาษีไม่ได้' }
  if (orderTotals(order).balance > 0.004) return { ...base, eligible: false, reason: 'ชำระยังไม่ครบ ขอใบกำกับภาษีได้เมื่อชำระครบ' }
  if (!invoiceWindowOpen(paid, todayStr)) return { ...base, eligible: false, reason: `เลยกำหนดขอ/แก้ใบกำกับภาษีเอง (ภายใน ${deadline}) กรุณาติดต่อร้าน` }
  const left = Math.max(0, MAX_CUSTOMER_REVISIONS - (invoice?.rev || 0))
  return { ...base, eligible: true, reason: '', canEdit: !!invoice && left > 0, revisionsLeft: left }
}

// ตรวจก่อนขอ (edit = false) หรือแก้ (edit = true) ใบ · คืน '' เมื่อผ่าน หรือข้อความที่แสดงให้ลูกค้า
export function customerIssueBlock(order, invoices, buyer, seller, todayStr, { edit = false } = {}) {
  const st = customerInvoiceState(order, invoices, todayStr)
  if (!st.eligible) return st.reason
  if (!edit && st.invoice) return 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว'
  if (edit && !st.invoice) return 'ยังไม่มีใบกำกับภาษี'
  if (edit && !st.canEdit) return `แก้ไขได้ไม่เกิน ${MAX_CUSTOMER_REVISIONS} ครั้ง กรุณาติดต่อร้าน`
  if (!(orderTotals(order).vat > 0)) return 'ไม่มี VAT ในออร์เดอร์นี้'
  if (sellerCheck(seller)) return CUSTOMER_SELLER_MSG
  return buyerError(cleanBuyer(buyer))
}

// ใบกำกับภาษี 1 ใบ (รูปแบบเดียวกับที่บันทึกในตาราง punpang_acct_invoices · เลขที่ฐานข้อมูลใส่ให้หลังบันทึก)
export function buildInvoice({ order, seller, buyer, id, by, rev = 0, date, createdAt }) {
  const t = orderTotals(order)
  const lines = [
    ...order.items.map((i) => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice, amount: toB(toS(i.unitPrice) * i.qty) })),
    ...(t.shipping ? [{ name: 'ค่าจัดส่ง', qty: 1, unitPrice: t.shipping, amount: t.shipping }] : []),
  ]
  return {
    id, no: '', type: 'invoice', date, orderId: order.id, orderCode: order.code,
    seller: { name: seller.legalName, taxId: seller.taxId, branch: seller.branch || '00000', address: seller.address },
    buyer: cleanBuyer(buyer), lines,
    discounts: t.discountLines.map((d) => ({ label: d.label, amount: d.amount })),
    rate: t.vatRate, mode: t.vatMode, beforeVat: toB(toS(t.total) - toS(t.vat)), vat: t.vat, total: t.total,
    totalText: bahtText(t.total), copies: 0, by, rev, createdAt,
  }
}

// ใบลดหนี้เต็มจำนวนอ้างใบเดิม (ใช้ตอนลูกค้าแก้ไขข้อมูลผู้ซื้อ) · ใบเดิมไม่ถูกลบ
export function buildCreditNote({ inv, id, date, reason, by, createdAt }) {
  const cn = { ...inv }
  delete cn.voidedBy
  return { ...cn, id, no: '', type: 'credit', date, refNo: inv.no, refId: inv.id, reason: String(reason || '').trim().slice(0, 200), copies: 0, by, createdAt }
}
