// โปรโมชัน POS (ฟังก์ชันล้วน ไม่แตะข้อมูลจริง) · ส่วนลด / บันเดิ้ล / ตัวคูณคะแนนพิเศษ กำหนดช่วงเวลาได้
// กติกา: ต่อสินค้า 1 ชิ้น ใช้ "อันที่ลดมากสุด" เพียงอย่างเดียว (ส่วนลดรายสินค้า/หมวด หรือบันเดิ้ล ไม่ซ้อนกัน)
//        ส่วนลดท้ายบิล (scope 'bill') คิดต่อจากนั้นและซ้อนกับของข้างบนได้ · คูปอง/ส่วนลดมือคิดต่อจากนี้อีก (ใน posSale)
import { dateOnly } from './format'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export const DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
export const blankSchedule = () => ({ from: '', to: '', days: [], timeFrom: '', timeTo: '' })

// ช่วงเวลา: from/to = วันที่ (รวมวันแรก-วันสุดท้าย) · days = วันในสัปดาห์ 0=อา (ว่าง = ทุกวัน) · timeFrom–timeTo = [เริ่ม, สิ้นสุด) ข้ามเที่ยงคืนได้
export function inSchedule(s, date = new Date()) {
  if (!s) return true
  const day = ymd(date)
  if (s.from && day < s.from) return false
  if (s.to && day > s.to) return false
  if (s.days?.length && !s.days.includes(date.getDay())) return false
  if (s.timeFrom || s.timeTo) {
    const m = date.getHours() * 60 + date.getMinutes()
    const a = s.timeFrom ? toMin(s.timeFrom) : 0
    const b = s.timeTo ? toMin(s.timeTo) : 24 * 60
    if (a <= b ? m < a || m >= b : m < a && m >= b) return false
  }
  return true
}
export function describeSchedule(s) {
  if (!s) return 'ตลอดเวลา'
  const out = []
  if (s.from || s.to) out.push(`${s.from ? dateOnly(s.from) : 'ตั้งแต่เริ่ม'} – ${s.to ? dateOnly(s.to) : 'ไม่กำหนดสิ้นสุด'}`)
  if (s.days?.length) out.push(s.days.length === 7 ? 'ทุกวัน' : [...s.days].sort((a, b) => a - b).map((d) => DAYS[d]).join(' '))
  if (s.timeFrom || s.timeTo) out.push(`${s.timeFrom || '00:00'}–${s.timeTo || '24:00'}`)
  return out.length ? out.join(' · ') : 'ตลอดเวลา'
}

const matches = (p, line) =>
  p.scope === 'all' ? true : p.scope === 'category' ? (p.categories || []).includes(line.category) : p.scope === 'items' ? (p.itemIds || []).includes(line.retailId) : false
const liveOf = (list, now) => (list || []).filter((p) => p.active !== false && inSchedule(p.schedule, now))
const cut = (d, price) => (d.type === 'percent' ? round2((price * Math.min(Number(d.value) || 0, 100)) / 100) : Math.min(Number(d.value) || 0, price))

// แบ่งยอด total ตามน้ำหนัก (เศษสตางค์ไปอยู่คนสุดท้าย) → เลข 2 ตำแหน่ง ผลรวมเท่า total พอดี
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!(sum > 0) || !(total > 0)) return weights.map(() => 0)
  const out = weights.map((w) => round2((total * w) / sum))
  const diff = round2(total - out.reduce((a, b) => a + b, 0))
  let i = out.length - 1
  while (i > 0 && out[i] + diff < 0) i--
  out[i] = round2(out[i] + diff)
  return out
}

// lines = [{ retailId, category, price (ราคาต่อชิ้น รวมตัวเลือกแล้ว), qty }] →
// คืน { lines: [[{ qty, perUnit, entries: [{ kind: 'promo'|'bundle', name, amount }] }]], saving }
// segments ต่อบรรทัด: ชิ้นที่ได้ส่วนลดเท่ากันรวมเป็นกลุ่มเดียว (บรรทัดเดียวอาจแตกเป็นหลายกลุ่ม เช่น บันเดิ้ลใช้แค่ 1 ใน 3 ชิ้น)
export function applyPosPromos(lines, { discounts = [], bundles = [], now = new Date() } = {}) {
  const units = []
  lines.forEach((l, li) => {
    for (let k = 0; k < (Number(l.qty) || 0); k++) units.push({ li, line: l, price: Number(l.price) || 0, ind: null, bun: null, bill: 0 })
  })
  const goods = units.reduce((s, u) => s + u.price, 0)
  const D = liveOf(discounts, now)

  // 1) ส่วนลดรายสินค้า/หมวด: ต่อชิ้นเลือกอันที่ลดมากสุด
  const itemD = D.filter((d) => d.scope !== 'bill' && (Number(d.minSpend) || 0) <= goods)
  for (const u of units) {
    for (const d of itemD) {
      if (!matches(d, u.line)) continue
      const amt = cut(d, u.price)
      if (amt > (u.ind?.amount || 0)) u.ind = { kind: 'promo', name: d.name, amount: amt }
    }
  }

  // 2) บันเดิ้ล: เลือกชุดที่ประหยัดมากกว่าส่วนลดรายชิ้นของชิ้นเหล่านั้น
  const live = liveOf(bundles, now).filter((b) => (b.items || []).length && (Number(b.price) || 0) >= 0)
  // ลำดับ: บันเดิ้ลที่ประหยัดต่อชุดมากสุดก่อน (คิดจากชิ้นที่ว่างตอนนี้)
  const potential = (b) => {
    const set = []
    for (const req of b.items) {
      const free = units.filter((u) => u.line.retailId === req.itemId && !set.includes(u))
      if (free.length < (Number(req.qty) || 1)) return -Infinity
      set.push(...free.slice(0, Number(req.qty) || 1))
    }
    return set.reduce((s, u) => s + u.price, 0) - (Number(b.price) || 0)
  }
  for (const b of [...live].sort((x, y) => potential(y) - potential(x))) {
    for (let guard = 0; guard < 500; guard++) {
      const set = []
      let ok = true
      for (const req of b.items) {
        const free = units.filter((u) => !u.bun && u.line.retailId === req.itemId && !set.includes(u))
        if (free.length < (Number(req.qty) || 1)) {
          ok = false
          break
        }
        set.push(...free.slice(0, Number(req.qty) || 1))
      }
      if (!ok || !set.length) break
      const regular = set.reduce((s, u) => s + u.price, 0)
      const saving = round2(regular - (Number(b.price) || 0))
      const indiv = set.reduce((s, u) => s + (u.ind?.amount || 0), 0)
      if (!(saving > indiv + 0.004)) break
      const parts = allocate(saving, set.map((u) => u.price))
      set.forEach((u, i) => (u.bun = { kind: 'bundle', name: b.name, amount: parts[i] }))
    }
  }

  // 3) ส่วนลดท้ายบิล: คิดจากยอดหลังข้อ 1–2 เลือกอันที่ลดมากสุด แล้วแบ่งเข้าแต่ละชิ้น
  const after = units.map((u) => u.price - (u.bun ? u.bun.amount : u.ind?.amount || 0))
  const payable = after.reduce((a, b) => a + b, 0)
  let bill = null
  for (const d of D.filter((x) => x.scope === 'bill' && (Number(x.minSpend) || 0) <= goods)) {
    const amt = cut(d, payable)
    if (amt > (bill?.amount || 0)) bill = { kind: 'promo', name: d.name, amount: amt }
  }
  const billParts = bill ? allocate(bill.amount, after) : after.map(() => 0)
  units.forEach((u, i) => (u.bill = billParts[i]))

  // 4) รวมกลับเป็นกลุ่มต่อบรรทัด
  const out = lines.map(() => [])
  let saving = 0
  for (const u of units) {
    const entries = []
    const first = u.bun || u.ind
    if (first && first.amount > 0) entries.push({ kind: first.kind, name: first.name, amount: first.amount })
    if (u.bill > 0) entries.push({ kind: 'promo', name: bill.name, amount: u.bill })
    const perUnit = round2(entries.reduce((s, e) => s + e.amount, 0))
    saving += perUnit
    const sig = entries.map((e) => `${e.kind}:${e.name}:${e.amount}`).join('|')
    const seg = out[u.li].find((s) => s.sig === sig)
    if (seg) seg.qty++
    else out[u.li].push({ qty: 1, perUnit, entries, sig })
  }
  for (const segs of out) for (const s of segs) delete s.sig
  return { lines: out, saving: round2(saving) }
}

// ตัวคูณคะแนนพิเศษของสินค้า 1 รายการ: ใช้ตัวที่สูงสุดที่ตรงเงื่อนไข (ไม่ซ้อนกัน) · ไม่มี = 1
export function pointMultiplier(line, promos = [], now = new Date()) {
  let m = 1
  for (const p of liveOf(promos, now)) if (matches(p, line)) m = Math.max(m, Number(p.multiplier) || 1)
  return m
}
// โปรคะแนนที่ตรงกับรายการ (ใช้แสดงป้าย)
export const pointPromoFor = (line, promos = [], now = new Date()) =>
  liveOf(promos, now).filter((p) => matches(p, line) && Number(p.multiplier) > 1).sort((a, b) => b.multiplier - a.multiplier)[0] || null

export const promoLive = (p, now = new Date()) => p.active !== false && inSchedule(p.schedule, now)
