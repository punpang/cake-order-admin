// หน้าบันเดิ้ล (ชุดลดราคาตัวเลือก): ราคาปกติรวม ราคาหลังลด และตรวจข้อมูลก่อนบันทึก
// ใช้ฟังก์ชันคิดราคาเดียวกับหน้าขาย (optionPrice / bundleAmount ใน pricing.js) เพื่อให้ตัวเลขในหน้านี้ตรงกับที่ลูกค้าจ่าย
import { optionPrice, bundleAmount, isOwnStyle, isFixed } from './pricing.js'
import { qty } from './format.js'

const EPS = 1e-9
const num = (v) => (v == null || v === '' ? null : Number(v))
const keyOf = (x) => `${x.groupId}:${x.optionId}`
// ตัวเลือกชุดเดียวกัน (ไม่สนลำดับ) = ชุดเดียวกัน · ใช้ตรวจชุดซ้ำ
export const itemSetKey = (items) => [...new Set((items || []).map(keyOf))].sort().join('|')
// ชุดที่มีตัวเลือกชุดเดียวกันอยู่แล้ว (ไม่สนลำดับและประเภท) · excludeId = ชุดที่ไม่นับ (ชุดตัวเอง)
export function findDuplicate(items, bundles, excludeId = null) {
  const k = itemSetKey(items)
  if (!k) return null
  return (bundles || []).find((o) => o.id !== excludeId && itemSetKey(o.items) === k) || null
}

// ตัวเลือกที่ชุดอ้างถึง (ไม่พบ = undefined)
export const findItemOption = (groups, x) => groups.find((g) => g.id === x.groupId)?.options?.find((o) => o.id === x.optionId)
// ตัวเลือกคงที่ที่ราคา 0 ฿ ในประเภทที่ชุดใช้ได้ (ราคาหลัก หรือราคาของประเภทนั้นเป็น 0 · ยังไม่ตั้งราคาคงที่ก็นับเป็น 0 ฿)
// กติกา: บันเดิ้ลที่มีตัวเลือกราคา 0 ฿ สร้างไม่ได้ เพราะเพิ่มตัวเลือกนี้เข้าชุดแล้วราคาไม่เพิ่ม จึงไม่มีช่องให้ลดชุดนี้
export function freeNamesOf(items, groups, typeIds) {
  const names = (items || [])
    .map((x) => findItemOption(groups, x))
    .filter((o) => o && isFixed(o) && typeIds.some((t) => optionPrice(o, t, []) === 0))
    .map((o) => o.name)
  return [...new Set(names)]
}

// เงินแบบสั้นสำหรับการ์ดและข้อความเตือน: 50 ฿ · 1,234.5 ฿
export const bahtText = (n) => `${qty(n)} ฿`

// ราคาปกติรวมของตัวเลือกในชุด ณ ประเภท (typeId · null = ราคาทุกประเภท) และขนาด
export function regularTotal(items, groups, typeId, sizeId) {
  if (!sizeId) return 0
  return (items || []).reduce((s, x) => {
    const o = findItemOption(groups, x)
    return s + (o ? optionPrice(o, typeId, [sizeId]) : 0)
  }, 0)
}

// ส่วนลดที่ลูกค้าได้จริงของขนาดหนึ่งในประเภทหนึ่ง (ตรงกับตัวคิดราคา: ช่องประเภทว่าง = ใช้ส่วนลดของทุกประเภท)
export const effectiveDiscount = (b, typeId, sizeId) => bundleAmount(b, typeId, [sizeId], null)

// ชื่ออัตโนมัติจากตัวเลือกในชุด เช่น "ครีมชีส + บลูเบอร์รี"
export const autoBundleName = (items, groups) => (items || []).map((x) => findItemOption(groups, x)?.name).filter(Boolean).join(' + ')

// ส่วนลดเป็นเปอร์เซ็นต์ของราคาปกติ ปัดเป็นบาทเต็ม (ค่าไม่ถูกต้อง = 0 · ไม่เกิน 100%)
export function percentOf(base, pct) {
  const b = Number(base)
  const p = Number(pct)
  if (!(b > 0) || !(p > 0)) return 0
  return Math.round((b * Math.min(p, 100)) / 100)
}

// ร่างสำหรับฟอร์ม: คัดลอกจากชุดที่มีอยู่ (หรือชุดต้นแบบตอนทำสำเนา) และเติมช่องของทุกประเภท/รูปแบบให้ครบ
export function makeDraft(src, styles = [], types = []) {
  const copy = (o) => JSON.parse(JSON.stringify(o || {}))
  const d = {
    id: src?.id ?? null,
    name: src?.name ?? '',
    items: (src?.items || []).map((x) => ({ groupId: x.groupId, optionId: x.optionId })),
    discount: copy(src?.discount),
    types: [...(src?.types || [])],
    typeDiscount: copy(src?.typeDiscount), // เก็บค่าของประเภทที่ปิดอยู่ไว้ด้วย (ไม่ทำให้หายตอนบันทึก)
    styleDiscount: copy(src?.styleDiscount),
    styleMode: Object.fromEntries(styles.map((st) => [st.id, src && isOwnStyle(src, st.id) ? 'own' : 'central'])),
    active: src ? src.active !== false : true,
    pct: validPct(src?.pct), // เปอร์เซ็นต์ของค่ากลาง (ไม่ได้ตั้ง = null) · ดู "ส่วนลดตามเปอร์เซ็นต์" ท้ายไฟล์
    typePct: copy(src?.typePct), // เปอร์เซ็นต์ของประเภทที่ตั้งส่วนลดแยก { [typeId]: % }
  }
  for (const t of types) d.typeDiscount[t.id] ??= {}
  for (const st of styles) d.styleDiscount[st.id] ??= {}
  return d
}

// ประเภทที่ชุดนี้ใช้ได้จริง (ว่าง = ทุกประเภทที่เปิดใช้งาน) · ไม่มีประเภทที่เปิดอยู่เลย = [null] (ราคาทั่วไป)
export function scopesOf(b, types = []) {
  const activeIds = types.filter((t) => t.active !== false).map((t) => t.id)
  const picked = b.types?.length ? b.types.filter((id) => activeIds.includes(id)) : activeIds
  return picked.length ? picked : [null]
}

// ส่วนลดที่เกินราคาปกติของตัวเลือกในชุด (ทุกขนาด ทุกประเภทที่ใช้ได้ และรูปแบบที่ตั้งส่วนลดเอง) → ข้อความทุกรายการ (ว่าง = ไม่เกิน)
// ใช้ทั้งตรวจก่อนบันทึก (checkBundle) และเตือนในหน้ารายการ · ราคาตัวเลือกลดลงหลังตั้งส่วนลดแล้วทำให้เกิดเคสนี้ได้
export function overDiscounts(b, ctx = {}) {
  const { groups = [], sizes = [], types = [], styles = [] } = ctx
  const items = b.items || []
  if (!items.length) return []
  const typeName = (id) => types.find((t) => t.id === id)?.name || ''
  const scopes = scopesOf(b, types)
  const over = []
  for (const sz of sizes) {
    for (const t of scopes) {
      const reg = regularTotal(items, groups, t, sz.id)
      const eff = effectiveDiscount(b, t, sz.id)
      if (eff > reg + EPS) over.push(`${sz.name}${t ? ` (${typeName(t)})` : ''}: ลด ${bahtText(eff)} มากกว่าราคาปกติ ${bahtText(reg)}`)
    }
    for (const st of styles) {
      if (b.styleMode?.[st.id] !== 'own') continue
      const sd = num(b.styleDiscount?.[st.id]?.[sz.id]) || 0
      for (const t of scopes) {
        const reg = regularTotal(items, groups, t, sz.id)
        if (sd > reg + EPS) over.push(`${sz.name} · ${st.name}${t ? ` (${typeName(t)})` : ''}: ลด ${bahtText(sd)} มากกว่าราคาปกติ ${bahtText(reg)}`)
      }
    }
  }
  return over
}

// ตรวจชุดก่อนบันทึก · errors = ต้องแก้ก่อนบันทึก · warnings = บันทึกได้แต่ควรดู · info = ข้อมูลประกอบ
// ctx = { groups, sizes, types (ทุกประเภท · ประเภทที่ปิดอยู่ถูกข้ามเอง), styles, bundles, original (ชุดที่บันทึกไว้ · ไม่มี = ชุดใหม่) }
export function checkBundle(b, ctx = {}) {
  const { groups = [], sizes = [], types = [], styles = [], bundles = [], original = null } = ctx
  const errors = []
  const warnings = []
  const info = []
  const items = b.items || []

  if (!items.length) errors.push('เลือกตัวเลือกอย่างน้อย 1 อย่าง')
  // ห้ามสร้างชุดซ้ำ: ชุดใหม่ หรือแก้ตัวเลือกจนไปซ้ำกับชุดอื่น · ชุดเดิมที่ซ้ำอยู่แล้วแก้ส่วนอื่นได้ตามปกติ
  if (items.length) {
    const dup = findDuplicate(items, bundles, b.id ?? null)
    if (dup && (!original || itemSetKey(original.items) !== itemSetKey(items))) {
      errors.push(`ซ้ำกับบันเดิ้ล "${dup.name}"${dup.active === false ? ' (ปิดอยู่)' : ''} — มีตัวเลือกชุดเดียวกันแล้ว แก้ชุดเดิมแทน หรือเปลี่ยนตัวเลือกให้ต่างกัน`)
    }
  }

  // ส่วนลดต้องไม่เกินราคาปกติของทุกประเภทที่ใช้ได้ (ดู scopesOf)
  const scopes = scopesOf(b, types)
  // ตัวเลือก 0 ฿ → บันเดิ้ลที่มีตัวเลือกนี้สร้างไม่ได้ · ชุดเดิมที่มีอยู่แล้วแก้ส่วนอื่นได้ (มีคำเตือน) แต่เปลี่ยนตัวเลือกให้มีตัวเลือก 0 ฿ ไม่ได้
  const free = freeNamesOf(items, groups, scopes)
  if (free.length && (!original || itemSetKey(original.items) !== itemSetKey(items))) {
    errors.push(`มีตัวเลือกราคา 0 ฿ (${free.join(', ')}) — บันเดิ้ลที่มีตัวเลือกนี้สร้างไม่ได้ เอาตัวเลือกนี้ออกจากชุด หรือตั้งราคาตัวเลือกนี้ก่อน`)
  } else if (free.length) {
    warnings.push(`มีตัวเลือกราคา 0 ฿ (${free.join(', ')}) — ชุดนี้สร้างไว้ก่อนกติกานี้ ควรเอาตัวเลือกนี้ออก หรือตั้งราคาตัวเลือกนี้`)
  }
  if (items.length) {
    const over = overDiscounts(b, ctx)
    errors.push(...over.slice(0, 3))
    if (over.length > 3) errors.push(`และอีก ${over.length - 3} รายการ`)

    const ownDisc = styles.some((st) => b.styleMode?.[st.id] === 'own' && sizes.some((sz) => (num(b.styleDiscount?.[st.id]?.[sz.id]) || 0) > 0))
    const anyDisc = ownDisc || scopes.some((t) => sizes.some((sz) => effectiveDiscount(b, t, sz.id) > 0))
    if (!anyDisc) warnings.push('ยังไม่มีส่วนลด — ชุดนี้จะยังไม่ทำงานจนกว่าจะตั้งส่วนลด')
  }

  // ตัวเลือกที่ปิดอยู่หรือถูกลบ → ลูกค้าเลือกไม่ได้ ชุดนี้จึงไม่ทำงาน
  const off = items
    .filter((x) => {
      const g = groups.find((y) => y.id === x.groupId)
      const o = findItemOption(groups, x)
      return !o || o.active === false || g?.active === false
    })
    .map((x) => findItemOption(groups, x)?.name || 'ตัวเลือกที่ถูกลบแล้ว')
  if (off.length) warnings.push(`มีตัวเลือกที่ปิดอยู่หรือถูกลบ: ${off.join(', ')} — ลูกค้าเลือกไม่ได้ ชุดนี้จึงไม่ทำงาน`)

  if (items.length === 1) info.push('ชุดตัวเลือกเดียว: จะไม่นับเมื่อมีชุดหลายตัวเลือกที่ใช้ได้พร้อมกัน')
  if (items.length && b.active !== false) {
    const mine = new Set(items.map(keyOf))
    const shared = bundles.filter((o) => o.id !== b.id && o.active !== false && (o.items || []).some((x) => mine.has(keyOf(x))))
    if (shared.length) info.push(`ใช้ตัวเลือกร่วมกับ: ${shared.map((o) => o.name).join(', ')} — เมื่อลูกค้าเลือกครบหลายชุดที่ซ้ำกัน ระบบใช้ชุดที่มีตัวเลือกมากกว่าก่อน (ถ้าเท่ากันใช้ชุดที่ลดมากกว่า)`)
  }
  return { errors, warnings, info }
}

// ข้อมูลสรุปของชุด สำหรับการ์ดในหน้ารายการ
export function bundleSummary(b, ctx = {}) {
  const { groups = [], sizes = [], types = [], styles = [] } = ctx
  const items = (b.items || []).map((x) => {
    const g = groups.find((y) => y.id === x.groupId)
    const o = findItemOption(groups, x)
    return { key: keyOf(x), group: g?.name || '', name: o?.name || 'ตัวเลือกที่ถูกลบแล้ว', off: !o || o.active === false || g?.active === false }
  })
  const sizeRows = sizes.map((sz) => ({
    id: sz.id,
    name: sz.name,
    amount: Number(b.discount?.[sz.id]) || 0,
    hasOverride: types.some((t) => num(b.typeDiscount?.[t.id]?.[sz.id]) != null),
  }))
  const ownDisc = styles.some((st) => b.styleMode?.[st.id] === 'own' && sizes.some((sz) => (num(b.styleDiscount?.[st.id]?.[sz.id]) || 0) > 0))
  const typeDisc = types.some((t) => sizes.some((sz) => (num(b.typeDiscount?.[t.id]?.[sz.id]) || 0) > 0))
  const names = (b.types || []).map((id) => types.find((t) => t.id === id)?.name).filter(Boolean)
  return {
    items,
    sizes: sizeRows,
    scope: names.length ? `ใช้กับ ${names.join(', ')}` : 'ใช้ได้ทุกประเภท',
    hasDiscount: ownDisc || typeDisc || sizeRows.some((z) => z.amount > 0),
    hasOff: items.some((i) => i.off),
  }
}

// ---------- ส่วนลดตามเปอร์เซ็นต์ของราคาปกติ (รู้ว่าราคาตัวเลือกเปลี่ยนแล้วต้องปรับส่วนลดไหม) ----------
// ชุดเก็บเปอร์เซ็นต์ที่ตั้งไว้ 2 ส่วน: pct = ค่ากลาง (ทุกประเภท) · typePct = { [typeId]: % } ของประเภทที่ตั้งส่วนลดแยกด้วยเปอร์เซ็นต์
// ช่องที่ตั้งด้วยเปอร์เซ็นต์ควรเท่ากับ % × ราคาปกติของช่องนั้น · เมื่อราคาตัวเลือกเปลี่ยนจะไม่ตรง (driftRows) และปรับได้ด้วย applyIntendedPct
// ไม่นับ: ช่องที่กรอกเป็นบาทเอง (ไม่มีเปอร์เซ็นต์) · ช่องว่าง/0 (ตั้งใจไม่ลด) · ขนาดที่ตัวเลือกในชุดยังไม่มีราคาครบ (ไม่รู้ราคาจริง)
export const validPct = (v) => {
  const p = Number(v)
  return p > 0 && p <= 100 ? p : null
}
const slotPct = (b, scopeId) => validPct(scopeId ? b.typePct?.[scopeId] : b.pct)
// ตัวเลือกมีราคาในประเภท t (null = ราคาทั่วไป) และขนาด sid หรือยัง
const hasPrice = (o, t, sid) =>
  !!o && (isFixed(o) ? num(o.typePrice?.[t]) != null || num(o.price) != null : num(o.typePrices?.[t]?.[sid]) != null || num(o.sizePrices?.[sid]) != null)

// ช่องส่วนลดที่มีผลจริงของชุด: ค่ากลาง (เมื่อมีประเภทที่ใช้ได้ซึ่งไม่ได้ตั้งแยก) และช่องแยกประเภท · base = ราคาปกติของช่องนั้น
export function discountSlots(b, ctx = {}) {
  const { groups = [], sizes = [], types = [] } = ctx
  const items = b.items || []
  if (!items.length) return []
  const scopes = scopesOf(b, types)
  const typeName = (id) => types.find((t) => t.id === id)?.name || ''
  const overridden = (t, sid) => t != null && num(b.typeDiscount?.[t]?.[sid]) != null
  const priced = (t, sid) => items.every((x) => hasPrice(findItemOption(groups, x), t, sid))
  const out = []
  for (const sz of sizes) {
    if (scopes.some((t) => !overridden(t, sz.id)) && priced(null, sz.id)) {
      out.push({ scopeId: null, scopeName: '', sizeId: sz.id, sizeName: sz.name, base: regularTotal(items, groups, null, sz.id), current: num(b.discount?.[sz.id]), label: `${sz.name} · ทุกประเภท` })
    }
    for (const t of scopes) {
      if (!overridden(t, sz.id) || !priced(t, sz.id)) continue
      out.push({ scopeId: t, scopeName: typeName(t), sizeId: sz.id, sizeName: sz.name, base: regularTotal(items, groups, t, sz.id), current: num(b.typeDiscount[t][sz.id]), label: `${sz.name} · ${typeName(t)}` })
    }
  }
  return out
}

// ช่องที่ตั้งเป็นเปอร์เซ็นต์แล้ว แต่ส่วนลดไม่ตรงกับราคาปกติตอนนี้ → target = ส่วนลดที่ควรเป็น · ชุดปิดอยู่ไม่นับ
export function driftRows(b, ctx = {}) {
  if (b.active === false) return []
  return discountSlots(b, ctx).flatMap((s) => {
    const p = slotPct(b, s.scopeId)
    if (p == null || !s.current) return []
    const target = percentOf(s.base, p)
    return Math.abs(target - s.current) > EPS ? [{ ...s, pct: p, target, key: `${s.scopeId ?? 'all'}:${s.sizeId}` }] : []
  })
}

// เปอร์เซ็นต์จำนวนเต็มที่ทุกช่องของกลุ่มนี้ (ค่ากลาง หรือประเภทหนึ่ง) ตรงพอดี · ไม่มีช่อง หรือตรงได้หลายค่า = null (ไม่เดา)
export function inferScopePct(b, ctx = {}, scopeId = null) {
  const slots = discountSlots(b, ctx).filter((s) => s.scopeId === scopeId && s.current)
  if (!slots.length) return null
  const fits = []
  for (let p = 1; p <= 100; p++) if (slots.every((s) => percentOf(s.base, p) === s.current)) fits.push(p)
  return fits.length === 1 ? fits[0] : null
}

// กลุ่มที่ยังไม่ได้ตั้งเปอร์เซ็นต์ แต่ส่วนลดตรงกับเปอร์เซ็นต์หนึ่งอยู่แล้ว → เสนอให้ตั้ง (ไม่เปลี่ยนจำนวนเงิน)
export function linkSuggestions(b, ctx = {}) {
  if (b.active === false) return []
  const slots = discountSlots(b, ctx)
  const out = []
  for (const sc of new Set(slots.map((s) => s.scopeId))) {
    if (slotPct(b, sc) != null) continue
    const pct = inferScopePct(b, ctx, sc)
    if (pct != null) out.push({ scopeId: sc, scopeName: slots.find((s) => s.scopeId === sc)?.scopeName || '', pct })
  }
  return out
}

// ใส่เปอร์เซ็นต์ที่เสนอลงชุด (คืนชุดใหม่ ไม่แก้ชุดเดิม)
export function withLinks(b, links) {
  const next = JSON.parse(JSON.stringify(b))
  for (const l of links) {
    if (l.scopeId) next.typePct = { ...(next.typePct || {}), [l.scopeId]: l.pct }
    else next.pct = l.pct
  }
  return next
}

// ตั้งส่วนลดของช่องที่ไม่ตรงให้เท่ากับ % × ราคาปกติตอนนี้ (คืนชุดใหม่ ไม่แก้ชุดเดิม · ช่องที่ตรงแล้วไม่เปลี่ยน)
export function applyIntendedPct(b, ctx = {}) {
  const next = JSON.parse(JSON.stringify(b))
  for (const r of driftRows(b, ctx)) {
    if (r.scopeId) next.typeDiscount[r.scopeId][r.sizeId] = r.target
    else next.discount[r.sizeId] = r.target
  }
  return next
}
