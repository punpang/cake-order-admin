// เทียบเลขที่บัญชีผู้รับบนสลิป (OCR อ่านได้ อาจปิดบางหลัก) กับเลขบัญชีของร้าน · ใช้แสดงเครื่องหมายถูกหรือเตือนเท่านั้น
// สลิปปิดตัวเลขด้วย x / X / * / % หรือจุด • (OCR อ่านตัวปิดเป็นอักขระอื่นได้) · เทียบได้เมื่อ:
//   1) จำนวนหลัก (ตัวเลขและตัวปิด ไม่นับขีดและช่องว่าง) เท่ากับจำนวนหลักของบัญชีร้าน
//   2) เห็นตัวเลขอย่างน้อย 4 หลัก
// เทียบตามตำแหน่ง: ทุกหลักที่เห็นต้องตรงกับหลักเดียวกันของบัญชีร้าน (ตัวปิดไม่ต้องตรง)
// ผล: 'match' ตรงกับบัญชีร้านอย่างน้อยหนึ่งรายการ · 'mismatch' เทียบได้แต่ไม่ตรงกับบัญชีใดเลย · 'unknown' เทียบไม่ได้ → ไม่แสดงอะไร
const MASK = /[xX*%•]/
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '')

export function slipAccountCheck(slipAcc, { bank = [], promptpay = [] } = {}) {
  const s = String(slipAcc ?? '').replace(/[\s-]/g, '')
  if (!/^[0-9xX*%•]+$/.test(s)) return 'unknown'
  if ([...s].filter((c) => !MASK.test(c)).length < 4) return 'unknown'
  const same = [...(bank || []), ...(promptpay || [])].map(digitsOf).filter((d) => d.length === s.length)
  if (!same.length) return 'unknown'
  const ok = same.some((d) => [...s].every((c, i) => MASK.test(c) || c === d[i]))
  return ok ? 'match' : 'mismatch'
}
