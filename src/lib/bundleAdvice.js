// คำแนะนำบันเดิ้ล: บันเดิ้ลทางเลือกจากตัวเลือกที่เลือก และราคาที่แนะนำพร้อมเหตุผล
// ลำดับความสำคัญ: 1) ลดน้อยที่สุดที่ยังจูงใจ (รายได้เสียน้อย) 2) สมดุลราคา (บังคับ ตรวจเป็นบาทจริงทุกขนาด): ชุดใหญ่ต้องคิดเงินมากกว่าทุกชุดย่อย
// และน้อยกว่าชุดใหญ่ที่มีอยู่ทุกชุด 3) เป็นธรรม: ชุดใหญ่ลดมากกว่าชุดย่อยเป็นขั้นละ 5% 4) อ่านง่าย: เปอร์เซ็นต์เดียวกันทุกขนาด ปัดเป็นบาทเต็ม
import { autoBundleName, bahtText, effectiveDiscount, findDuplicate, findItemOption, itemSetKey, percentOf, regularTotal } from './bundleEditor.js'
import { isFixed } from './pricing.js'

export const STEP = 5 // ขั้นการปรับของเปอร์เซ็นต์
export const CAP = 30 // ลดสูงสุดของชุดเดียว (กันฟรีหรือเกือบฟรี)
export const MAX_ITEMS = 6 // เลือกเกินนี้ไม่แยกบันเดิ้ลทางเลือก
const SUBSET_LIMIT = 12 // ตรวจสมดุลทุกชุดย่อยได้ถึงจำนวนนี้ (เกินนี้เตือนให้ตรวจเอง)

const EPS = 1e-9
const keyOf = (x) => `${x.groupId}:${x.optionId}`
const uniq = (items) => [...new Map((items || []).map((x) => [keyOf(x), { groupId: x.groupId, optionId: x.optionId }])).values()]
const typesOverlap = (a, b) => !a?.length || !b?.length || a.some((t) => b.includes(t))
const ladder = (count) => Math.min(CAP, STEP * count) // ขั้นบันได: 2 อย่าง 10% · 3 อย่าง 15% · …
const floorStep = (x) => Math.floor(x / STEP + EPS) * STEP
const ceilStep = (x) => Math.ceil(x / STEP - EPS) * STEP
const fmt = (x) => String(Math.round(x))
const median = (xs) => {
  const a = [...xs].sort((p, q) => p - q)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const nameOf = (b, groups) => b.name || autoBundleName(b.items, groups)
// ประเภทที่ใช้คิดราคาปกติของชุดที่แนะนำ: ประเภทเดียว → ราคาของประเภทนั้น · หลายประเภท/ทุกประเภท → ราคากลาง
const scopeType = (types) => (types?.length === 1 ? types[0] : null)
// ประเภทที่ใช้ดูความสัมพันธ์: ตามที่ชุดนี้ใช้ได้ · ทุกประเภท = ทุกประเภทที่เปิดใช้งาน
const typeList = (types, allTypeIds) => (types?.length ? types : allTypeIds?.length ? allTypeIds : [null])

// เปอร์เซ็นต์ที่ลดจริงของชุดหนึ่ง ณ ประเภทและขนาด (null = ไม่มีราคาปกติให้เทียบ)
function pctAt(b, groups, typeId, sizeId) {
  const reg = regularTotal(uniq(b.items), groups, typeId, sizeId)
  return reg > 0 ? (effectiveDiscount(b, typeId, sizeId) / reg) * 100 : null
}
// เปอร์เซ็นต์ที่ลดจริงของชุด (ทุกประเภทที่ดู × ทุกขนาด) เฉพาะช่องที่ลดจริง
function discountPcts(b, groups, sizeIds, tIds) {
  const out = []
  for (const t of tIds) for (const s of sizeIds) {
    const p = pctAt(b, groups, t, s)
    if (p != null && p > EPS) out.push(p)
  }
  return out
}
// ลดสูงสุดของชุดที่มีอยู่ (ทุกขนาดและประเภทที่ดู) · 0 = ยังไม่ลด
export function maxPct(b, groups, sizes, types = [], allTypeIds = []) {
  const ps = discountPcts(b, groups, sizes.map((s) => s.id), typeList(types, allTypeIds))
  return ps.length ? Math.round(Math.max(...ps)) : 0
}
// ตัวเลือกที่ยังไม่มีราคาของขนาดนี้ → ระบบไม่ลดขนาดนั้น
const unpricedNames = (list, groups, typeId, sizeId) =>
  list
    .map((x) => findItemOption(groups, x))
    .filter((o) => o && !isFixed(o) && !(Number(o.sizePrices?.[sizeId]) > 0) && !(Number(o.typePrices?.[typeId]?.[sizeId]) > 0))
    .map((o) => o.name)
// เปอร์เซ็นต์สูงสุด (จำนวนเต็ม) ที่ส่วนลดปัดเป็นบาทแล้วยังไม่เกินเพดานบาท · -1 = แม้ไม่ลดก็เกินเพดาน
function maxPctUnder(reg, cap) {
  let best = -1
  for (let p = 0; p <= CAP; p++) if (percentOf(reg, p) <= cap + EPS) best = p
  return best
}
// เปอร์เซ็นต์ต่ำสุดที่ส่วนลดปัดเป็นบาทแล้วถึงเกณฑ์ · ถึงไม่ได้เลย = Infinity
function minPctOver(reg, need) {
  for (let p = 0; p <= CAP; p++) if (percentOf(reg, p) >= need - EPS) return p
  return Infinity
}

// บันเดิ้ลทางเลือก: ทุกรูปแบบที่มี 2 ตัวเลือกขึ้นไปและน้อยกว่าที่เลือก (เลือก 3 → ได้ 3 ชุดคู่) · เรียงจากชุดเล็กไปใหญ่
export function comboSuggestions(items) {
  const list = uniq(items)
  const n = list.length
  if (n < 3 || n > MAX_ITEMS) return []
  const out = []
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const pick = list.filter((_, i) => mask & (1 << i))
    if (pick.length >= 2) out.push(pick)
  }
  return out.sort((a, b) => a.length - b.length)
}

// ราคาที่แนะนำของชุดหนึ่ง (items) จากความสัมพันธ์กับชุดที่ใช้งานอยู่
// opts: groups, sizes, bundles, types (ประเภทที่ชุดใช้ได้ · [] = ทุกประเภท), allTypeIds (ประเภทที่เปิดใช้งาน), selfId (ชุดที่ไม่นับ = ชุดตัวเอง)
// คืน: pct (ส่วนลดที่แนะนำ %), status (ok · adjusted · capped · conflict · noprice), amounts (ยอดลดต่อขนาด บาท), balanced (ผ่านสมดุลราคากับทุกชุดย่อย/ชุดใหญ่หรือไม่)
export function recommendPrice(items, { groups = [], sizes = [], bundles = [], types = [], allTypeIds = [], selfId = null } = {}) {
  const list = uniq(items)
  const ks = new Set(list.map(keyOf))
  const n = ks.size
  const sizeIds = sizes.map((s) => s.id)
  const sizeName = Object.fromEntries(sizes.map((s) => [s.id, s.name]))
  const tIds = typeList(types, allTypeIds)
  const priceType = scopeType(types)
  const base = ladder(n)
  const others = bundles.filter((b) => b.id !== selfId && b.active !== false && typesOverlap(b.types, types))
  const reasons = [`ขั้นพื้นฐาน: ${n} อย่างลด ${base}% (เลือกมากขึ้น ลดมากขึ้น)`]
  const conflicts = []
  const warnings = []

  // ราคาปกติรวมของแต่ละขนาด · ขนาดที่ตั้งราคาได้ = ทุกตัวเลือกมีราคาในขนาดนั้น
  const regular = {}
  for (const id of sizeIds) regular[id] = regularTotal(list, groups, priceType, id)
  const offered = sizeIds.filter((id) => regular[id] > 0 && unpricedNames(list, groups, priceType, id).length === 0)
  const missing = {}
  for (const id of sizeIds) for (const name of unpricedNames(list, groups, priceType, id)) missing[name] = [...(missing[name] || []), sizeName[id]]
  for (const [name, szs] of Object.entries(missing)) warnings.push(`"${name}" ยังไม่มีราคาขนาด ${szs.join(', ')} → ไม่ลดขนาดนั้น`)
  if (!offered.length) warnings.push('ยังไม่มีราคาตัวเลือกครบในขนาดใดเลย — ตั้งราคาตัวเลือกก่อน')
  if (n > SUBSET_LIMIT) warnings.push(`เลือก ${n} อย่าง ตรวจสมดุลทุกชุดย่อยไม่ได้ — ตรวจราคาเองก่อนบันทึก`)

  // ความสัมพันธ์กับชุดที่มีอยู่ (เฉพาะชุดที่ลดจริง): ชุดย่อยที่อยู่ในชุดนี้ และชุดใหญ่ที่ครอบชุดนี้
  const subs = []
  const supers = []
  for (const b of others) {
    const bk = new Set(uniq(b.items).map(keyOf))
    if (bk.size < 2) continue
    const isSub = bk.size < n && [...bk].every((k) => ks.has(k))
    const isSup = bk.size > n && [...ks].every((k) => bk.has(k))
    if (!isSub && !isSup) continue
    const ps = discountPcts(b, groups, sizeIds, tIds)
    if (!ps.length) continue // ชุดที่ไม่ได้ลดอะไรไม่กระทบราคา
    if (isSub) subs.push({ name: nameOf(b, groups), count: bk.size, top: Math.max(...ps) })
    else supers.push({ b, name: nameOf(b, groups), count: bk.size, low: Math.min(...ps) })
  }

  // (ก) สมดุลราคา: เงื่อนไขบังคับ เป็นบาทจริงทุกขนาด
  //   ชุดนี้ต้องคิดเงินมากกว่าทุกชุดย่อย (ตัวเลือกเดี่ยวและชุดย่อยที่ยังไม่มีชุด = ราคาปกติ) และน้อยกว่าชุดใหญ่ที่มีอยู่ทุกชุด
  const exactBy = new Map()
  for (const b of others) {
    const k = itemSetKey(b.items)
    exactBy.set(k, [...(exactBy.get(k) || []), b])
  }
  const upper = [] // เพดานส่วนลดจากชุดย่อย: { label, size, net, cap, pMax }
  const lower = [] // ขั้นต่ำของส่วนลดจากชุดใหญ่: { label, size, net, need, pMin }
  if (n <= SUBSET_LIMIT) {
    const subsets = []
    for (let mask = 1; mask < (1 << n) - 1; mask++) {
      const T = list.filter((_, i) => mask & (1 << i))
      const key = itemSetKey(T)
      const exact = exactBy.get(key) || []
      subsets.push({ T, key, label: exact[0] ? nameOf(exact[0], groups) : autoBundleName(T, groups) })
    }
    for (const id of offered) {
      const reg = regular[id]
      for (const sub of subsets) {
        const rT = regularTotal(sub.T, groups, priceType, id)
        if (!(rT > 0)) continue
        const dT = (exactBy.get(sub.key) || []).reduce((m, b) => Math.max(m, effectiveDiscount(b, priceType, id)), 0)
        const net = rT - dT
        const cap = reg - net - 1
        upper.push({ label: sub.label, size: id, net, cap, pMax: maxPctUnder(reg, cap) })
      }
    }
  }
  for (const u of supers) {
    for (const id of offered) {
      const reg = regular[id]
      const net = regularTotal(uniq(u.b.items), groups, priceType, id) - effectiveDiscount(u.b, priceType, id)
      const need = reg - net + 1
      lower.push({ label: u.name, size: id, net, need, pMin: minPctOver(reg, need) })
    }
  }
  let hardHi = CAP
  let upBy = null
  for (const c of upper) if (c.pMax < hardHi) { hardHi = c.pMax; upBy = c }
  let hardLo = 0
  let lowBy = null
  for (const c of lower) if (c.pMin > hardLo) { hardLo = c.pMin; lowBy = c }
  const hardOK = hardLo <= hardHi

  // (ข) ขั้นบันได (อ่อน): ชุดใหญ่ลดมากกว่าชุดย่อยอย่างน้อยหนึ่งขั้น และลดน้อยกว่าชุดใหญ่กว่าอย่างน้อยหนึ่งขั้น
  const subTop = subs.length ? Math.max(...subs.map((s) => s.top)) : null
  const superLow = supers.length ? Math.min(...supers.map((s) => s.low)) : null
  const softLo = subTop == null ? 0 : ceilStep(subTop + STEP)
  const softHi = superLow == null ? CAP : Math.min(CAP, floorStep(superLow - STEP))
  const orderingOK = softLo <= softHi
  const want = orderingOK ? Math.min(Math.max(base, softLo), softHi) : base

  // เลือกราคาในช่วงที่สมดุลได้ (เป็นขั้นบันไดเมื่อทำได้)
  const snapDown = (x) => {
    const d = floorStep(x)
    return d >= hardLo && d <= x ? d : x
  }
  const snapUp = (x) => {
    const u = ceilStep(x)
    return u <= hardHi && u >= x ? u : x
  }
  let status = 'ok'
  let pct = base
  if (!offered.length) { status = 'noprice'; pct = 0 }
  else if (!hardOK) { status = 'conflict'; pct = 0 }
  else if (want > hardHi) { status = 'capped'; pct = snapDown(hardHi) }
  else if (want < hardLo) { status = 'adjusted'; pct = snapUp(hardLo) }
  else pct = want
  if (status === 'ok' && pct !== base) status = 'adjusted'
  if (!orderingOK && (status === 'ok' || status === 'adjusted' || status === 'capped')) status = 'conflict'

  // ยอดลดต่อขนาด: เปอร์เซ็นต์เดียวกัน ปัดเป็นบาทเต็ม · ขนาดที่ยังตั้งราคาไม่ครบ = ไม่ลด
  const amounts = {}
  for (const id of sizeIds) amounts[id] = offered.includes(id) ? percentOf(regular[id], pct) : 0
  const balanced = upper.every((c) => amounts[c.size] <= c.cap + EPS) && lower.every((c) => amounts[c.size] >= c.need - EPS)

  // เหตุผล
  for (const s of subs) reasons.push(`ชุดย่อย "${s.name}" ลดสูงสุด ${fmt(s.top)}%`)
  for (const s of supers) reasons.push(`ชุดใหญ่ "${s.name}" ลด ${fmt(s.low)}% → ชุดนี้ต้องลดน้อยกว่า`)
  if (status === 'adjusted' && subs.length && softLo > base && pct > base) reasons.push(`ปรับขึ้นเป็น ${pct}% ให้มากกว่าชุดย่อยทุกชุด`)
  if (status === 'adjusted' && supers.length && softHi < base && pct < base) reasons.push(`ปรับลงเป็น ${pct}% ให้น้อยกว่าชุดใหญ่ทุกชุด`)
  if (offered.length && hardOK && want > hardHi && upBy) {
    reasons.push(`ลดได้ไม่เกิน ${fmt(hardHi)}% เพราะถ้ามากกว่านี้ ราคาหลังลดจะไม่สูงกว่า "${upBy.label}" ที่เหลือ ${bahtText(upBy.net)} (${sizeName[upBy.size]}) — ชุดใหญ่ต้องจ่ายมากกว่าชุดย่อยเสมอ`)
  }
  if (offered.length && hardOK && want < hardLo && lowBy) {
    reasons.push(`ต้องลดอย่างน้อย ${lowBy.pMin}% เพราะ "${lowBy.label}" (${sizeName[lowBy.size]}) เหลือ ${bahtText(lowBy.net)} ชุดนี้ต้องต่ำกว่านั้น`)
  }
  const peers = others
    .filter((b) => new Set(uniq(b.items).map(keyOf)).size === n)
    .map((b) => discountPcts(b, groups, sizeIds, tIds))
    .filter((ps) => ps.length)
    .map((ps) => ps.reduce((a, x) => a + x, 0) / ps.length)
  if (peers.length) reasons.push(`เทียบชุดอื่นที่มี ${n} อย่าง (${peers.length} ชุด) ลดเฉลี่ย ${fmt(median(peers))}%`)

  // ข้อขัดแย้ง: ต้องแก้ชุดเดิมก่อน
  if (!orderingOK) {
    if (softLo > CAP) {
      for (const s of subs) {
        if (ceilStep(s.top + STEP) > CAP) conflicts.push(`ปรับ "${s.name}" จาก ${fmt(s.top)}% เป็น ${ladder(s.count)}% ก่อน${hardOK && offered.length ? ` — ชุดนี้จึงตั้งที่ ${pct}% ได้` : ''}`)
      }
    } else if (subs.length) {
      const sMax = subs.reduce((a, b) => (b.top > a.top ? b : a))
      const pMin = supers.reduce((a, b) => (b.low < a.low ? b : a))
      conflicts.push(`ชุดย่อย "${sMax.name}" ลด ${fmt(sMax.top)}% แต่ชุดใหญ่ "${pMin.name}" ลดแค่ ${fmt(pMin.low)}% — ไม่มีช่องให้ชุดนี้อยู่ระหว่างกลาง ปรับชุดเดิมก่อน`)
    } else {
      const pMin = supers.reduce((a, b) => (b.low < a.low ? b : a))
      conflicts.push(`ชุดใหญ่ "${pMin.name}" ลดแค่ ${fmt(pMin.low)}% น้อยกว่าขั้นต่ำ ${STEP}% จึงตั้งชุดนี้ให้ลดน้อยกว่าไม่ได้ — ปรับชุดใหญ่ให้ลดอย่างน้อย ${STEP}% ก่อน`)
    }
  }
  if (offered.length && !hardOK) {
    if (lowBy && lowBy.pMin > hardHi) {
      conflicts.push(lowBy.pMin === Infinity
        ? `ชุดใหญ่ "${lowBy.label}" (${sizeName[lowBy.size]}) เหลือ ${bahtText(lowBy.net)} จึงไม่มีราคาไหนที่ชุดนี้จะต่ำกว่าได้ — ปรับ "${lowBy.label}" ก่อน`
        : `ชุดใหญ่ "${lowBy.label}" (${sizeName[lowBy.size]}) เหลือ ${bahtText(lowBy.net)} ชุดนี้ต้องลดอย่างน้อย ${lowBy.pMin}% แต่ลดได้ไม่เกิน ${fmt(hardHi)}% — ปรับ "${lowBy.label}" ก่อน`)
    }
    if (upBy && hardHi < 0) {
      // ตัวเลือกที่ราคา 0 ฿ ในขนาดนี้ทำให้ชุดที่มีมันลดไม่ได้ (ลูกค้าเลือกแค่ชุดย่อยก็จ่ายเท่านี้แล้ว)
      const free = list.filter((x) => !(regularTotal([x], groups, priceType, upBy.size) > 0)).map((x) => findItemOption(groups, x)?.name).filter(Boolean)
      conflicts.push(free.length
        ? `"${free.join(', ')}" ราคา 0 ฿ ในขนาด ${sizeName[upBy.size]} — ลูกค้าที่เลือกแค่ "${upBy.label}" ก็จ่าย ${bahtText(upBy.net)} แล้ว ชุดนี้จึงลดไม่ได้ · ตั้งราคาตัวเลือกนี้ก่อน`
        : `ลดชุดนี้ไม่ได้: "${upBy.label}" (${sizeName[upBy.size]}) คิดราคา ${bahtText(upBy.net)} ซึ่งไม่ต่ำกว่าราคาปกติของชุดนี้ — ปรับ "${upBy.label}" ก่อน`)
    }
  }

  const first = offered[0]
  const sample = first ? { size: sizeName[first], regular: regular[first], net: regular[first] - amounts[first] } : null
  return { n, base, pct, status, amounts, regular, sample, reasons, conflicts, warnings, peerCount: peers.length, balanced, ceiling: hardHi }
}

// ข้อเสนอบันเดิ้ลทางเลือก: แต่ละชุดบอกว่ามีอยู่แล้วหรือยัง ลดสูงสุดตอนนี้เท่าไร และราคาที่แนะนำ
export function subSuggestions(items, { groups = [], sizes = [], bundles = [], types = [], allTypeIds = [] } = {}) {
  return comboSuggestions(items).map((combo) => {
    const existing = findDuplicate(combo, bundles, null)
    return {
      items: combo,
      name: autoBundleName(combo, groups),
      existing,
      current: existing ? maxPct(existing, groups, sizes, types, allTypeIds) : null,
      rec: recommendPrice(combo, { groups, sizes, bundles, types, allTypeIds, selfId: existing ? existing.id : null }),
    }
  })
}
