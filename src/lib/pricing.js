// ราคาต่อชิ้น = ราคาฐาน (ตามขนาด หรือราคาเค้กสำเร็จ) + ตัวเลือก (คงที่ หรือ ต่อปอนด์)

// ---------- ราคาพิเศษ ----------
// แบบที่ใช้งานอยู่ ณ วันที่ (YYYY-MM-DD) = เปิดใช้งาน และ (ไม่กำหนดเวลา หรืออยู่ในช่วง from–to)
export function activeLists(lists, dateStr) {
  return (lists || []).filter(
    (l) => l.active !== false && (!l.scheduled || ((!l.from || l.from <= dateStr) && (!l.to || dateStr <= l.to))),
  )
}

// ราคาที่ใช้จริง: ราคาพิเศษต่ำสุดจากแบบที่ใช้งาน ถ้าไม่มีใช้ราคาปกติ
export function effectivePrice(entity, active = []) {
  let best = null
  for (const l of active) {
    const v = entity?.special?.[l.id]
    if (v == null || v === '') continue
    if (!best || Number(v) < best.price) best = { price: Number(v), list: l }
  }
  return best || { price: entity?.price || 0, list: null }
}

// ใช้ราคาของ entity และจดชื่อแบบราคาพิเศษที่ถูกใช้
function useP(entity, active, used) {
  const r = effectivePrice(entity, active)
  if (r.list && used) used.add(r.list.name)
  return r.price
}

// ---------- ชั้นของเค้ก ----------
// สั่งทำ: tiers = [{ selections }] กลุ่มที่เปิด perTier เลือกแยกในแต่ละชั้น กลุ่มอื่นอยู่ใน item.selections
// รายการที่ไม่มี tiers (หรือเค้กสำเร็จ) ถือเป็น 1 ชั้นที่ใช้ item.selections
export const tiersOf = (item) => (item.kind === 'custom' && item.tiers?.length ? item.tiers : [{ selections: item.selections || {} }])
export const isTierGroup = (g, item) => item.kind === 'custom' && !!g.perTier
const idsOf = (sel) => (sel == null ? [] : Array.isArray(sel) ? sel : [sel])

// ราคาและปอนด์รวมของขนาดที่เลือก (รองรับเลือกหลายขนาด)
function sizeIn(sizeGroup, selections, active, used) {
  const opts = sizeGroup ? idsOf(selections?.[sizeGroup.id]).map((id) => sizeGroup.options.find((o) => o.id === id)).filter(Boolean) : []
  return {
    price: opts.reduce((s, o) => s + useP(o, active, used), 0),
    pounds: opts.reduce((s, o) => s + (o.pounds || 0), 0),
  }
}

// base = ราคาฐาน, pounds = ปอนด์รวม, tierPounds = ปอนด์ของแต่ละชั้น
export function itemBase(item, groups, products, active = [], used = null) {
  const sizeGroup = groups.find((g) => g.key === 'size')
  if (item.kind === 'ready') {
    const p = products.find((x) => x.id === item.productId)
    const size = sizeIn(sizeGroup, item.selections, active, used)
    const pounds = p?.pounds || 1
    return { base: (p ? useP(p, active, used) : 0) + size.price, pounds, tierPounds: [pounds] }
  }
  const tiers = tiersOf(item)
  if (sizeGroup && isTierGroup(sizeGroup, item)) {
    const sizes = tiers.map((t) => sizeIn(sizeGroup, t.selections, active, used))
    const tierPounds = sizes.map((x) => x.pounds || 1)
    return { base: sizes.reduce((s, x) => s + x.price, 0), pounds: tierPounds.reduce((s, x) => s + x, 0), tierPounds }
  }
  const size = sizeIn(sizeGroup, item.selections, active, used)
  const pounds = size.pounds || 1
  return { base: size.price, pounds, tierPounds: tiers.map(() => pounds / tiers.length) }
}

export function calcUnitPrice(item, groups, products, active = [], used = null) {
  const { base, pounds, tierPounds } = itemBase(item, groups, products, active, used)
  const tiers = tiersOf(item)
  let extra = 0
  const add = (g, sel, lb) => {
    for (const id of idsOf(sel)) {
      const o = g.options.find((x) => x.id === id)
      if (!o) continue
      const price = useP(o, active, used)
      extra += o.priceType === 'per_pound' ? price * lb : price
    }
  }
  for (const g of groups) {
    if (g.key === 'size' || g.type === 'text') continue
    if (isTierGroup(g, item)) tiers.forEach((t, i) => add(g, t.selections?.[g.id], tierPounds[i]))
    else add(g, item.selections?.[g.id], pounds)
  }
  return base + extra
}

// ราคาที่ใช้ + ราคาปกติ + ชื่อแบบราคาพิเศษที่ใช้
export function priceDetail(item, groups, products, active = []) {
  const used = new Set()
  const unitPrice = calcUnitPrice(item, groups, products, active, used)
  const regularPrice = calcUnitPrice(item, groups, products)
  return { unitPrice, regularPrice, specials: [...used] }
}

export function orderTotals(order) {
  const subtotal = order.items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const shipping = order.fulfillment === 'delivery' ? Number(order.shippingFee) || 0 : 0
  const adjustment = Number(order.adjustment?.amount) || 0
  const total = subtotal + shipping + adjustment
  const paid = order.payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  const reported = order.payments.filter((p) => p.status === 'reported').reduce((s, p) => s + p.amount, 0)
  const refunded = Number(order.cancel?.refundAmount) || 0
  return { subtotal, shipping, adjustment, total, paid, reported, refunded, balance: total - paid }
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
