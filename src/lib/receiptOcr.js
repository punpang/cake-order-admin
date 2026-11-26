// อ่านข้อมูลจากข้อความใบเสร็จ/ใบกำกับภาษี (ฟังก์ชันล้วน ไม่มีการเรียกเครือข่าย)
// คืนค่าเป็น null ทุกช่องที่หาไม่พบหรือไม่แน่ใจ · ไม่เดาค่า · ผู้ใช้ต้องตรวจก่อนบันทึกเสมอ

const AMOUNT = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+/g

// ยอดเงินตัวสุดท้ายในบรรทัด (แปลงเป็นบาท 2 ตำแหน่ง) · ไม่พบ = null
function lastAmount(line) {
  const hits = line.match(AMOUNT)
  if (!hits) return null
  const n = Number(hits[hits.length - 1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

// ยอดรวม: เลือกคำที่แม่นกว่าก่อน (ยอดสุทธิ/รวมทั้งสิ้น) แล้วจึงใช้คำทั่วไป
const TOTAL_KEYS = [
  /ยอดสุทธิ|รวมทั้งสิ้น|ยอดชำระ|ยอดที่ต้องชำระ|grand\s*total|total\s*amount/i,
  /รวม|total/i,
]
const NOT_TOTAL = /จำนวน|ก่อน|vat|ส่วนลด|ภาษี|ทอน|รับ/i
function totalOf(lines) {
  for (const re of TOTAL_KEYS) {
    for (const l of lines) {
      if (!re.test(l) || (re !== TOTAL_KEYS[0] && NOT_TOTAL.test(l))) continue
      const v = lastAmount(l)
      if (v != null) return v
    }
  }
  return null
}

// VAT: บรรทัดที่มี VAT หรือภาษีมูลค่าเพิ่ม (ไม่ใช่ยอดก่อน VAT / ภาษีที่คำนวณจากยอดรวม)
function vatOf(lines) {
  for (const l of lines) {
    if (!/vat|ภาษีมูลค่าเพิ่ม/i.test(l) || /ไม่รวม|ก่อน|ฐาน|excl/i.test(l)) continue
    const v = lastAmount(l)
    if (v != null) return v
  }
  return null
}

// วันที่ dd/mm/yy(yy) หรือ dd-mm-yy(yy) · ปี พ.ศ. (>2400) แปลงเป็น ค.ศ. · คืน YYYY-MM-DD หรือ null
// หมายเหตุ: รองรับเฉพาะรูปแบบตัวเลข (ไม่รองรับชื่อเดือนภาษาไทย)
export function dateOf(text) {
  const m = String(text).match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = Number(m[3])
  if (y < 100) y += 2000
  if (y > 2400) y -= 543
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const dt = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== d) return null
  return iso
}

// เลขผู้เสียภาษี 13 หลัก ต้องผ่านการตรวจหลักสุดท้าย (checksum) เพื่อกันการอ่านเลขอื่นผิดเป็นเลขภาษี
export function validTaxId(id) {
  if (!/^\d{13}$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(id[12])
}

function taxIdOf(text) {
  const m = text.match(/(?:เลขประจำตัวผู้เสียภาษี|เลขผู้เสียภาษี|tax\s*id)[^\d]{0,20}((?:\d[\s-]?){12}\d)/i)
  if (!m) return null
  const id = m[1].replace(/\D/g, '')
  return validTaxId(id) ? id : null
}

// เลขที่ใบกำกับภาษี: เฉพาะบรรทัดที่มีคำว่าใบกำกับ/Tax Invoice และมีเลขตามหลัง
function invoiceNoOf(lines) {
  for (const l of lines) {
    if (!/ใบกำกับ|tax\s*invoice/i.test(l)) continue
    const m = l.match(/(?:เลขที่|no\.?|#)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,39})/i)
    if (m) return m[1]
  }
  return null
}

// ชื่อร้าน: บรรทัดแรกที่มีตัวอักษร ไม่ใช่หัวข้อเอกสาร/ที่อยู่/เบอร์โทร (ผู้ใช้แก้ได้)
const NOT_PAYEE = /ใบเสร็จ|ใบกำกับ|receipt|invoice|tax|โทร|tel|สาขา|วันที่|date|เลขที่|vat|รวม|total/i
function payeeOf(lines) {
  for (const l of lines.slice(0, 5)) {
    const s = l.trim()
    if (s.length < 2 || s.length > 80) continue
    if (!/[ก-๙A-Za-z]/.test(s) || NOT_PAYEE.test(s)) continue
    return s
  }
  return null
}

// คืน { date, total, vat, payee, taxId, taxInvoiceNo } · ทุกช่องเป็น null ถ้าไม่พบ
export function parseReceipt(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return {
    date: dateOf(text || ''),
    total: totalOf(lines),
    vat: vatOf(lines),
    payee: payeeOf(lines),
    taxId: taxIdOf(text || ''),
    taxInvoiceNo: invoiceNoOf(lines),
  }
}
