// ราคาต่อชิ้น = ราคาเค้กหลัก (ประเภท + เนื้อเค้ก + ราคาขนาดของประเภท) + ตัวเลือกรอง (ตามขนาด/คงที่ แปรผันตามประเภท) − บันเดิ้ล

// ---------- ราคาพิเศษ ----------
// แบบที่ใช้งานอยู่ ณ วันที่ (YYYY-MM-DD) = เปิดใช้งาน และ (ไม่กำหนดเวลา หรืออยู่ในช่วง from–to)
export function activeLists(lists, dateStr) {
  return (lists || []).filter(
    (l) => l.active !== false && (!l.scheduled || ((!l.from || l.from <= dateStr) && (!l.to || dateStr <= l.to))),
  )
}

// ---------- เนื้อเค้ก/ขนาดที่ประเภทอนุญาต ----------
// ตัวเลือกของประเภทมี allow = { [groupId]: [optionId] } ไม่มี key = เลือกได้ทุกตัว
export function allowedBy(groups, selections) {
  const type = groups.find((g) => g.key === 'type')
  const sel = type ? selections?.[type.id] : null
  const ids = sel == null ? [] : Array.isArray(sel) ? sel : [sel]
  const types = ids.map((id) => type.options.find((o) => o.id === id)).filter(Boolean)
  return (g, o) => types.every((t) => !t.allow?.[g.id] || t.allow[g.id].includes(o.id))
}

// ---------- ชั้นของเค้ก ----------
// สั่งทำ: tiers = [{ selections }] กลุ่มที่เปิด perTier เลือกแยกในแต่ละชั้น กลุ่มอื่นอยู่ใน item.selections
// รายการที่ไม่มี tiers (หรือเค้กสำเร็จ) ถือเป็น 1 ชั้นที่ใช้ item.selections
export const tiersOf = (item) => (item.kind === 'custom' && item.tiers?.length ? item.tiers : [{ selections: item.selections || {} }])
export const isTierGroup = (g, item) => item.kind === 'custom' && !!g.perTier
const idsOf = (sel) => (sel == null ? [] : Array.isArray(sel) ? sel : [sel])
const MAIN = ['type', 'flavor', 'size']

// ---------- ราคาเค้กหลัก: ประเภท (คงที่) + เนื้อเค้ก (คงที่) + ราคาขนาดของประเภท ----------
// ประเภท: option.price + option.sizePrices[sizeId] · เนื้อเค้ก: option.price
// ราคาพิเศษ: priceList.types = { [typeId] }, typeSizes = { [typeId]: { [sizeId] } }, flavors = { [flavorId] } ช่องว่าง = ใช้ราคาปกติ
// หลายแบบพร้อมกัน ใช้ราคาต่ำสุดแยกทีละช่อง
// จดชื่อ (Set) หรือชื่อ + ยอดที่ลด (Map) ของราคาพิเศษ/บันเดิ้ลที่ใช้
function note(store, name, amount) {
  if (store instanceof Map) store.set(name, (store.get(name) || 0) + amount)
  else store.add(name)
}
function pickSpecial(regular, active, get, used) {
  let best = null
  for (const l of active) {
    const v = get(l)
    if (v == null || v === '') continue
    if (!best || Number(v) < best.price) best = { price: Number(v), list: l }
  }
  if (best && used) note(used, best.list.name, regular - best.price)
  return best ? best.price : regular
}
export const typePrice = (t, active = [], used = null) => (t ? pickSpecial(Number(t.price) || 0, active, (l) => l.types?.[t.id], used) : 0)
export const typeSizePrice = (t, sizeId, active = [], used = null) =>
  t && sizeId ? pickSpecial(Number(t.sizePrices?.[sizeId]) || 0, active, (l) => l.typeSizes?.[t.id]?.[sizeId], used) : 0
export const flavorPrice = (f, active = [], used = null) => (f ? pickSpecial(Number(f.price) || 0, active, (l) => l.flavors?.[f.id], used) : 0)

// ราคา 1 ชั้น (หรือเค้กสำเร็จ 1 ก้อน)
export function mainPrice(typeIds, flavorIds, sizeId, groups, active = [], used = null) {
  const find = (key, id) => groups.find((g) => g.key === key)?.options.find((o) => o.id === id)
  let sum = 0
  for (const id of idsOf(typeIds)) {
    const t = find('type', id)
    sum += typePrice(t, active, used) + typeSizePrice(t, sizeId, active, used)
  }
  for (const id of idsOf(flavorIds)) sum += flavorPrice(find('flavor', id), active, used)
  return sum
}
// base = ราคาเค้กหลัก (รวมทุกชั้น), pounds = ปอนด์รวม, tierPounds / tierSizes / tierTypes = ปอนด์ ขนาด และประเภทของแต่ละชั้น
// (พารามิเตอร์ products = รายการสินค้าหน้าร้านในระบบ ไม่ได้ใช้คิดราคา เก็บไว้ให้ลายเซ็นฟังก์ชันเดิม)
export function itemBase(item, groups, products, active = [], used = null) {
  const sizeGroup = groups.find((g) => g.key === 'size')
  // สินค้าสำเร็จ / สินค้าหน้าร้าน (POS): ราคาคงที่ที่บันทึกในรายการ · sizeId/typeId (ถ้ามี) ใช้คิดราคาตัวเลือกแบบตามขนาด/ประเภท
  if (item.kind === 'retail') {
    const pounds = sizeGroup?.options.find((o) => o.id === item.sizeId)?.pounds || 1
    return { base: Number(item.retailPrice) || 0, pounds, tierPounds: [pounds], tierSizes: [item.sizeId ? [item.sizeId] : []], tierTypes: [item.typeId || null] }
  }
  const type = groups.find((g) => g.key === 'type')
  const flavor = groups.find((g) => g.key === 'flavor')
  let base = 0
  const tierPounds = []
  const tierSizes = []
  const tierTypes = []
  for (const t of tiersOf(item)) {
    const sel = (g) => (g ? (isTierGroup(g, item) ? t.selections : item.selections)?.[g.id] : null)
    const sid = idsOf(sel(sizeGroup))[0] // 1 ขนาดต่อชั้น (รายการเก่าที่เลือกหลายขนาดใช้ขนาดแรก)
    tierPounds.push(sizeGroup?.options.find((o) => o.id === sid)?.pounds || 1)
    tierSizes.push(sid ? [sid] : [])
    tierTypes.push(idsOf(sel(type))[0] || null)
    base += mainPrice(sel(type), sel(flavor), sid, groups, active, used)
  }
  return { base, pounds: tierPounds.reduce((a, b) => a + b, 0), tierPounds, tierSizes, tierTypes }
}

// ---------- ตัวเลือกรอง ----------
// priceType: 'size' = ตามขนาด (sizePrices = { [sizeId] }) | 'fixed' = คงที่ (price)
// แปรผันตามประเภท: types = [typeId] ใช้ได้กับประเภทไหน (ว่าง = ทุกประเภท)
// ราคาแยกประเภท typePrices = { [typeId]: { [sizeId] } } (ตามขนาด) / typePrice = { [typeId]: บาท } (คงที่) ช่องว่าง = ใช้ราคากลาง
const num = (v) => (v == null || v === '' ? null : Number(v))
export const forType = (x, typeId) => !x?.types?.length || (!!typeId && x.types.includes(typeId))
export const isFixed = (o) => o?.priceType === 'fixed'
export function optionPrice(o, typeId, sizeIds) {
  if (!o) return 0
  if (isFixed(o)) return num(o.typePrice?.[typeId]) ?? (Number(o.price) || 0)
  return sizeIds.reduce((s, sid) => s + (num(o.typePrices?.[typeId]?.[sid]) ?? (Number(o.sizePrices?.[sid]) || 0)), 0)
}
// ราคาตัวเลือกรองแบบตามขนาดของราคากลาง (ใช้แสดงผล)
export const sizePriceOf = (o, sizeIds) => sizeIds.reduce((s, id) => s + (Number(o.sizePrices?.[id]) || 0), 0)

// ---------- บันเดิ้ล ----------
// bundles = [{ items: [{ groupId, optionId }], discount: { [sizeId] }, types: [typeId], typeDiscount: { [typeId]: { [sizeId] } } }]
// ในกลุ่มเดียวกันหรือข้ามกลุ่ม (เฉพาะตัวเลือกรอง) · picked = Set ของ "groupId:optionId" ที่เลือก · เลือกครบทุกตัว → ลดตามขนาด (ส่วนลดของประเภทถ้ามี)
// ซ้อนกันใช้อันที่ลดมากสุดก่อน ตัวเลือกหนึ่งใช้ได้บันเดิ้ลเดียว
const keyOf = (x) => `${x.groupId}:${x.optionId}`
export const bundleAmount = (b, typeId, sizeIds) => sizeIds.reduce((s, sid) => s + (num(b.typeDiscount?.[typeId]?.[sid]) ?? (Number(b.discount?.[sid]) || 0)), 0)
export function bundleDiscount(bundles, picked, sizeIds, usedBundles = null, typeId = null) {
  const cands = bundles
    .filter((b) => b.active !== false && forType(b, typeId) && b.items?.length > 1 && b.items.every((x) => picked.has(keyOf(x))))
    .map((b) => ({ b, d: bundleAmount(b, typeId, sizeIds) }))
    .sort((a, b) => b.d - a.d)
  const taken = new Set()
  let total = 0
  for (const c of cands) {
    const keys = c.b.items.map(keyOf)
    if (keys.some((k) => taken.has(k))) continue
    keys.forEach((k) => taken.add(k))
    total += c.d
    if (usedBundles && c.d) note(usedBundles, c.b.name, c.d)
  }
  return total
}

// ราคา/ชิ้น = ราคาเค้กหลัก + ตัวเลือกรอง − บันเดิ้ล
// กลุ่มแยกชั้น: ใช้ขนาด/ประเภทของชั้น · กลุ่มทั้งก้อน: ขนาดทุกชั้นรวมกัน + ประเภทของชั้นที่ 1 · แบบคงที่ไม่ขึ้นกับขนาด
// บันเดิ้ลที่มีกลุ่มแยกชั้น ตรวจทีละชั้น (ตัวเลือกของชั้น + ตัวเลือกทั้งก้อน) · บันเดิ้ลที่มีแต่กลุ่มทั้งก้อน ตรวจครั้งเดียว
export function calcUnitPrice(item, groups, products, active = [], used = null, usedBundles = null, bundles = []) {
  const { base, tierSizes, tierTypes } = itemBase(item, groups, products, active, used)
  const tiers = tiersOf(item)
  const allSizes = tierSizes.flat()
  const wholeType = tierTypes[0] || null
  const secondary = groups.filter((g) => !MAIN.includes(g.key) && g.type !== 'text')
  const tierG = secondary.filter((g) => isTierGroup(g, item))
  const wholeG = secondary.filter((g) => !isTierGroup(g, item))
  // ตัวเลือกที่เลือก (ตัดตัวที่ประเภทใช้ไม่ได้)
  const pick = (gs, sels, typeId) =>
    gs.flatMap((g) => idsOf(sels?.[g.id]).map((id) => ({ g, id, o: g.options.find((x) => x.id === id) }))).filter((x) => x.o && forType(x.o, typeId))
  const priceOf = (list, typeId, sids) => list.reduce((s, x) => s + optionPrice(x.o, typeId, sids), 0)
  const keys = (list) => new Set(list.map(({ g, id }) => `${g.id}:${id}`))
  const wholePicked = pick(wholeG, item.selections, wholeType)
  let extra = priceOf(wholePicked, wholeType, allSizes)
  const isTierB = (b) => b.items.some((x) => tierG.some((g) => g.id === x.groupId))
  const tierB = bundles.filter(isTierB)
  const wholeB = bundles.filter((b) => !isTierB(b))
  tiers.forEach((t, i) => {
    const tp = pick(tierG, t.selections, tierTypes[i])
    extra += priceOf(tp, tierTypes[i], tierSizes[i])
    extra -= bundleDiscount(tierB, keys([...tp, ...wholePicked]), tierSizes[i], usedBundles, tierTypes[i])
  })
  extra -= bundleDiscount(wholeB, keys(wholePicked), allSizes, usedBundles, wholeType)
  return base + extra
}

// ราคาที่ใช้ + ราคาปกติ + ชื่อแบบราคาพิเศษ/บันเดิ้ลที่ใช้
// fullPrice = ราคาเต็ม (ไม่ใช้ราคาพิเศษและบันเดิ้ล), discounts = ส่วนลดต่อชิ้นแยกตามแหล่ง (fullPrice − Σamount = unitPrice)
export function priceDetail(item, groups, products, active = [], bundles = []) {
  const used = new Map()
  const usedB = new Map()
  const unitPrice = calcUnitPrice(item, groups, products, active, used, usedB, bundles)
  const regularPrice = calcUnitPrice(item, groups, products, [], null, null, bundles)
  const fullPrice = calcUnitPrice(item, groups, products, [], null, null, [])
  const discounts = [
    ...[...used].filter(([, a]) => a).map(([name, amount]) => ({ kind: 'special', name, amount })),
    ...[...usedB].filter(([, a]) => a).map(([name, amount]) => ({ kind: 'bundle', name, amount })),
  ]
  return { unitPrice, regularPrice, fullPrice, discounts, specials: [...used.keys()], bundles: [...usedB.keys()] }
}
// บรรทัดส่วนลดสำหรับแสดงผล (คูณจำนวน)
export const discountLines = (discounts, qty = 1) =>
  (discounts || []).map((d) => ({ label: `${d.kind === 'bundle' ? 'บันเดิ้ล' : d.kind === 'promo' ? 'โปรส่วนลด' : 'ราคาพิเศษ'}: ${d.name}`, amount: d.amount * qty }))

// ยอดสินค้าสุทธิรายรายการ (หลังส่วนลดรายการ + แบ่งส่วนลดระดับบิลตามสัดส่วน) ไม่รวมค่าส่ง/VAT ไม่ติดลบ → ใช้คิดคะแนน/สิทธิ์หมุน
// ส่วนลดระดับบิล = ปรับราคาติดลบ + ส่วนลดจากคะแนน + คูปอง (ปรับราคาที่เป็นบวกไม่นับ)
export function itemNets(order) {
  const lines = order.items.map((i) => i.unitPrice * i.qty)
  const sub = lines.reduce((a, b) => a + b, 0)
  if (!(sub > 0)) return lines.map(() => 0)
  const adj = Number(order.adjustment?.amount) || 0
  const bill = (adj < 0 ? -adj : 0) + (Number(order.pointsUsed?.amount) || 0) + (order.couponsUsed || []).reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const k = Math.max(0, 1 - bill / sub)
  return lines.map((l) => l * k)
}

export function orderTotals(order) {
  const subtotal = order.items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const shipping = order.fulfillment === 'delivery' ? Number(order.shippingFee) || 0 : 0
  const adjustment = Number(order.adjustment?.amount) || 0
  // ส่วนลดจากคะแนน / คูปอง
  const pointsDiscount = Number(order.pointsUsed?.amount) || 0
  const couponDiscount = (order.couponsUsed || []).reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const total = subtotal + shipping + adjustment - pointsDiscount - couponDiscount
  const paid = order.payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  const reported = order.payments.filter((p) => p.status === 'reported').reduce((s, p) => s + p.amount, 0)
  const refunded = Number(order.cancel?.refundAmount) || 0
  // ราคาเต็ม + ส่วนลดทุกแหล่ง (ราคาพิเศษ/บันเดิ้ลรวมตามชื่อ, ปรับราคาที่ติดลบ, คะแนน, คูปอง)
  const full = order.items.reduce((s, i) => s + (i.fullPrice ?? i.unitPrice) * i.qty, 0)
  const byName = new Map()
  for (const i of order.items) for (const l of discountLines(i.discounts, i.qty)) byName.set(l.label, (byName.get(l.label) || 0) + l.amount)
  const itemDiscounts = [...byName].map(([label, amount]) => ({ label, amount }))
  const discountLinesAll = [
    ...itemDiscounts,
    ...(adjustment < 0 ? [{ label: `ปรับราคา${order.adjustment?.reason ? ` (${order.adjustment.reason})` : ''}`, amount: -adjustment }] : []),
    ...(pointsDiscount ? [{ label: `ใช้ ${order.pointsUsed.points} คะแนน`, amount: pointsDiscount }] : []),
    ...(order.couponsUsed || []).filter((c) => Number(c.amount)).map((c) => ({ label: `คูปอง: ${c.name}`, amount: Number(c.amount) })),
  ]
  const discountTotal = discountLinesAll.reduce((s, l) => s + l.amount, 0) + (full - subtotal - itemDiscounts.reduce((s, l) => s + l.amount, 0))
  const netGoods = itemNets(order).reduce((a, b) => a + b, 0)
  return { netGoods, subtotal, shipping, adjustment, pointsDiscount, couponDiscount, total, paid, reported, refunded, balance: total - paid, full, itemDiscounts, discountLines: discountLinesAll, discountTotal }
}

// แปลงตัวเลือกเป็นข้อความอ่านง่าย (หลายชั้นขึ้นต้นด้วย "ชั้น n")
export function describeSelections(item, groups) {
  const out = []
  const push = (g, sel, label) => {
    if (sel == null || sel === '' || (Array.isArray(sel) && !sel.length)) return
    if (g.type === 'text') return out.push({ group: label, value: sel })
    const names = idsOf(sel).map((id) => g.options.find((o) => o.id === id)?.name).filter(Boolean)
    if (names.length) out.push({ group: label, value: names.join(', ') })
  }
  const tiers = tiersOf(item)
  const tierGroups = groups.filter((g) => isTierGroup(g, item))
  tiers.forEach((t, i) => {
    for (const g of tierGroups) push(g, t.selections?.[g.id], tiers.length > 1 ? `ชั้น ${i + 1} · ${g.name}` : g.name)
  })
  for (const g of groups) if (!isTierGroup(g, item)) push(g, item.selections?.[g.id], g.name)
  return out
}
