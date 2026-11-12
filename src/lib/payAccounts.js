// บัญชีรับชำระที่แสดงให้ลูกค้า (ฟังก์ชันล้วน) · รายการไม่จำกัด แต่ละรายการเปิด/ปิดการแสดงได้
// รูปแบบเดิม (promptpayId + bank/accountNo ตัวเดียว) แปลงเป็นรายการอัตโนมัติ
import { bankByCode } from './payFields.js'
import { promptPayKind } from './promptpay.js'

const digits = (v) => String(v ?? '').replace(/\D/g, '')
const txt = (v, n) => String(v ?? '').trim().slice(0, n)
export const newPayAccountId = () => `pa${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ทำความสะอาดบัญชีหนึ่งรายการ · คืน null เมื่อข้อมูลไม่ครบ
export function sanitizePayAccount(a) {
  if (!a || typeof a !== 'object') return null
  const id = txt(a.id, 40) || newPayAccountId()
  const show = a.show !== false
  if (a.kind === 'promptpay') {
    const promptpayId = digits(a.promptpayId)
    if (!promptPayKind(promptpayId)) return null
    return { id, kind: 'promptpay', show, promptpayId, accountName: txt(a.accountName, 80) }
  }
  if (a.kind === 'bank') {
    const code = txt(a.bankCode, 3)
    const known = bankByCode(code)
    const bankName = known ? known.name : txt(a.bankName, 60)
    const accountNo = digits(a.accountNo).slice(0, 20)
    if (!bankName || !accountNo) return null
    return { id, kind: 'bank', show, bankCode: known ? code : '', bankName, accountNo, accountName: txt(a.accountName, 80) }
  }
  return null
}

// รายการบัญชีทั้งหมด (รองรับรูปแบบเดิมของ payment)
export function payAccountsOf(payment) {
  const p = payment || {}
  if (Array.isArray(p.accounts)) return p.accounts.map(sanitizePayAccount).filter(Boolean)
  const out = []
  if (p.promptpayId) out.push({ id: 'pa-legacy-pp', kind: 'promptpay', show: true, promptpayId: digits(p.promptpayId), accountName: txt(p.accountName, 80) })
  if (p.accountNo || p.bank) out.push({ id: 'pa-legacy-bank', kind: 'bank', show: true, bankCode: '', bankName: txt(p.bank, 60), accountNo: digits(p.accountNo).slice(0, 20), accountName: txt(p.accountName, 80) })
  return out
}

// สำเนาสำหรับฟอร์มแก้ไข (ไม่ใช้อ้างอิงเดียวกับ db)
export const clonePayment = (payment) => ({ note: String(payment?.note ?? ''), accounts: payAccountsOf(payment).map((a) => ({ ...a })) })

// บัญชีที่เปิดแสดงให้ลูกค้า
export const visiblePayAccounts = (payment) => payAccountsOf(payment).filter((a) => a.show)

// ข้อความตรวจก่อนบันทึก (ฟอร์มแก้ไข) · '' เมื่อถูกต้อง
export function validatePayAccount(a) {
  if (!a) return 'ข้อมูลบัญชีไม่ครบ'
  if (a.kind === 'promptpay') return promptPayKind(digits(a.promptpayId)) ? '' : 'เลขพร้อมเพย์ไม่ถูกต้อง (เบอร์มือถือ 10 หลัก / เลข 13 หลัก / e-Wallet 15 หลัก)'
  if (a.kind === 'bank') {
    if (!txt(a.bankName, 60)) return 'เลือกธนาคารของบัญชีนี้'
    const n = digits(a.accountNo).length
    if (n < 6 || n > 20) return `เลขบัญชี ${txt(a.bankName, 60)} ต้องมีตัวเลข 6–20 หลัก`
    return ''
  }
  return 'ประเภทบัญชีไม่ถูกต้อง'
}
