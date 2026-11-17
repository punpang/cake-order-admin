// จำนวนเงินเป็นตัวอักษรไทย (ใช้ในใบกำกับภาษี)
const D = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']
// อ่านเลขไม่เกิน 6 หลัก · higher = มีหลักที่สูงกว่าอยู่ก่อนหน้า (ให้เลข 1 หลักหน่วยอ่านว่า "เอ็ด")
function group(n, higher = false) {
  const s = String(n)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i])
    const pos = s.length - 1 - i
    if (d === 0) continue
    if (pos === 0) out += d === 1 && (s.length > 1 || higher) ? 'เอ็ด' : D[d]
    else if (pos === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : `${D[d]}สิบ`
    else out += D[d] + P[pos]
  }
  return out
}
function intText(n) {
  if (n === 0) return 'ศูนย์'
  const s = String(n)
  const parts = []
  for (let i = s.length; i > 0; i -= 6) parts.unshift(s.slice(Math.max(0, i - 6), i))
  return parts.map((p, i) => {
    const v = Number(p)
    if (v === 0) return ''
    return group(v, i > 0) + (i < parts.length - 1 ? 'ล้าน' : '')
  }).join('')
}
export function bahtText(amount) {
  const a = Math.round((Number(amount) + Number.EPSILON) * 100)
  if (!Number.isFinite(a) || a < 0) return ''
  const baht = Math.floor(a / 100)
  const sat = a % 100
  return `${intText(baht)}บาท${sat ? `${group(sat)}สตางค์` : 'ถ้วน'}`
}
