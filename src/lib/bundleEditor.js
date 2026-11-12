// หน้าบันเดิ้ล (ชุดลดราคาตัวเลือก): ราคาปกติรวม ราคาหลังลด และตรวจข้อมูลก่อนบันทึก
// ใช้ฟังก์ชันคิดราคาเดียวกับหน้าขาย (optionPrice / bundleAmount ใน pricing.js) เพื่อให้ตัวเลขในหน้านี้ตรงกับที่ลูกค้าจ่าย
import { optionPrice, bundleAmount, isOwnStyle } from './pricing.js'
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
  }
  for (const t of types) d.typeDiscount[t.id] ??= {}
  for (const st of styles) d.styleDiscount[st.id] ??= {}
  return d
}

// ตรวจชุดก่อนบันทึก · errors = ต้องแก้ก่อนบันทึก · warnings = บันทึกได้แต่ควรดู · info = ข้อมูลประกอบ
// ctx = { groups, sizes, types (ทุกประเภท · ประเภทที่ปิดอยู่ถูกข้ามเอง), styles, bundles, original (ชุดที่บันทึกไว้ · ไม่มี = ชุดใหม่) }
export function checkBundle(b, ctx = {}) {
  const { groups = [], sizes = [], types = [], styles = [], bundles = [], original = null } = ctx
  const errors = []
  const warnings = []
  const info = []
  const items = b.items || []
  const typeName = (id) => types.find((t) => t.id === id)?.name || ''
  const activeIds = types.filter((t) => t.active !== false).map((t) => t.id)

  if (!items.length) errors.push('เลือกตัวเลือกอย่างน้อย 1 อย่าง')
  // ห้ามสร้างชุดซ้ำ: ชุดใหม่ หรือแก้ตัวเลือกจนไปซ้ำกับชุดอื่น · ชุดเดิมที่ซ้ำอยู่แล้วแก้ส่วนอื่นได้ตามปกติ
  if (items.length) {
    const dup = findDuplicate(items, bundles, b.id ?? null)
    if (dup && (!original || itemSetKey(original.items) !== itemSetKey(items))) {
      errors.push(`ซ้ำกับบันเดิ้ล "${dup.name}"${dup.active === false ? ' (ปิดอยู่)' : ''} — มีตัวเลือกชุดเดียวกันแล้ว แก้ชุดเดิมแทน หรือเปลี่ยนตัวเลือกให้ต่างกัน`)
    }
  }

  // ประเภทที่ชุดนี้ใช้ได้จริง (ว่าง = ทุกประเภทที่เปิดใช้งาน) · ส่วนลดต้องไม่เกินราคาปกติของทุกประเภทที่ใช้ได้
  const picked = b.types?.length ? b.types.filter((id) => activeIds.includes(id)) : activeIds
  const scopes = picked.length ? picked : [null]
  if (items.length) {
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
