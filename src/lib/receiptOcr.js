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
  /รวม|total|ยอด/i,
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

// VAT: บรรทัดที่มี VAT และมีจำนวนเงินทศนิยม 2 ตำแหน่ง (ไม่เอาเลขผู้เสียภาษี/ไม่เอายอดก่อน VAT)
function vatOf(lines) {
  for (const l of lines) {
    if (!/vat|ภาษีมูลค่าเพิ่ม/i.test(l) || /ไม่รวม|ก่อน|ฐาน|excl|included|tax|#|เลขประจำตัว/i.test(l)) continue
    const hits = l.match(/\d{1,3}(?:,\d{3})*\.\d{2}/g)
    if (!hits) continue
    const v = Number(hits[hits.length - 1].replace(/,/g, ''))
    if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100
  }
  return null
}

// ปีที่เป็นไปได้ของเลขปี: ค.ศ. 4 หลัก · พ.ศ. 4 หลัก (>2400) · ปี 2 หลักถือเป็น พ.ศ. ก่อน (เช่น 69 = 2569) แล้วค่อยลองเป็น ค.ศ.
// เลือกเฉพาะปีที่อยู่ในช่วง ±2 ปีจากวันนี้ ถ้าเลือกไม่ได้ (หรือได้มากกว่าหนึ่ง) คืน null
const YEAR_WINDOW = 1
export function dateOf(text, today = new Date()) {
  const m = String(text).match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  const raw = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const cands = raw > 2400 ? [raw - 543] : raw < 100 ? [raw + 1957, raw + 2000] : [raw]
  const nowY = today.getUTCFullYear()
  const ok = []
  for (const y of cands) {
    if (Math.abs(y - nowY) > YEAR_WINDOW) continue
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dt = new Date(`${iso}T00:00:00Z`)
    if (!Number.isNaN(dt.getTime()) && dt.getUTCDate() === d) ok.push(iso)
  }
  return ok.length === 1 ? ok[0] : null
}

// เลขผู้เสียภาษี 13 หลัก ต้องผ่านการตรวจหลักสุดท้าย (checksum) เพื่อกันการอ่านเลขอื่นผิดเป็นเลขภาษี
export function validTaxId(id) {
  if (!/^\d{13}$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(id[12])
}

function taxIdOf(text) {
  const m = text.match(/(?:เลขประจำตัวผู้เสียภาษี|เลขผู้เสียภาษี|tax\s*id|tax\s*#)[^\d]{0,20}((?:\d[\s-]?){12}\d)/i)
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

// ชื่อร้าน: บรรทัดแรกที่ส่วนใหญ่เป็นตัวอักษร (ไม่ใช่สัญลักษณ์เพี้ยนจาก OCR) และไม่ใช่หัวข้อเอกสาร/เบอร์โทร (ผู้ใช้แก้ได้)
const NOT_PAYEE = /ใบเสร็จ|ใบกำกับ|receipt|invoice|tax|โทร|tel|สาขา|วันที่|date|เลขที่|vat|รวม|total/i
function payeeOf(lines) {
  for (const l of lines.slice(0, 5)) {
    const raw = l.trim()
    const letters = (raw.match(/[ก-๙A-Za-z]/g) || []).length
    const nonSpace = raw.replace(/\s/g, '').length
    const symbols = nonSpace - (raw.match(/[ก-๙A-Za-z0-9]/g) || []).length
    const s = raw.replace(/^[^ก-๙A-Za-z0-9]+/, '').trim()
    if (s.length < 2 || s.length > 80) continue
    if (letters < 6 || symbols > nonSpace * 0.3 || NOT_PAYEE.test(s)) continue
    return s
  }
  return null
}

// คืน { date, total, vat, payee, taxId, taxInvoiceNo } · ทุกช่องเป็น null ถ้าไม่พบ
// today ใช้ตรวจช่วงปีของวันที่ (ค่าเริ่มต้น = วันนี้)
export function parseReceipt(text, today = new Date()) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return {
    date: dateOf(text || '', today),
    total: totalOf(lines),
    vat: vatOf(lines),
    payee: payeeOf(lines),
    taxId: taxIdOf(text || ''),
    taxInvoiceNo: invoiceNoOf(lines),
  }
}

const empty = (v) => v === undefined || v === null || String(v).trim() === '' || Number(v) === 0

// ค่าที่ควรเติมลงฟอร์มค่าใช้จ่าย · ไม่เขียนทับช่องที่ผู้ใช้กรอกแล้ว · ไม่เติมค่าที่ไม่แน่ใจ
// VAT: ตั้งเป็น "รวม VAT แล้ว" เฉพาะเมื่อ VAT ที่อ่านได้ตรงกับยอด×อัตรา/(100+อัตรา) ไม่เกิน 1 บาท และผู้ใช้ยังไม่ได้เลือก VAT
// คืน patch (object) ที่จะนำไปรวมกับฟอร์ม · ว่างถ้าไม่มีอะไรควรเติม
export function receiptFill(form, parsed, { vatRate = 7 } = {}) {
  const patch = {}
  if (parsed?.date) patch.date = parsed.date
  if (empty(form?.amount) && parsed?.total != null) patch.amount = String(parsed.total)
  if (empty(form?.payee) && parsed?.payee) patch.payee = parsed.payee
  if (empty(form?.taxInvoiceNo) && parsed?.taxInvoiceNo) patch.taxInvoiceNo = parsed.taxInvoiceNo
  if (empty(form?.payeeTaxId) && parsed?.taxId) patch.payeeTaxId = parsed.taxId
  const rate = Number(vatRate) || 7
  if ((form?.vatMode || 'none') === 'none' && parsed?.total != null && parsed?.vat != null) {
    const expected = (parsed.total * rate) / (100 + rate)
    if (Math.abs(expected - parsed.vat) <= 1) {
      patch.vatMode = 'included'
      patch.vatRate = rate
    }
  }
  return patch
}
