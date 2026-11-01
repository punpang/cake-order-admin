// ราคาต่อชิ้น = ราคาเค้กหลัก (หน้าเค้กตามขนาด + เนื้อเค้ก + ขนาด) + ตัวเลือกรอง (คงที่ / ต่อปอนด์ / ตามขนาด) − บันเดิ้ล

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

// ---------- ตัวเลือกหลักที่หน้าเค้กอนุญาต ----------
// ตัวเลือกของหน้าเค้กมี allow = { [groupId]: [optionId] } ไม่มี key = เลือกได้ทุกตัว
export function allowedBy(groups, selections) {
  const face = groups.find((g) => g.key === 'face')
  const sel = face ? selections?.[face.id] : null
  const ids = sel == null ? [] : Array.isArray(sel) ? sel : [sel]
  const faces = ids.map((id) => face.options.find((o) => o.id === id)).filter(Boolean)
  return (g, o) => faces.every((f) => !f.allow?.[g.id] || f.allow[g.id].includes(o.id))
}

// ---------- ชั้นของเค้ก ----------
// สั่งทำ: tiers = [{ selections }] กลุ่มที่เปิด perTier เลือกแยกในแต่ละชั้น กลุ่มอื่นอยู่ใน item.selections
// รายการที่ไม่มี tiers (หรือเค้กสำเร็จ) ถือเป็น 1 ชั้นที่ใช้ item.selections
export const tiersOf = (item) => (item.kind === 'custom' && item.tiers?.length ? item.tiers : [{ selections: item.selections || {} }])
export const isTierGroup = (g, item) => item.kind === 'custom' && !!g.perTier
const idsOf = (sel) => (sel == null ? [] : Array.isArray(sel) ? sel : [sel])

// ---------- ราคาเค้กหลัก: หน้าเค้ก (ตามขนาด) + เนื้อเค้ก (คงที่) + ขนาด ----------
// ขนาด = sizeOption.price · หน้าเค้ก = faceOption.sizePrices[sizeId] · เนื้อเค้ก = flavorOption.price (เท่ากันทุกขนาด)
// ราคาพิเศษ: priceList.sizes = { [sizeId] }, faces = { [faceId]: { [sizeId] } }, flavors = { [flavorId] } ช่องว่าง = ใช้ราคาปกติ
// หลายแบบพร้อมกัน ใช้ราคาต่ำสุดแยกทีละช่อง
function pickSpecial(regular, active, get, used) {
  let best = null
  for (const l of active) {
    const v = get(l)
    if (v == null || v === '') continue
    if (!best || Number(v) < best.price) best = { price: Number(v), list: l }
  }
  if (best && used) used.add(best.list.name)
  return best ? best.price : regular
}
export const sizePrice = (size, active = [], used = null) => (size ? pickSpecial(Number(size.price) || 0, active, (l) => l.sizes?.[size.id], used) : 0)
export const facePrice = (face, sizeId, active = [], used = null) =>
  face && sizeId ? pickSpecial(Number(face.sizePrices?.[sizeId]) || 0, active, (l) => l.faces?.[face.id]?.[sizeId], used) : 0
export const flavorPrice = (flavor, active = [], used = null) => (flavor ? pickSpecial(Number(flavor.price) || 0, active, (l) => l.flavors?.[flavor.id], used) : 0)

// ราคา 1 ชั้น (หรือเค้กสำเร็จ 1 ก้อน)
export function mainPrice(faceIds, flavorIds, sizeId, groups, active = [], used = null) {
  const find = (key, id) => groups.find((g) => g.key === key)?.options.find((o) => o.id === id)
  let sum = sizePrice(find('size', sizeId), active, used)
  for (const id of idsOf(faceIds)) sum += facePrice(find('face', id), sizeId, active, used)
  for (const id of idsOf(flavorIds)) sum += flavorPrice(find('flavor', id), active, used)
  return sum
}
// เค้กสำเร็จ: กำหนด หน้าเค้ก + เนื้อเค้ก + ขนาด ในหน้าสินค้า
export const productPrice = (p, groups, active = [], used = null) => (p ? mainPrice(p.faceId, p.flavorId, p.sizeId, groups, active, used) : 0)
export const productPounds = (p, groups) => groups.find((g) => g.key === 'size')?.options.find((o) => o.id === p?.sizeId)?.pounds || 1

// base = ราคาเค้กหลัก (รวมทุกชั้น), pounds = ปอนด์รวม, tierPounds / tierSizes = ปอนด์และขนาดของแต่ละชั้น
// สั่งทำ: แต่ละชั้น = ขนาดของชั้น + หน้าเค้ก (ตามขนาดของชั้น) + เนื้อเค้ก แล้วรวมทุกชั้น
export function itemBase(item, groups, products, active = [], used = null) {
  const sizeGroup = groups.find((g) => g.key === 'size')
  if (item.kind === 'ready') {
    const p = products.find((x) => x.id === item.productId)
    const pounds = productPounds(p, groups)
    return { base: productPrice(p, groups, active, used), pounds, tierPounds: [pounds], tierSizes: [p?.sizeId ? [p.sizeId] : []] }
  }
  const face = groups.find((g) => g.key === 'face')
  const flavor = groups.find((g) => g.key === 'flavor')
  let base = 0
  const tierPounds = []
  const tierSizes = []
  for (const t of tiersOf(item)) {
    const sel = (g) => (g ? (isTierGroup(g, item) ? t.selections : item.selections)?.[g.id] : null)
    const sid = idsOf(sel(sizeGroup))[0] // 1 ขนาดต่อชั้น (รายการเก่าที่เลือกหลายขนาดใช้ขนาดแรก)
    tierPounds.push(sizeGroup?.options.find((o) => o.id === sid)?.pounds || 1)
    tierSizes.push(sid ? [sid] : [])
    base += mainPrice(sel(face), sel(flavor), sid, groups, active, used)
  }
  return { base, pounds: tierPounds.reduce((a, b) => a + b, 0), tierPounds, tierSizes }
}

// ราคาตัวเลือกแบบ "ตามขนาด": รวมราคาของขนาดที่เลือก (sizePrices = { [sizeOptionId]: ราคา })
export const sizePriceOf = (o, sizeIds) => sizeIds.reduce((s, id) => s + (Number(o.sizePrices?.[id]) || 0), 0)

// บันเดิ้ล: เลือกครบทุกตัวในคู่ (กลุ่มเดียวกัน) ลดตามขนาด discount = { [sizeOptionId]: บาท }
// ถ้าซ้อนกัน ใช้คู่ที่ลดมากสุดก่อน ตัวเลือกหนึ่งใช้ได้กับบันเดิ้ลเดียว
export function bundleDiscount(g, ids, sizeIds, usedBundles = null) {
  const cands = (g.bundles || [])
    .filter((b) => b.active !== false && b.options?.length > 1 && b.options.every((id) => ids.includes(id)))
    .map((b) => ({ b, d: sizeIds.reduce((s, id) => s + (Number(b.discount?.[id]) || 0), 0) }))
    .sort((a, b) => b.d - a.d)
  const taken = new Set()
  let total = 0
  for (const c of cands) {
    if (c.b.options.some((id) => taken.has(id))) continue
    c.b.options.forEach((id) => taken.add(id))
    total += c.d
    if (usedBundles && c.d) usedBundles.add(c.b.name)
  }
  return total
}

// ราคา/ชิ้น = ราคาเค้กหลัก + ตัวเลือกรอง (คงที่ / ต่อปอนด์ / ตามขนาด) − บันเดิ้ล
export function calcUnitPrice(item, groups, products, active = [], used = null, usedBundles = null) {
  const { base, pounds, tierPounds, tierSizes } = itemBase(item, groups, products, active, used)
  const tiers = tiersOf(item)
  const allSizes = tierSizes.flat()
  let extra = 0
  const add = (g, sel, lb, sids) => {
    const ids = idsOf(sel)
    for (const id of ids) {
      const o = g.options.find((x) => x.id === id)
      if (!o) continue
      if (o.priceType === 'per_size') extra += sizePriceOf(o, sids)
      else {
        const price = useP(o, active, used)
        extra += o.priceType === 'per_pound' ? price * lb : price
      }
    }
    if (g.type === 'multi' && ids.length > 1) extra -= bundleDiscount(g, ids, sids, usedBundles)
  }
  for (const g of groups) {
    if (['face', 'flavor', 'size'].includes(g.key) || g.type === 'text') continue
    if (isTierGroup(g, item)) tiers.forEach((t, i) => add(g, t.selections?.[g.id], tierPounds[i], tierSizes[i]))
    else add(g, item.selections?.[g.id], pounds, allSizes)
  }
  return base + extra
}

// ราคาที่ใช้ + ราคาปกติ + ชื่อแบบราคาพิเศษที่ใช้
export function priceDetail(item, groups, products, active = []) {
  const used = new Set()
  const bundles = new Set()
  const unitPrice = calcUnitPrice(item, groups, products, active, used, bundles)
  const regularPrice = calcUnitPrice(item, groups, products)
  return { unitPrice, regularPrice, specials: [...used], bundles: [...bundles] }
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
  return { subtotal, shipping, adjustment, pointsDiscount, couponDiscount, total, paid, reported, refunded, balance: total - paid }
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
