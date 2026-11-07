// โปรโมชัน POS (ฟังก์ชันล้วน ไม่แตะข้อมูลจริง) · ส่วนลด / บันเดิ้ล / ตัวคูณคะแนนพิเศษ กำหนดช่วงเวลาได้
// กติกา: ต่อสินค้า 1 ชิ้น ใช้ "อันที่ลดมากสุด" เพียงอย่างเดียว (ส่วนลดรายสินค้า/หมวด หรือบันเดิ้ล ไม่ซ้อนกัน)
//        ส่วนลดท้ายบิล (scope 'bill') คิดต่อจากนั้นและซ้อนกับของข้างบนได้ · คูปอง/ส่วนลดมือคิดต่อจากนี้อีก (ใน posSale)
import { dateOnly, money } from './format'

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
  line.noItemPromo ? false : p.scope === 'all' ? true : p.scope === 'category' ? (p.categories || []).includes(line.category) : p.scope === 'items' ? (p.itemIds || []).includes(line.retailId) : false
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
// deals = ดีล (ซื้อแถม/ชิ้นที่ N ลด/ครบลด/ครบฟรี/add-on/ส่งฟรี) · catalog = [{ id, name, price, stock }] ใช้ตรวจ/คิดมูลค่าของแถม
// line.noItemPromo = true (เช่น เค้กสั่งทำในออร์เดอร์) ร่วมเฉพาะยอดรวมกับโปรท้ายบิล ไม่ติดโปรรายสินค้า
// คืนเพิ่ม: gifts [{ retailId, qty, dealId, name }] · shipFree { name } | null · hints [{ dealId, text }]
export function applyPosPromos(lines, { discounts = [], bundles = [], deals = [], catalog = [], now = new Date() } = {}) {
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

  // 1b) ดีลรายชิ้น: ชิ้นที่ N ลด / add-on ราคาพิเศษ — แข่งกับส่วนลดข้างบน (ต่อชิ้นใช้อันที่ลดมากสุด)
  const DL = liveOf(deals, now)
  const hints = []
  const cat = new Map((catalog || []).map((x) => [x.id, x]))
  const hint = (d, text) => hints.push({ dealId: d.id, text: `${d.name}: ${text}` })
  for (const d of DL.filter((x) => x.kind === 'nth')) {
    const n = Math.max(2, Math.floor(Number(d.n) || 0))
    const pct = Math.min(Number(d.percent) || 0, 100)
    const el = units.filter((u) => matches(d, u.line)).sort((a, b) => b.price - a.price)
    for (let k = 0; k + n <= el.length; k += n) {
      const u = el[k + n - 1]
      const amt = round2((u.price * pct) / 100)
      if (amt > (u.ind?.amount || 0)) u.ind = { kind: 'promo', name: d.name, amount: amt }
    }
    const r = el.length % n
    if (el.length && r) hint(d, `ซื้ออีก ${n - r} ชิ้น ${pct >= 100 ? 'ฟรี 1 ชิ้น' : `ลดชิ้นที่ ${n} ${pct}%`}`)
  }
  for (const d of DL.filter((x) => x.kind === 'spend_addon')) {
    const min = Number(d.min) || 0
    const item = cat.get(d.itemId)
    const mine = units.filter((u) => !u.line.noItemPromo && u.line.retailId === d.itemId)
    if (goods >= min) {
      mine.slice(0, Math.max(1, Math.floor(Number(d.limit) || 1))).forEach((u) => {
        const amt = round2(u.price - (Number(d.price) || 0))
        if (amt > 0 && amt > (u.ind?.amount || 0)) u.ind = { kind: 'promo', name: d.name, amount: amt }
      })
      if (!mine.length && item) hint(d, `เพิ่ม ${item.name} ราคาพิเศษ ${money(d.price)}`)
    } else if (goods > 0 && item) hint(d, `อีก ${money(min - goods)} ซื้อ ${item.name} ราคาพิเศษ ${money(d.price)}`)
  }

  // 2) บันเดิ้ล: เลือกชุดที่ประหยัดมากกว่าส่วนลดรายชิ้นของชิ้นเหล่านั้น
  const live = liveOf(bundles, now).filter((b) => (b.items || []).length && (Number(b.price) || 0) >= 0)
  // เลือกชุดบันเดิ้ลที่ "ประหยัดรวมมากสุด" (ลองทุกการจัดชุดที่เป็นไปได้ ไม่ใช่เลือกชุดแรกที่ประหยัดสุดแล้วจบ — กันกรณีชุดที่ใช้สินค้าซ้ำกันแย่งชิ้น)
  // ประหยัดสุทธิของชุด = (ราคาปกติรวมของชิ้นในชุด − ราคาชุด) − ส่วนลดรายชิ้นที่ชิ้นเหล่านั้นได้อยู่แล้ว (ใช้ก็ต่อเมื่อ > 0)
  const used = new Set()
  const gain = (u) => u.price - (u.ind?.amount || 0)
  const pickSet = (b) => {
    const set = []
    for (const req of b.items) {
      const q = Number(req.qty) || 1
      const free = units.filter((u) => !used.has(u) && u.line.retailId === req.itemId && !set.includes(u)).sort((x, y) => gain(y) - gain(x))
      if (free.length < q) return null
      set.push(...free.slice(0, q))
    }
    return set.length ? set : null
  }
  const netOf = (b, set) => round2(set.reduce((s, u) => s + u.price, 0) - (Number(b.price) || 0) - set.reduce((s, u) => s + (u.ind?.amount || 0), 0))
  // ลำดับลอง: ชุดที่ประหยัดมากก่อน (ให้คำตอบแรกใกล้เคียงที่สุด) · จำกัดจำนวนโหนดกันค้างเมื่อตะกร้าใหญ่มาก
  const order = [...live].sort((x, y) => { const sx = pickSet(x), sy = pickSet(y); return (sy ? netOf(y, sy) : -Infinity) - (sx ? netOf(x, sx) : -Infinity) })
  let best = { v: 0, plan: [] }
  let nodes = 0
  const dfs = (from, v, plan) => {
    if (v > best.v + 1e-9) best = { v, plan: [...plan] }
    if (++nodes > 20000) return
    for (let i = from; i < order.length; i++) {
      const set = pickSet(order[i])
      if (!set) continue
      const net = netOf(order[i], set)
      if (!(net > 0.004)) continue
      set.forEach((u) => used.add(u))
      plan.push({ b: order[i], set })
      dfs(i, v + net, plan)
      plan.pop()
      set.forEach((u) => used.delete(u))
    }
  }
  dfs(0, 0, [])
  for (const { b, set } of best.plan) {
    const saving = round2(set.reduce((s, u) => s + u.price, 0) - (Number(b.price) || 0))
    const parts = allocate(saving, set.map((u) => u.price))
    set.forEach((u, i) => (u.bun = { kind: 'bundle', name: b.name, amount: parts[i] }))
  }

  // 3) ส่วนลดท้ายบิล: คิดจากยอดหลังข้อ 1–2 เลือกอันที่ลดมากสุด แล้วแบ่งเข้าแต่ละชิ้น
  const after = units.map((u) => u.price - (u.bun ? u.bun.amount : u.ind?.amount || 0))
  const payable = after.reduce((a, b) => a + b, 0)
  let bill = null
  for (const d of D.filter((x) => x.scope === 'bill' && (Number(x.minSpend) || 0) <= goods)) {
    const amt = cut(d, payable)
    if (amt > (bill?.amount || 0)) bill = { kind: 'promo', name: d.name, amount: amt }
  }
  for (const d of DL.filter((x) => x.kind === 'spend_off')) {
    const tiers = [...(d.tiers || [])].map((t) => ({ min: Number(t.min) || 0, type: t.type === 'amount' ? 'amount' : 'percent', value: Number(t.value) || 0 })).sort((a, b) => a.min - b.min)
    const hit = [...tiers].reverse().find((t) => t.min <= goods)
    if (hit) {
      const amt = cut({ type: hit.type, value: hit.value }, payable)
      if (amt > (bill?.amount || 0)) bill = { kind: 'promo', name: d.name, amount: amt }
    }
    const next = tiers.find((t) => t.min > goods)
    if (next && goods > 0) hint(d, `อีก ${money(next.min - goods)} ลดเพิ่มเป็น ${next.type === 'percent' ? `${next.value}%` : money(next.value)}`)
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
  const bundleUsed = {}
  for (const u of units) if (u.bun) bundleUsed[u.line.retailId] = (bundleUsed[u.line.retailId] || 0) + 1

  // 5) ของแถม (แถวแยก ราคา 0 · ไม่นับเป็นยอดเข้าเงื่อนไขอื่น) + ส่งฟรี
  const gifts = []
  const inCart = (id) => units.filter((u) => u.line.retailId === id).length + gifts.filter((g) => g.retailId === id).reduce((n, g) => n + g.qty, 0)
  const addGift = (d, id, want) => {
    const it = cat.get(id)
    if (!it || !(want > 0)) { if (want > 0) hint(d, 'ของแถมถูกลบแล้ว'); return }
    const room = it.stock == null ? want : Math.max(0, Math.min(want, Number(it.stock) - inCart(id)))
    if (room < want) hint(d, `ของแถม ${it.name} ไม่พอ${room ? ` (แถมได้ ${room})` : ' (หมด)'}`)
    if (room > 0) gifts.push({ retailId: id, qty: room, dealId: d.id, name: d.name })
  }
  for (const d of DL.filter((x) => x.kind === 'bogo')) {
    const b = Math.max(1, Math.floor(Number(d.buyQty) || 0)), g = Math.max(1, Math.floor(Number(d.giftQty) || 0))
    const cap = Number(d.maxGifts) > 0 ? Math.floor(Number(d.maxGifts)) : Infinity
    const el = units.filter((u) => matches(d, u.line))
    const groups = d.giftItemId ? [{ id: d.giftItemId, n: el.length }] : [...new Set(el.map((u) => u.line.retailId))].map((id) => ({ id, n: el.filter((u) => u.line.retailId === id).length }))
    let used = 0
    for (const gr of groups) {
      const sets = d.repeat === false ? Math.min(1, Math.floor(gr.n / b)) : Math.floor(gr.n / b)
      const want = Math.min(sets * g, cap - used)
      if (want > 0) { const before = gifts.length; addGift(d, gr.id, want); used += gifts.slice(before).reduce((n, x) => n + x.qty, 0) }
      const r = gr.n % b
      if (gr.n && r && (d.repeat !== false || sets === 0)) hint(d, `ซื้ออีก ${b - r} ชิ้น แถม ${g} ชิ้น`)
    }
  }
  for (const d of DL.filter((x) => x.kind === 'spend_free')) {
    const min = Number(d.min) || 0
    const it = cat.get(d.giftItemId)
    if (goods >= min) addGift(d, d.giftItemId, Math.max(1, Math.floor(Number(d.giftQty) || 1)))
    else if (goods > 0 && it) hint(d, `อีก ${money(min - goods)} รับฟรี ${it.name}`)
  }
  let shipFree = null
  for (const d of DL.filter((x) => x.kind === 'free_ship')) {
    const min = Number(d.min) || 0
    if (goods >= min) shipFree = shipFree || { name: d.name }
    else if (goods > 0) hint(d, `อีก ${money(min - goods)} ส่งฟรี`)
  }
  return { lines: out, saving: round2(saving), bundleUsed, gifts, hints, shipFree, goods }
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
