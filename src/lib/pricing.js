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
import { MAIN_KEYS as MAIN } from './constants'

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
export const shapePrice = (o, active = [], used = null) => (o ? pickSpecial(Number(o.price) || 0, active, (l) => l.shapes?.[o.id], used) : 0)
export const stylePrice = (o, active = [], used = null) => (o ? pickSpecial(Number(o.price) || 0, active, (l) => l.styles?.[o.id], used) : 0)

// ราคา 1 ชั้น (หรือเค้กสำเร็จ 1 ก้อน)
export function mainPrice(typeIds, flavorIds, sizeId, groups, active = [], used = null, styleIds = null, shapeIds = null) {
  const find = (key, id) => groups.find((g) => g.key === key)?.options.find((o) => o.id === id)
  let sum = 0
  for (const id of idsOf(typeIds)) {
    const t = find('type', id)
    sum += typePrice(t, active, used) + typeSizePrice(t, sizeId, active, used)
  }
  for (const id of idsOf(flavorIds)) sum += flavorPrice(find('flavor', id), active, used)
  for (const id of idsOf(styleIds)) sum += stylePrice(find('style', id), active, used)
  for (const id of idsOf(shapeIds)) sum += shapePrice(find('shape', id), active, used)
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
  const style = groups.find((g) => g.key === 'style')
  const shape = groups.find((g) => g.key === 'shape')
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
    base += mainPrice(sel(type), sel(flavor), sid, groups, active, used, sel(style), sel(shape))
  }
  return { base, pounds: tierPounds.reduce((a, b) => a + b, 0), tierPounds, tierSizes, tierTypes }
}

// ---------- รูปแบบตกแต่ง → หัวข้อรองที่เลือกได้ ----------
// ตัวเลือกของกลุ่ม style มี groups = [groupId] (ว่าง/ไม่มี = ทุกหัวข้อ) · กลุ่มหลักไม่ถูกจำกัด
// item/ชั้น t: รูปแบบอยู่ในชั้น (perTier) หรือทั้งก้อนก็ได้ · คืน (g) => เลือกหัวข้อนี้ได้ไหม
export function groupOkFor(groups, item, t) {
  const sg = groups.find((g) => g.key === 'style')
  if (!sg) return () => true
  const sels = (isTierGroup(sg, item) ? t?.selections : item.selections) || {}
  const opt = sg.options.find((o) => o.id === idsOf(sels[sg.id])[0])
  const only = opt?.groups
  return (g) => MAIN.includes(g.key) || !only?.length || only.includes(g.id)
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
const keyOf = (x) => `${x.groupId}:${x.optionId}`
export const bundleAmount = (b, typeId, sizeIds) => sizeIds.reduce((s, sid) => s + (num(b.typeDiscount?.[typeId]?.[sid]) ?? (Number(b.discount?.[sid]) || 0)), 0)
// 1 หัวข้อ (กลุ่มตัวเลือก) ได้ส่วนลดบันเดิ้ลสูงสุด 1 ชุด · หัวข้อของบันเดิ้ล = กลุ่มของตัวเลือกแรก (ข้ามกลุ่มนับเป็นของกลุ่มแรก)
// ถ้าเข้าเงื่อนไขหลายชุดในหัวข้อเดียวกัน → ใช้ชุดที่ลดน้อยที่สุด (ชุดที่ส่วนลด 0 ไม่นับ) · ต่างหัวข้อใช้พร้อมกันได้ ถ้าไม่ใช้ตัวเลือกซ้ำกัน
// ทุกชุดที่ครบ (ส่วนลด > 0) ใช้ได้พร้อมกัน ถ้าไม่ใช้ตัวเลือกซ้ำกัน · ซ้ำกัน: ชุดหลายตัวเลือกมาก่อนตัวเดี่ยว แล้วส่วนลดมากกว่า
// c = [{ b, amount }] → ชุดที่ได้ใช้จริง
export function bundleWinners(c) {
  const taken = new Set()
  const out = []
  for (const x of [...c].sort((p, q) => (q.b.items.length > 1) - (p.b.items.length > 1) || q.amount - p.amount)) {
    const keys = x.b.items.map(keyOf)
    if (keys.some((k) => taken.has(k))) continue
    keys.forEach((k) => taken.add(k))
    out.push(x)
  }
  return out
}
export function bundleDiscount(bundles, picked, sizeIds, usedBundles = null, typeId = null) {
  const c = []
  for (const b of bundles) {
    if (b.active === false || !forType(b, typeId) || !(b.items?.length > 0) || !b.items.every((x) => picked.has(keyOf(x)))) continue
    const amount = bundleAmount(b, typeId, sizeIds)
    if (amount > 0) c.push({ b, amount })
  }
  let total = 0
  for (const w of bundleWinners(c)) {
    total += w.amount
    if (usedBundles) note(usedBundles, w.b.name, w.amount)
  }
  return total
}

// แนะนำบันเดิ้ล: เลือกตัวเลือกในบันเดิ้ลแล้วแต่ยังไม่ครบชุด → ตัวที่ขาด + ส่วนลดที่จะได้ (ตามขนาด/ประเภทตอนนี้)
// sels = ตัวเลือกที่เลือกอยู่ (รวมของชั้น+ทั้งก้อน) · allow(g, o|null) = กติกาเดิมของตัวตั้งค่า (ประเภท/รูปแบบตกแต่ง)
// เสนอเฉพาะเมื่อเพิ่มได้จริง: ตัวเลือกเปิดใช้งาน ใช้กับประเภทนี้ได้ และไม่ต้องทับค่าที่เลือกไว้ (กลุ่ม multi หรือกลุ่ม single ที่ยังว่าง)
// ประเภท/ขนาดที่ใช้คิดบันเดิ้ลชุดหนึ่ง ให้ตรงตัวคิดราคา: มีกลุ่มแยกชั้น → ใช้ของชั้น · ไม่มี → ขนาดรวมทุกชั้น + ประเภทชั้นที่ 1
// scopes = { tier: { typeId, sizeIds }, whole: { typeId, sizeIds } } (ไม่ส่ง = ใช้ typeId/sizeIds ตรง ๆ)
export const bundleScope = (b, groups, scopes, dflt) => {
  if (!scopes) return dflt
  const isTier = b.items.some((x) => groups.find((g) => g.id === x.groupId)?.perTier)
  return (isTier ? scopes.tier : scopes.whole) || dflt
}

export function bundleHints(bundles, groups, sels, { typeId = null, sizeIds = [], allow = null, limit = 2, scopes = null } = {}) {
  const dT = typeId, dS = sizeIds
  const has = (x) => idsOf(sels?.[x.groupId]).includes(x.optionId)
  // ชุดที่ครบแล้ว (ใช้จริง) → ชุดอื่นที่ใช้ตัวเลือกซ้ำกันไม่ทำให้ส่วนลดเพิ่ม → ไม่แนะนำ
  const doneC = []
  for (const b of bundles || []) {
    if (b.active === false || !(b.items?.length > 0) || !b.items.every(has)) continue
    const sc = bundleScope(b, groups, scopes, { typeId: dT, sizeIds: dS })
    const amount = forType(b, sc.typeId) ? bundleAmount(b, sc.typeId, sc.sizeIds) : 0
    if (amount > 0) doneC.push({ b, amount })
  }
  const sum = (l) => l.reduce((t, x) => t + x.amount, 0)
  const base = sum(bundleWinners(doneC))
  const out = []
  for (const b of bundles || []) {
    const { typeId, sizeIds } = b.items?.length ? bundleScope(b, groups, scopes, { typeId: dT, sizeIds: dS }) : { typeId: dT, sizeIds: dS }
    if (b.active === false || !forType(b, typeId) || !(b.items?.length > 1)) continue
    const have = b.items.filter(has)
    if (!have.length || have.length < b.items.length - 1 || have.length === b.items.length) continue
    const amount = bundleAmount(b, typeId, sizeIds)
    if (!(amount > 0)) continue
    const missing = []
    let ok = true
    for (const x of b.items.filter((y) => !has(y))) {
      const g = groups.find((z) => z.id === x.groupId)
      const o = g?.options?.find((z) => z.id === x.optionId)
      if (!g || g.active === false || !o || o.active === false || !forType(o, typeId) || (allow && !(allow(g, null) && allow(g, o)))) { ok = false; break }
      if (g.type !== 'multi' && idsOf(sels?.[g.id]).length) { ok = false; break }
      missing.push({ groupId: g.id, optionId: o.id, name: o.name, groupName: g.name })
    }
    if (ok && sum(bundleWinners([...doneC, { b, amount }])) > base) out.push({ bundle: b, missing, amount })
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, limit)
}

// ป้ายบนตัวเลือกที่อยู่ในบันเดิ้ล: Map("groupId:optionId" → { state, amount, names })
// state: 'done' = ครบชุดแล้ว (ได้ส่วนลด) · 'partner' = เลือกคู่ไว้แล้ว ตัวนี้เลือกแล้วครบชุดทันที · 'idle' = อยู่ในบันเดิ้ล ยังไม่ได้เลือกคู่
// เฉพาะบันเดิ้ลที่ใช้ได้จริงตอนนี้ (ใช้งาน ตรงประเภท ส่วนลดตามขนาด > 0) · หลายบันเดิ้ล: done > partner > idle แล้วส่วนลดมากสุด
// ป้ายแสดงเมื่อ: ชุดหลายตัวเลือก (N ตัว) = เลือกแล้วอย่างน้อย N-1 ตัว · บันเดิ้ลตัวเลือกเดียว = เลือกครบหัวข้อหลักทุกข้อ (single → "ลดพิเศษ")
const RANK = { idle: 0, partner: 1, done: 2 }
export function bundleTags(bundles, groups, sels, { typeId: dT = null, sizeIds: dS = [], allow = null, scopes = null } = {}) {
  const tags = new Map()
  const has = (x) => idsOf(sels?.[x.groupId]).includes(x.optionId)
  const put = (x, state, amount, name, single) => {
    const k = `${x.groupId}:${x.optionId}`
    const cur = tags.get(k)
    if (!cur || RANK[state] > RANK[cur.state] || (state === cur.state && amount > cur.amount)) tags.set(k, { state, amount, names: [name], single })
    else if (state === cur.state && amount === cur.amount && !cur.names.includes(name)) cur.names.push(name)
  }
  // 1) รวบรวมบันเดิ้ลที่ใช้ได้ + สถานะ
  const cands = []
  for (const b of bundles || []) {
    if (b.active === false || !(b.items?.length > 0)) continue
    const { typeId, sizeIds } = bundleScope(b, groups, scopes, { typeId: dT, sizeIds: dS })
    if (!forType(b, typeId)) continue
    const amount = bundleAmount(b, typeId, sizeIds)
    if (!(amount > 0)) continue
    const usable = (x) => {
      const g = groups.find((z) => z.id === x.groupId)
      const o = g?.options?.find((z) => z.id === x.optionId)
      return !!g && g.active !== false && !!o && o.active !== false && forType(o, typeId) && !(allow && !(allow(g, null) && allow(g, o)))
    }
    if (!b.items.every(usable)) continue
    cands.push({ b, amount, home: b.items[0].groupId, done: b.items.every(has) })
  }
  // ประตูแสดงป้าย: บันเดิ้ลตัวเลือกเดียว = เลือกครบหัวข้อหลักทุกข้อก่อน · ชุดหลายตัวเลือก = ต้องเลือกตัวใดตัวหนึ่งที่อยู่ในชุดบันเดิ้ลก่อน
  const mainGroups = groups.filter((g) => MAIN.includes(g.key) && g.active !== false && g.options?.some((o) => o.active !== false) && !(allow && !allow(g, null)))
  const mainDone = mainGroups.every((g) => idsOf(sels?.[g.id]).length > 0)
  // ชุดมี N ตัวเลือก: ต้องเลือกแล้วอย่างน้อย N-1 ตัวจึงขึ้นป้าย (ตัวที่เหลือ = ตัวสุดท้ายที่ทำให้ครบชุด)
  const setReady = (c) => c.b.items.filter(has).length >= c.b.items.length - 1
  for (let i = cands.length - 1; i >= 0; i--) if (cands[i].b.items.length > 1 ? !setReady(cands[i]) : !mainDone) cands.splice(i, 1)
  // 2) ให้ตรงตัวคิดราคา: 1 หัวข้อ = 1 ชุด (ลดน้อยสุด) และไม่ใช้ตัวเลือกซ้ำ
  //    หัวข้อที่ได้บันเดิ้ลแล้ว → ชุดอื่นในหัวข้อเดียวกันไม่ทำให้ส่วนลดเพิ่ม จึงไม่ติดป้าย (ป้ายเดียวที่เหลือคือชุดที่ใช้จริง)
  const winners = new Set(bundleWinners(cands.filter((c) => c.done)))
  const sum = (l) => l.reduce((t, x) => t + x.amount, 0)
  const doneC = cands.filter((c) => c.done)
  const base = sum(bundleWinners(doneC))
  for (const c of cands) {
    const { b, amount } = c
    const single = b.items.length === 1
    if (c.done) { if (winners.has(c)) for (const x of b.items) put(x, 'done', amount, b.name, single); continue }
    if (!(sum(bundleWinners([...doneC, c])) > base)) continue // ครบชุดนี้แล้วส่วนลดรวมไม่เพิ่ม (ตัวเลือกซ้ำกับชุดอื่นที่ได้ไปแล้ว) → ไม่ติดป้าย
    const have = b.items.filter(has)
    const missing = b.items.filter((x) => !has(x))
    // ตัวที่ขาดเพียงตัวเดียวและมีตัวอื่นเลือกอยู่ = "ตัวสุดท้ายที่ทำให้ครบชุด"
    const last = have.length > 0 && missing.length === 1
    for (const x of missing) put(x, last && !single ? 'partner' : 'idle', amount, b.name, single)
    for (const x of have) put(x, 'idle', amount, b.name, single)
  }
  return tags
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
  const okWhole = groupOkFor(groups, item, tiers[0])
  const wholePicked = pick(wholeG.filter(okWhole), item.selections, wholeType)
  let extra = priceOf(wholePicked, wholeType, allSizes)
  const isTierB = (b) => b.items.some((x) => tierG.some((g) => g.id === x.groupId))
  const tierB = bundles.filter(isTierB)
  const wholeB = bundles.filter((b) => !isTierB(b))
  tiers.forEach((t, i) => {
    const okT = groupOkFor(groups, item, t)
    const tp = pick(tierG.filter(okT), t.selections, tierTypes[i])
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
  (discounts || []).map((d) => ({ label: `${d.kind === 'bundle' ? 'บันเดิ้ล' : d.kind === 'promo' ? 'โปรส่วนลด' : d.kind === 'gift' ? 'ของแถม' : 'ราคาพิเศษ'}: ${d.name}`, amount: d.amount * qty }))

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

// ค่าส่งก่อน VAT (ใช้คิดกำไร: ค่าส่งรับเป็นรายได้และจ่ายคนส่งเต็มจำนวน = ต้นทุนเท่ากัน กำไรจากค่าส่ง 0)
export const shipNetOf = (t) => (t.shipping > 0 ? Math.round((t.vatMode === 'inclusive' ? (t.shipping * 100) / (100 + t.vatRate) : t.shipping) * 100) / 100 : 0)

export function orderTotals(order) {
  const subtotal = order.items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const shipFee = order.fulfillment === 'delivery' ? Number(order.shippingFee) || 0 : 0
  const shipWaived = order.shipPromo?.free ? shipFee : 0 // ดีลส่งฟรี
  const shipping = shipFee - shipWaived
  const adjustment = Number(order.adjustment?.amount) || 0
  // ส่วนลดจากคะแนน / คูปอง
  const pointsDiscount = Number(order.pointsUsed?.amount) || 0
  const couponDiscount = (order.couponsUsed || []).reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const gross = subtotal + shipping + adjustment - pointsDiscount - couponDiscount
  // VAT: order.vat = { rate, mode: 'inclusive' | 'exclusive' } (snapshot ตอนสร้างออร์เดอร์ ไม่มี = ไม่คิด VAT)
  // ฐานภาษี = สินค้า + ค่าส่ง หลังส่วนลดทุกประเภท · ใน = ราคารวม VAT แล้ว (แยกบรรทัดแสดง) · นอก = บวกเพิ่มท้ายยอด
  const rate = Number(order.vat?.rate) || 0
  const vatMode = rate > 0 ? (order.vat.mode === 'exclusive' ? 'exclusive' : 'inclusive') : null
  const base = Math.max(gross, 0)
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
  const vat = vatMode === 'exclusive' ? r2((base * rate) / 100) : vatMode === 'inclusive' ? r2((base * rate) / (100 + rate)) : 0
  const vatAdd = vatMode === 'exclusive' ? vat : 0
  const total = gross + vatAdd
  const beforeVat = total - vat // ยอดก่อน VAT (ใช้เป็นรายได้/กำไร)
  const paid = order.payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  const reported = order.payments.filter((p) => p.status === 'reported').reduce((s, p) => s + p.amount, 0)
  const returned = r2((order.returns || []).filter((x) => !x.cancelled).reduce((s, x) => s + (Number(x.amount) || 0), 0)) // คืนเงินบางส่วนโดยไม่ยกเลิก
  const refunded = r2((Number(order.cancel?.refundAmount) || 0) + returned)
  const paidNet = r2(paid - returned) // เงินที่ยังอยู่กับร้านหลังคืนบางส่วน (เพดานคืนเงินครั้งต่อไป/ตอนยกเลิก)
  // ราคาเต็ม + ส่วนลดทุกแหล่ง (ราคาพิเศษ/บันเดิ้ลรวมตามชื่อ, ปรับราคาที่ติดลบ, คะแนน, คูปอง)
  const full = order.items.reduce((s, i) => s + (i.fullPrice ?? i.unitPrice) * i.qty, 0)
  const byName = new Map()
  for (const i of order.items) for (const l of discountLines(i.discounts, i.qty)) byName.set(l.label, (byName.get(l.label) || 0) + l.amount)
  const itemDiscounts = [...byName].map(([label, amount]) => ({ label, amount }))
  const discountLinesAll = [
    ...itemDiscounts,
    ...(shipWaived ? [{ label: `ส่งฟรี: ${order.shipPromo.name}`, amount: shipWaived }] : []),
    ...(adjustment < 0 ? [{ label: `ปรับราคา${order.adjustment?.reason ? ` (${order.adjustment.reason})` : ''}`, amount: -adjustment }] : []),
    ...(pointsDiscount ? [{ label: `ใช้ ${order.pointsUsed.points} คะแนน`, amount: pointsDiscount }] : []),
    ...(order.couponsUsed || []).filter((c) => Number(c.amount)).map((c) => ({ label: `คูปอง: ${c.name}`, amount: Number(c.amount) })),
  ]
  const discountTotal = discountLinesAll.reduce((s, l) => s + l.amount, 0) + (full - subtotal - itemDiscounts.reduce((s, l) => s + l.amount, 0))
  const netGoods = itemNets(order).reduce((a, b) => a + b, 0)
  const fullAll = full + shipFee + Math.max(adjustment, 0) + vatAdd // ราคาเต็มรวมค่าส่ง/VAT (ใช้เทียบกับยอดสุทธิในป้ายส่วนลด)
  return { vat, vatAdd, vatRate: vatMode ? rate : 0, vatMode, beforeVat, fullAll, netGoods, subtotal, shipping, adjustment, pointsDiscount, couponDiscount, total, paid, paidNet, returned, reported, refunded, balance: total - paid, full, itemDiscounts, discountLines: discountLinesAll, discountTotal }
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
    const ok = groupOkFor(groups, item, t)
    for (const g of tierGroups.filter(ok)) push(g, t.selections?.[g.id], tiers.length > 1 ? `ชั้น ${i + 1} · ${g.name}` : g.name)
  })
  const okW = groupOkFor(groups, item, tiers[0])
  for (const g of groups) if (!isTierGroup(g, item) && okW(g)) push(g, item.selections?.[g.id], g.name)
  return out
}
