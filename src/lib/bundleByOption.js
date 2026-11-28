// หน้าบันเดิ้ลแบบเลือกตัวเลือกหนึ่งตัว: หาชุดทั้งหมดที่มีตัวเลือกนั้น บอกว่าชุดไหนจะถูกข้ามเมื่อไร และตั้งส่วนลดต่อขนาด
// ลำดับการใช้ชุดตามโค้ดจริงใน pricing.js (bundleWinners): จำนวนตัวเลือกมากก่อน แล้วส่วนลดรวมมากก่อน และชุดที่ใช้ตัวเลือกซ้ำจะถูกข้าม
// ใช้ bundleAmount / regularTotal เดิม เพื่อให้ตัวเลขตรงกับที่ลูกค้าจ่าย · ไม่เปลี่ยนสูตรราคาและรูปแบบข้อมูล
import { bundleAmount, forType, calcUnitPrice, isOwnStyle } from './pricing.js'
import { regularTotal, makeDraft, autoBundleName, findItemOption } from './bundleEditor.js'

const keyOf = (x) => `${x.groupId}:${x.optionId}`
const sizeIdsOf = (sizes) => (sizes || []).map((s) => s.id)

// ยอดส่วนลดรวมของชุดในทุกขนาด (ช่องประเภท/รูปแบบไม่นับที่นี่ เพราะหน้านี้แก้เฉพาะช่องทุกชนิด)
const totalOf = (b, sizeIds) => sizeIds.reduce((s, sid) => s + (bundleAmount(b, null, [sid], null) || 0), 0)

// ลำดับเดียวกับ bundleWinners: จำนวนตัวเลือกมากก่อน แล้วส่วนลดรวมมากก่อน
const beforeInOrder = (a, b, sizeIds) => {
  const la = (a.items || []).length
  const lb = (b.items || []).length
  if (la !== lb) return la > lb
  return totalOf(a, sizeIds) > totalOf(b, sizeIds)
}

// ชุดทั้งหมดที่มีตัวเลือกนี้ เรียงตามลำดับการใช้ (ชุดที่ใหญ่หรือส่วนลดมากกว่าก่อน)
export function bundlesWithOption(bundles, x, sizes) {
  const k = keyOf(x)
  const sizeIds = sizeIdsOf(sizes)
  return (bundles || [])
    .filter((b) => (b.items || []).some((i) => keyOf(i) === k))
    .sort((p, q) => (beforeInOrder(p, q, sizeIds) ? -1 : beforeInOrder(q, p, sizeIds) ? 1 : 0))
}

// ชุดอื่นที่จะทำให้ชุดนี้ถูกข้าม: เปิดใช้งาน มีส่วนลด มีตัวเลือกร่วม และลำดับก่อนชุดนี้
export function conflictsOf(b, bundles, sizes) {
  const sizeIds = sizeIdsOf(sizes)
  const mine = new Set((b.items || []).map(keyOf))
  return (bundles || []).filter(
    (o) => o.id !== b.id && o.active !== false && totalOf(o, sizeIds) > 0 &&
      (o.items || []).some((i) => mine.has(keyOf(i))) && beforeInOrder(o, b, sizeIds),
  )
}

// สถานะของชุดในหน้า: off = ปิดอยู่ · nodiscount = ยังไม่มีส่วนลด · skipped = จะถูกข้ามถ้าลูกค้าเลือกชุดที่ใหญ่กว่า · ok = ใช้ได้
export function usageOf(b, bundles, sizes) {
  if (b.active === false) return { status: 'off', conflicts: [] }
  if (totalOf(b, sizeIdsOf(sizes)) <= 0) return { status: 'nodiscount', conflicts: [] }
  const conflicts = conflictsOf(b, bundles, sizes)
  return conflicts.length ? { status: 'skipped', conflicts } : { status: 'ok', conflicts: [] }
}

// ประเภทที่ชุดนี้ใช้ได้จริง: ประเภทที่ชุดเลือกไว้ (ว่าง = ทุกประเภทที่เปิดใช้) และทุกตัวเลือกในชุดใช้ได้กับประเภทนั้น · ไม่มีเลย = [] (ใช้ราคาทุกประเภท)
export function applicableTypes(b, groups, types) {
  const active = (types || []).filter((t) => t.active !== false).map((t) => t.id)
  const base = b.types?.length ? b.types.filter((id) => active.includes(id)) : active
  const opts = (b.items || []).map((x) => findItemOption(groups, x)).filter(Boolean)
  return base.filter((t) => opts.every((o) => forType(o, t)))
}

// แถวต่อประเภทและขนาด: ราคาปกติรวมตามราคาตัวเลือกของประเภทนั้น และส่วนลดที่มีผลจริงของประเภทนั้น
// ไม่มีประเภทที่ใช้ได้ = แถวเดียวของ "ทุกประเภท" (typeId null) เพื่อให้ยังเห็นค่าที่ตั้งไว้
export function discountRows(b, groups, sizes, types = []) {
  const typeName = (id) => (types || []).find((t) => t.id === id)?.name || ''
  const applicable = applicableTypes(b, groups, types)
  const scopes = applicable.length ? applicable : [null]
  const rows = []
  for (const t of scopes) {
    for (const s of sizes || []) {
      rows.push({
        typeId: t,
        typeName: typeName(t),
        sizeId: s.id,
        sizeName: s.name,
        regular: regularTotal(b.items || [], groups, t, s.id),
        amount: bundleAmount(b, t, [s.id], null) || 0,
        // มีการตั้งส่วนลดให้ช่องนี้แล้วหรือยัง ทั้งของประเภทนี้เอง หรือรับจากค่าทุกประเภท (ใช้เลือกค่าเริ่มต้นของช่องราคาขาย)
        set: [t ? b.typeDiscount?.[t]?.[s.id] : null, b.discount?.[s.id]].some((v) => v != null && v !== ''),
        // ราคาหลังหักส่วนลดที่ลูกค้าได้จริง: ส่วนลดไม่เกินราคาปกติ (ตรงกับ bundleAmountCapped)
        after: 0,
      })
    }
  }
  for (const r of rows) r.after = Math.max(0, r.regular - Math.min(r.amount, r.regular))
  return rows
}

// ตั้งส่วนลดของขนาดหนึ่งในช่องทุกประเภท (คืนชุดใหม่ ไม่แก้ต้นฉบับ · ค่าว่างลบค่า)
export function setSizeDiscount(b, sizeId, amount) {
  return setDiscountAt(b, null, sizeId, amount)
}

// ตั้งส่วนลดของขนาดหนึ่งในประเภทหนึ่ง (typeId null = ช่องทุกประเภท) · คืนชุดใหม่ ไม่แก้ต้นฉบับ · ค่าว่างลบค่า
export function setDiscountAt(b, typeId, sizeId, amount) {
  const next = JSON.parse(JSON.stringify(b))
  const val = amount == null || amount === '' ? null : Number(amount)
  if (typeId == null) {
    next.discount = { ...(next.discount || {}) }
    if (val == null) delete next.discount[sizeId]
    else next.discount[sizeId] = val
  } else {
    next.typeDiscount = { ...(next.typeDiscount || {}) }
    const row = { ...(next.typeDiscount[typeId] || {}) }
    if (val == null) delete row[sizeId]
    else row[sizeId] = val
    next.typeDiscount[typeId] = row
  }
  return next
}

// ราคาเค้กเต็มของประเภท + เนื้อ + ขนาด ที่มีตัวเลือกในชุดนี้ ตามเครื่องคิดราคาจริง (calcUnitPrice)
// active = รายการราคาพิเศษที่ใช้งานอยู่ ณ วันนี้ (เช่น activeListsAt) เพื่อให้ราคาขนาด/ประเภทตรงกับหน้าลูกค้า
// before = ก่อนใช้บันเดิ้ลนี้ · after = หลังใช้บันเดิ้ลนี้ (ไม่รวมชุดอื่น)
export function cakePriceFor(b, groups, { typeId = null, flavorId = null, sizeId = null } = {}, active = []) {
  const byKey = (key) => groups.find((g) => g.key === key)
  const sel = {}
  if (byKey('type') && typeId) sel[byKey('type').id] = typeId
  if (byKey('size') && sizeId) sel[byKey('size').id] = sizeId
  if (byKey('flavor') && flavorId) sel[byKey('flavor').id] = flavorId
  for (const x of b.items || []) {
    const g = groups.find((y) => y.id === x.groupId)
    if (!g) continue
    sel[g.id] = g.type === 'multi' ? [...(sel[g.id] || []), x.optionId] : x.optionId
  }
  const item = { kind: 'custom', qty: 1, selections: sel, tiers: [{ selections: sel }] }
  return {
    before: calcUnitPrice(item, groups, [], active, null, null, []),
    after: calcUnitPrice(item, groups, [], active, null, null, [b]),
  }
}

// ---------- ราคาแยกตามรูปแบบตกแต่ง (ตั้งจากหน้าตัวเลือกรูปแบบ) ----------
// แถวของทุกชุดสำหรับรูปแบบนี้: โหมด + ราคาปกติ/ราคาขายต่อขนาด · ราคาขายว่าง = ยังไม่ตั้งราคาของรูปแบบนี้
export function styleRowsOf(bundles, styleId, groups, sizes) {
  return (bundles || []).map((b) => {
    const regular = {}
    const sales = {}
    for (const sz of sizes || []) {
      const reg = regularTotal(b.items || [], groups, null, sz.id)
      const disc = b.styleDiscount?.[styleId]?.[sz.id]
      regular[sz.id] = reg
      sales[sz.id] = disc == null || disc === '' ? '' : String(Math.max(0, reg - (Number(disc) || 0)))
    }
    // ป้ายประเภทตัวเลือกรอง: "กลางเค้ก: ผลไม้รวม · ขอบข้างเค้ก: ..." (ให้รู้ว่าตัวเลือกไหนอยู่กลุ่มไหน)
    const parts = (b.items || []).map((x) => {
      const g = (groups || []).find((y) => y.id === x.groupId)
      const o = g?.options?.find((y) => y.id === x.optionId)
      return `${g?.name || ''}: ${o?.name || 'ตัวเลือกที่ถูกลบแล้ว'}`
    })
    return { id: b.id, name: b.name, groupLabel: parts.join(' · '), active: b.active !== false, mode: isOwnStyle(b, styleId) ? 'own' : 'central', regular, sales }
  })
}

// คืนชุดใหม่ (ไม่แก้ต้นฉบับ): ตั้งโหมดของรูปแบบนี้ และถ้าเป็น "ราคาของรูปแบบนี้" ส่วนลดต่อขนาด = ราคาปกติ − ราคาขาย
// ช่องขายว่าง = ลบค่าของขนาดนั้น · ขายเกินราคาปกติ = ส่วนลด 0
export function applyStyleRow(b, styleId, mode, sales, groups, sizes) {
  const next = JSON.parse(JSON.stringify(b))
  next.styleMode = { ...(next.styleMode || {}), [styleId]: mode === 'own' ? 'own' : 'central' }
  if (mode !== 'own') return next
  const row = { ...(next.styleDiscount?.[styleId] || {}) }
  for (const sz of sizes || []) {
    const v = sales?.[sz.id]
    if (v == null || v === '') {
      delete row[sz.id]
      continue
    }
    const reg = regularTotal(next.items || [], groups, null, sz.id)
    row[sz.id] = Math.max(0, reg - (Number(v) || 0))
  }
  next.styleDiscount = { ...(next.styleDiscount || {}), [styleId]: row }
  return next
}

// ร่างชุดใหม่จากตัวเลือกที่เลือก (ข้ามกลุ่มรองได้) ชื่ออัตโนมัติ ยังไม่มีส่วนลด
export function createBundleDraft(items, groups) {
  const d = makeDraft(null, [], [])
  d.items = items.map((x) => ({ groupId: x.groupId, optionId: x.optionId }))
  d.name = autoBundleName(d.items, groups)
  return d
}
