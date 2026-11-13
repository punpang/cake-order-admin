// เทียบเลขบัญชีผู้รับบนสลิป (OCR อ่านได้ อาจปิดบางหลัก) กับบัญชีของร้าน · ใช้แสดงเครื่องหมายถูกหรือเตือนเท่านั้น
// สลิปปิดตัวเลขด้วย x / X / * / % (OCR อ่านตัวปิดเป็นอักขระอื่นได้) · ผลมี 3 แบบ:
//   'match'    ตรงกับบัญชีธนาคารหรือพร้อมเพย์ของร้านอย่างน้อยหนึ่งรายการ
//   'mismatch' เทียบได้ (เห็นตัวเลข 4 หลักขึ้นไป) แต่ไม่ตรงกับบัญชีใดของร้าน
//   'unknown'  เทียบไม่ได้ (อ่านตัวเลขไม่พอ / ไม่ใช่รูปแบบเลข / ร้านยังไม่ได้ตั้งบัญชี) → ไม่แสดงอะไร
// บัญชีธนาคาร: เทียบจากซ้าย ต้องจำนวนหลักเท่ากัน · พร้อมเพย์ (เบอร์หรือเลขประจำตัว): เทียบจากขวา เพราะสลิปมักปิดด้านซ้าย
const MASK = /[xX*%]/
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '')

function alignLeft(s, d) {
  if (!d || d.length !== s.length) return false
  for (let i = 0; i < s.length; i++) {
    if (!MASK.test(s[i]) && s[i] !== d[i]) return false
  }
  return true
}

function alignRight(s, p) {
  if (!p) return false
  const off = p.length - s.length
  for (let i = 0; i < s.length; i++) {
    if (MASK.test(s[i])) continue
    const j = i + off
    if (j < 0 || s[i] !== p[j]) return false
  }
  return true
}

export function slipAccountCheck(slipAcc, { bank = [], promptpay = [] } = {}) {
  const s = String(slipAcc ?? '').replace(/[\s-]/g, '')
  if (!/^[0-9xX*%]+$/.test(s)) return 'unknown'
  const visible = [...s].filter((c) => !MASK.test(c)).length
  if (visible < 4) return 'unknown'
  const banks = bank || []
  const pps = promptpay || []
  const ok = banks.some((no) => alignLeft(s, digitsOf(no))) || pps.some((id) => alignRight(s, digitsOf(id)))
  if (ok) return 'match'
  return banks.length + pps.length ? 'mismatch' : 'unknown'
}
