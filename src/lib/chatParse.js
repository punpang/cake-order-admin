// จับข้อมูลจากข้อความแชทลูกค้า (ภาษาไทย): เบอร์โทร / วันที่ / เวลา
// และแปลงคำตอบของปุ่มถาม (ขอเบอร์ / ขอวันเวลารับ / ขอที่อยู่ / ขอข้อความบนเค้ก / ขอชื่อ)

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

const MONTHS = [
  ['มกราคม', 'ม.ค.', 'มค'], ['กุมภาพันธ์', 'ก.พ.', 'กพ'], ['มีนาคม', 'มี.ค.', 'มีค'], ['เมษายน', 'เม.ย.', 'เมย'],
  ['พฤษภาคม', 'พ.ค.', 'พค'], ['มิถุนายน', 'มิ.ย.', 'มิย'], ['กรกฎาคม', 'ก.ค.', 'กค'], ['สิงหาคม', 'ส.ค.', 'สค'],
  ['กันยายน', 'ก.ย.', 'กย'], ['ตุลาคม', 'ต.ค.', 'ตค'], ['พฤศจิกายน', 'พ.ย.', 'พย'], ['ธันวาคม', 'ธ.ค.', 'ธค'],
]
const DAYS = [['อาทิตย์'], ['จันทร์'], ['อังคาร'], ['พุธ'], ['พฤหัส', 'พฤหัสบดี'], ['ศุกร์'], ['เสาร์']]
const THAI_NUM = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10, สิบเอ็ด: 11 }
const num = (s) => (/^\d+$/.test(s) ? Number(s) : THAI_NUM[s] ?? null)
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ปีจากข้อความ: 2 หลัก/4 หลัก พ.ศ. หรือ ค.ศ. → ค.ศ.
function toYear(y) {
  let n = Number(y)
  if (y.length <= 2) n += 2500 // 69 → 2569
  return n > 2400 ? n - 543 : n
}
// วันที่ไม่ระบุปี → ครั้งถัดไปที่ยังไม่ผ่าน
function nextDate(month, day, today) {
  let d = new Date(today.getFullYear(), month - 1, day)
  if (ymd(d) < ymd(today)) d = new Date(today.getFullYear() + 1, month - 1, day)
  return d
}

export function findPhones(text) {
  const out = []
  const re = /(?<!\d)(0\d{1,2})[-\s.]?(\d{3})[-\s.]?(\d{3,4})(?!\d)/g
  let m
  while ((m = re.exec(text))) {
    const digits = m[1] + m[2] + m[3]
    if (/^0\d{8,9}$/.test(digits)) out.push({ type: 'phone', value: digits, raw: m[0] })
  }
  return out
}

export function findDates(text, today = new Date()) {
  const out = []
  const push = (d, raw) => out.push({ type: 'date', value: ymd(d), raw })
  if (/วันนี้/.test(text)) push(today, 'วันนี้')
  if (/พรุ่งนี้/.test(text)) push(addDays(today, 1), 'พรุ่งนี้')
  if (/มะรืน/.test(text)) push(addDays(today, 2), 'มะรืนนี้')
  // 5/11 , 5/11/69 , 5-11-2569
  for (const m of text.matchAll(/(?<![\d:.])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?![\d:])/g)) {
    const day = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    push(m[3] ? new Date(toYear(m[3]), month - 1, day) : nextDate(month, day, today), m[0])
  }
  // 5 พ.ย. / 5 พฤศจิกายน 2569
  MONTHS.forEach((names, i) => {
    const re = new RegExp(`(\\d{1,2})\\s*(?:${names.map(escape).join('|')})(?:\\s*(\\d{2,4})(?![:.]?\\d))?`, 'g')
    for (const m of text.matchAll(re)) push(m[2] ? new Date(toYear(m[2]), i, Number(m[1])) : nextDate(i + 1, Number(m[1]), today), m[0])
  })
  // วันเสาร์ (ครั้งถัดไป ไม่นับวันนี้)
  DAYS.forEach((names, dow) => {
    for (const n of names) {
      if (text.includes(`วัน${n}`) && !(dow === 4 && n === 'พฤหัส' && text.includes('วันพฤหัสบดี'))) {
        const diff = (dow - today.getDay() + 7) % 7 || 7
        push(addDays(today, diff), `วัน${n}`)
        break
      }
    }
  })
  return dedupe(out)
}

export function findTimes(text) {
  const out = []
  const push = (h, mm, raw) => {
    if (h >= 0 && h < 24 && mm >= 0 && mm < 60) out.push({ type: 'time', value: `${pad(h)}:${pad(mm)}`, raw })
  }
  // 14:00 / 14.30 / 9.00 น.
  for (const m of text.matchAll(/(?<![\d/])([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/g)) push(Number(m[1]), Number(m[2]), m[0])
  const word = '(\\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบเอ็ด|สิบ)'
  // บ่าย 2 / บ่ายสอง (โมง) = 14:00
  for (const m of text.matchAll(new RegExp(`บ่าย\\s*${word}(?:\\s*โมง)?(?:\\s*ครึ่ง)?`, 'g'))) {
    const n = num(m[1])
    if (n) push(n === 12 ? 12 : n + 12, m[0].includes('ครึ่ง') ? 30 : 0, m[0])
  }
  if (/บ่ายโมง/.test(text)) push(13, 0, 'บ่ายโมง')
  // 2 ทุ่ม = 20:00
  for (const m of text.matchAll(new RegExp(`${word}\\s*ทุ่ม(?:\\s*ครึ่ง)?`, 'g'))) {
    const n = num(m[1])
    if (n) push(n + 18, m[0].includes('ครึ่ง') ? 30 : 0, m[0])
  }
  // 4 โมงเย็น = 16:00 · 10 โมง(เช้า) = 10:00 (ไม่นับ "บ่าย x โมง")
  for (const m of text.matchAll(new RegExp(`(?<!บ่าย\\s*)${word}\\s*โมง(เช้า|เย็น)?(?:\\s*ครึ่ง)?`, 'g'))) {
    const n = num(m[1])
    if (!n) continue
    const h = m[2] === 'เย็น' && n < 12 ? n + 12 : n
    push(h, m[0].includes('ครึ่ง') ? 30 : 0, m[0])
  }
  if (/เที่ยง(?!คืน)/.test(text)) push(12, 0, 'เที่ยง')
  return dedupe(out)
}

function dedupe(list) {
  const seen = new Set()
  return list.filter((x) => (seen.has(x.type + x.value) ? false : seen.add(x.type + x.value)))
}

// ข้อมูลทั้งหมดที่จับได้ในข้อความ
export function detectEntities(text, today = new Date()) {
  if (!text) return []
  return [...findPhones(text), ...findDates(text, today), ...findTimes(text)]
}

// แปลงคำตอบของปุ่มถาม → { field: value } (คืน null ถ้าอ่านไม่ได้)
export function parseAnswer(field, text, today = new Date()) {
  const t = (text || '').trim()
  if (!t) return null
  if (field === 'phone') {
    const p = findPhones(t)[0]
    return p ? { phone: p.value } : null
  }
  if (field === 'datetime') {
    const d = findDates(t, today)[0]
    const tm = findTimes(t)[0]
    if (!d && !tm) return null
    return { ...(d ? { date: d.value } : {}), ...(tm ? { time: tm.value } : {}) }
  }
  if (field === 'address') return { address: t }
  if (field === 'message') return { message: t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim() }
  if (field === 'name') return { name: t.replace(/^(ชื่อ|คุณ)\s*/, '').trim() || t }
  return null
}
