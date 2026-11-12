// แยกค่าจากข้อความที่ Tesseract อ่านได้จากภาพสลิปธนาคาร (ฟังก์ชันล้วน ไม่มี API ภายนอก)
// ค่าที่อ่านไม่มั่นใจจะเป็น null และ review ระบุว่าฟิลด์ไหนพนักงานต้องตรวจ
// เลขบัญชีผู้รับ/ชื่อผู้รับ ถือว่าต้องตรวจเสมอ เพราะ OCR อ่านตัวเลขบางตัวผิดได้ (เช่น 4797 → 4707)

export type SlipText = {
  amount: number | null
  paidAt: string | null // "YYYY-MM-DDTHH:mm" เวลาไทย
  receiverName: string | null
  receiverAccount: string | null // เลขที่ปรากฏบนสลิป (มักถูกปิดบาง)
  review: Array<'amount' | 'paidAt' | 'receiverName' | 'receiverAccount'>
}

const MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
}
const pad = (n: number) => String(n).padStart(2, '0')

// วัน-เวลาทำรายการ เช่น "13 พ.ย. 2569 - 01:28" หรือ "12 พ.ย. 69 11:52" (ปี พ.ศ. 2 หลัก = 25xx)
// OCR มักอ่านเลข 1 เป็น l/I/| และ 0 เป็น O/o · สระลอยหลังจุด ("พ.ุย.") ถูกตัดทิ้งก่อนอ่านเดือน
const DAY = '([0-9lI|iOo]{1,2})'
const fixDay = (v: string) => Number(v.replace(/[lI|i]/g, '1').replace(/[Oo]/g, '0'))
const build = (y: number, month: number, day: number, hh: number, mm: number): string | null => {
  if (day < 1 || day > 31 || hh > 23 || mm > 59) return null
  const d = new Date(Date.UTC(y, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${y}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}`
}
const ceYear = (v: string) => { let y = Number(v); if (y < 100) y += 2500; return y >= 2500 ? y - 543 : y }
export function parseThaiDateTime(text: string): string | null {
  const t = text.replace(/\.[ัิ-ฺ็-๎]+/g, '.')
  const m = t.match(new RegExp(`${DAY}\\s*(ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)\\s*(\\d{4}|\\d{2})\\s*[-–]?\\s*(\\d{1,2}):(\\d{2})`))
  if (!m) return null
  return build(ceYear(m[3]), MONTHS[m[2]], fixDay(m[1]), Number(m[4]), Number(m[5]))
}
// เดือนอ่านไม่ออก (เช่น "11 we. 69 15:49") แต่วัน ปี เวลา ครบ → เลือกเดือนล่าสุดที่ไม่เกินเวลาปัจจุบัน (สลิปที่ส่งมามักเพิ่งโอน)
// เป็นค่าคาดการณ์ · ผู้เรียกต้องให้พนักงานตรวจ (mergeSlipTexts ใส่ paidAt ใน review ให้)
export function inferThaiDateTime(text: string, nowMs = Date.now()): string | null {
  const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:\\S{1,3}\\s+)?${DAY}\\s+\\S{1,6}\\s+(\\d{4}|\\d{2})\\s*[-–]?\\s*(\\d{1,2}):(\\d{2})`))
  if (!m) return null
  const y = ceYear(m[2])
  const now = new Date(nowMs + 7 * 3600_000) // เวลาไทย
  if (y !== now.getUTCFullYear() && y !== now.getUTCFullYear() - 1) return null
  const nowKey = now.toISOString().slice(0, 16)
  for (let month = 12; month >= 1; month--) {
    const v = build(y, month, fixDay(m[1]), Number(m[3]), Number(m[4]))
    if (v && v <= nowKey) return v
  }
  return null
}

// จำนวนเงิน: บรรทัดที่มี "เงิน" (ไม่ใช่ค่าธรรมเนียม) ตัวเลขแรกในบรรทัด · ผิดช่วง = null
export function parseAmount(text: string): number | null {
  for (const line of text.split('\n')) {
    if (!/เงิน/.test(line) || /ธรรมเนียม/.test(line)) continue
    const m = line.match(/(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/)
    if (!m) continue
    const n = Number(`${m[1].replace(/,/g, '')}${m[2] ? `.${m[2]}` : ''}`)
    if (Number.isFinite(n) && n > 0 && n <= 10_000_000) return Math.round(n * 100) / 100
  }
  return null
}

const letters = (l: string) => (l.match(/[ก-๙A-Za-z]/g) || []).length
const MASK = /[*xX]{2,}[*xX\- ]*\d{2,}[\d\- ]*$/ // เลขที่ถูกปิดบางหลัก เช่น "*** ******** 4797" / "XXX XXX 3402"
const cleanName = (l: string) => l.replace(/^[^ก-๙A-Za-z]+/, '').replace(/\s+/g, ' ').trim()

// ผู้รับโอน รองรับ 2 แบบ:
//  ก) มีคำว่า "ไปยัง" (เช่น Krungthai NEXT): ชื่อ = บรรทัดถัดไป · เลข = บรรทัดที่มีเลขปิดบางหลักใน 4 บรรทัดถัดมา
//  ข) ไม่มี "ไปยัง" (เช่น เป๋าตัง): ผู้รับอยู่หลังบรรทัดเลขบัญชีผู้โอน (เลขปิดบางหลักบรรทัดแรก)
//     ร้านค้า: เลข = "KB" + 12 หลักท้ายของรหัสธุรกรรม (บรรทัดรหัสร้านค้ามักอ่าน 0 เป็น O) · พร้อมเพย์: เลขปิดบางหลักบรรทัดที่สอง
export function parseReceiver(text: string): { name: string | null; account: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const acctOf = (l: string) => { const m = l.match(MASK); return m ? m[0].replace(/\s+/g, ' ').trim() : null }
  const to = lines.findIndex((l) => /ไปยัง/.test(l))
  if (to >= 0) {
    const rest = lines.slice(to + 1, to + 5)
    const name = rest.find((l) => letters(l) >= 3 && !acctOf(l) && !/พร้อมเพย์|จํานวน|จำนวน|ธรรมเนียม/.test(l))
    const acc = rest.map(acctOf).find(Boolean) ?? null
    return { name: name ? cleanName(name) : null, account: acc }
  }
  const masked = lines.map((l, k) => (acctOf(l) ? k : -1)).filter((k) => k >= 0)
  const from = masked[0] ?? -1
  if (from < 0) return { name: null, account: null }
  const end = lines.findIndex((l, k) => k > from && /เงิน|ธรรมเนียม/.test(l))
  const block = lines.slice(from + 1, end < 0 ? from + 6 : end)
  const txn = block.find((l) => /ธุรกรรม/.test(l))
  const shop = block.findIndex((l) => /ร้านค้า|ธุรกรรม/.test(l))
  let account: string | null = null
  let idAt = block.length
  if (txn || shop >= 0) {
    // รหัสธุรกรรม "KPS004KB000001951728": OCR อ่าน 0 เป็น O ได้ → แปลงก่อน แล้วใช้ตัวเลขชุดท้ายสุด 12 หลัก
    const tail = ((txn ?? '').split(':').pop() || '').replace(/[Oo]/g, '0').match(/(\d{12,})\D*$/)
    if (tail) account = `KB${tail[1].slice(-12)}`
    else { const m = (block[shop] || '').match(/K[B8][0-9Oo]{10,}/); if (m) account = `KB${m[0].slice(2).replace(/[Oo]/g, '0')}` }
    idAt = shop
  } else {
    const k = block.findIndex((l) => acctOf(l))
    if (k >= 0) { account = acctOf(block[k]); idAt = k }
  }
  // ชื่อ = บรรทัดที่มีตัวอักษรมากสุดก่อนบรรทัดเลข (ข้ามโลโก้ "Pay"/"Prompt" และเศษสัญลักษณ์)
  const cand = block.slice(0, idAt).filter((l) => letters(l) >= 2 && !/^(Prompt|Pay|NV|NY)$/i.test(l.replace(/[^A-Za-z]/g, '')) && !/^[^ก-๙A-Za-z]*[A-Za-zก-๙]{1,2}[^ก-๙A-Za-z]*\/?$/.test(l))
  const best = cand.sort((a, b) => letters(b) - letters(a))[0]
  return { name: best ? cleanName(best) : null, account }
}

// ความคล้ายของชื่อ 0–1 (bigram dice · ไม่สนช่องว่าง/ตัวพิมพ์) ใช้เทียบชื่อที่ OCR อ่านกับชื่อบัญชีที่รู้อยู่แล้ว
export function nameSimilarity(a: string, b: string): number {
  const grams = (v: string) => { const t = v.replace(/\s+/g, '').toLowerCase(); const m = new Map<string, number>(); for (let k = 0; k < t.length - 1; k++) m.set(t.slice(k, k + 2), (m.get(t.slice(k, k + 2)) || 0) + 1); return m }
  const A = grams(a), B = grams(b)
  let inter = 0, na = 0, nb = 0
  for (const v of A.values()) na += v
  for (const v of B.values()) nb += v
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0)
  return na + nb ? (2 * inter) / (na + nb) : 0
}
// OCR อ่านชื่อไทยผิดได้ 1–2 ตัวอักษร → เทียบกับรายชื่อบัญชีที่รู้ (เช่น ชื่อบัญชีรับเงินของร้าน) คืนชื่อที่ถูกต้องเมื่อคล้ายพอ
export function matchKnownName(ocrName: string | null, known: string[], min = 0.75): string | null {
  if (!ocrName) return null
  let best: string | null = null, score = 0
  for (const k of known) { const v = nameSimilarity(ocrName, k); if (v > score) { score = v; best = k } }
  return score >= min ? best : null
}

// รวมผลจากการอ่านหลายรอบ (ต่างโมเดล/ต่างการจัดหน้า): ค่าที่ตรงกันมากสุดชนะ · เสมอ = รอบแรกสุด
// ฟิลด์ที่ทุกรอบไม่ตรงกันเลย (หรืออ่านได้รอบเดียว) ถูกใส่ใน review ให้พนักงานตรวจ
export function mergeSlipTexts(texts: string[], nowMs = Date.now()): SlipText {
  const rs = texts.map(parseSlipText)
  const review: SlipText['review'] = []
  const vote = <K extends 'amount' | 'paidAt' | 'receiverName' | 'receiverAccount'>(key: K): SlipText[K] => {
    const vals = rs.map((r) => r[key]).filter((v) => v != null)
    const count = new Map<string, number>()
    for (const v of vals) count.set(String(v), (count.get(String(v)) || 0) + 1)
    let win: SlipText[K] = null as SlipText[K], top = 0
    for (const v of vals) { const c = count.get(String(v))!; if (c > top) { top = c; win = v as SlipText[K] } }
    if (top < 2) review.push(key)
    return win
  }
  let paidAt = vote('paidAt')
  if (paidAt == null) { // ไม่มีรอบไหนอ่านเดือนออก → ใช้ค่าคาดการณ์ (อยู่ใน review แล้วเพราะคะแนนโหวต < 2)
    for (const t of texts) { paidAt = inferThaiDateTime(t, nowMs); if (paidAt) break }
  }
  return { amount: vote('amount'), paidAt, receiverName: vote('receiverName'), receiverAccount: vote('receiverAccount'), review }
}

export function parseSlipText(text: string): SlipText {
  const amount = parseAmount(text)
  const paidAt = parseThaiDateTime(text)
  const r = parseReceiver(text)
  const review: SlipText['review'] = []
  if (amount == null) review.push('amount')
  if (paidAt == null) review.push('paidAt')
  review.push('receiverName', 'receiverAccount')
  return { amount, paidAt, receiverName: r.name, receiverAccount: r.account, review }
}
