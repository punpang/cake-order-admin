// เทียบเลขบัญชีผู้รับบนสลิป (OCR อ่านได้ อาจปิดบางหลัก) กับเลขบัญชีธนาคารของร้าน · ใช้แสดงเครื่องหมายถูกเท่านั้น
// สลิปปิดตัวเลขด้วย x / X / * / % (OCR อ่านตัวปิดเป็นอักขระอื่นได้) · ตรงเมื่อ:
//   1) จำนวนตำแหน่ง (ตัวเลขและตัวปิด ไม่นับขีดและช่องว่าง) เท่ากับเลขบัญชีร้าน
//   2) ทุกตำแหน่งที่เห็นเป็นตัวเลขบนสลิปตรงกับเลขบัญชีร้าน
//   3) เห็นตัวเลขอย่างน้อย 4 หลัก
// ไม่ตรง หรืออ่านไม่ได้ = false
const MASK = /[xX*%]/

export function slipAccountMatches(slipAcc, shopAccNos = []) {
  const s = String(slipAcc ?? '').replace(/[\s-]/g, '')
  if (!/^[0-9xX*%]+$/.test(s) || !/[0-9]/.test(s)) return false
  return (shopAccNos || []).some((no) => {
    const d = String(no ?? '').replace(/\D/g, '')
    if (!d || d.length !== s.length) return false
    let visible = 0
    for (let i = 0; i < s.length; i++) {
      if (MASK.test(s[i])) continue
      if (s[i] !== d[i]) return false
      visible++
    }
    return visible >= 4
  })
}
