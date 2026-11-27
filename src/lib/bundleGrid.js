// ตารางตั้งราคาชุดคู่ต่อกลุ่ม: สร้างคู่ไม่ซ้ำ หาชุดของคู่ คำนวณสถานะช่อง ราคาแนะนำ และเขียนลงชุดเดิมตามช่องที่เลือก
// ใช้ bundleAmount (pricing.js) ตัดสินค่าที่มีผลจริง เพื่อให้ตารางตรงกับที่ลูกค้าจ่าย · ไม่เปลี่ยนสูตรราคาและโครงข้อมูลชุด
import { bundleAmount } from './pricing.js'
import { itemSetKey, regularTotal, autoBundleName, findItemOption } from './bundleEditor.js'

const num = (v) => (v == null || v === '' ? null : Number(v))

// คู่ตัวเลือกในกลุ่มเดียวกัน แบบครึ่งบนของเมทริกซ์ (แต่ละคู่นับครั้งเดียว · เฉพาะตัวเลือกที่เปิดอยู่)
export function groupPairs(group) {
  const opts = (group?.options || []).filter((o) => o.active !== false)
  const rows = []
  for (let i = 0; i < opts.length; i++) {
    for (let j = i + 1; j < opts.length; j++) {
      const a = { groupId: group.id, optionId: opts[i].id }
      const b = { groupId: group.id, optionId: opts[j].id }
      rows.push({ rowId: opts[i].id, colId: opts[j].id, rowName: opts[i].name, colName: opts[j].name, items: [a, b] })
    }
  }
  return rows
}

// ชุดที่มีตัวเลือกชุดเดียวกับคู่นี้ (ไม่สนลำดับ) · ไม่พบ = null
export const findPairBundle = (bundles, items) => {
  const k = itemSetKey(items)
  return (bundles || []).find((b) => itemSetKey(b.items) === k) || null
}

// scope = { kind: 'all' } | { kind: 'type', id } | { kind: 'style', id }
const typeOf = (scope) => (scope?.kind === 'type' ? scope.id : null)
const styleOf = (scope) => (scope?.kind === 'style' ? scope.id : null)

// ค่าที่ตั้งไว้ของช่องนี้เอง (ไม่รวมค่าที่รับมาจากมิติกว้างกว่า)
export function scopeValue(b, scope, sizeId) {
  if (!b) return null
  if (scope.kind === 'all') return num(b.discount?.[sizeId])
  if (scope.kind === 'type') return num(b.typeDiscount?.[scope.id]?.[sizeId])
  return b.styleMode?.[scope.id] === 'own' ? num(b.styleDiscount?.[scope.id]?.[sizeId]) : null
}

// มีการตั้งราคาแยกลึกกว่าช่องทั้งหมดในขนาดนี้หรือไม่ (แยกชนิด/รูปแบบที่ตั้งเอง)
const hasDeeper = (b, sizeId) =>
  Object.values(b.typeDiscount || {}).some((row) => num(row?.[sizeId]) != null) ||
  Object.entries(b.styleMode || {}).some(([sid, m]) => m === 'own' && num(b.styleDiscount?.[sid]?.[sizeId]) != null)

// สถานะช่อง: set = ตั้งเองในช่องนี้ · inherit = รับค่าจากมิติกว้างกว่า · empty = ยังไม่มี
// detail = ควรเปิดหน้าแก้ไขชุดเดิมเพื่อดู (มีราคาแยกลึกกว่า หรือชุดปิดอยู่) แทนที่จะแก้ในตาราง
export function cellState(b, scope, sizeId) {
  if (!b) return { state: 'empty', amount: null, detail: false }
  const detail = scope.kind === 'all' && (hasDeeper(b, sizeId) || b.active === false)
  const own = scopeValue(b, scope, sizeId)
  if (own != null) return { state: 'set', amount: own, detail }
  const eff = bundleAmount(b, typeOf(scope), [sizeId], styleOf(scope))
  if (eff > 0) return { state: 'inherit', amount: eff, detail }
  return { state: 'empty', amount: null, detail }
}

// ราคาแนะนำ: ส่วนลดที่พบบ่อยที่สุดของคู่อื่นในกลุ่มเดียวกันที่ราคาตัวเลือกรวมเท่ากันในขนาดนี้ · ไม่มี หรือค่าที่พบบ่อยเท่ากันสองค่า = null (ไม่เดา)
export function suggestPrice(bundles, groups, pairItems, sizeId, scope, groupId) {
  const typeId = typeOf(scope)
  const target = regularTotal(pairItems, groups, typeId, sizeId)
  const self = itemSetKey(pairItems)
  const counts = new Map()
  for (const b of bundles || []) {
    if (b.active === false || (b.items || []).length !== 2) continue
    if (!b.items.every((x) => x.groupId === groupId) || itemSetKey(b.items) === self) continue
    const v = scopeValue(b, scope, sizeId)
    if (!(v > 0) || regularTotal(b.items, groups, typeId, sizeId) !== target) continue
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1])
  if (!ranked.length) return null
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null
  return { amount: ranked[0][0], count: ranked[0][1] }
}

// ชุดใหม่สำหรับคู่ที่ยังไม่มี: ชื่ออัตโนมัติ ใช้ได้กับทุกชนิดเค้ก ยังไม่มีส่วนลด
export function newPairBundle(items, groups) {
  return {
    id: null,
    name: autoBundleName(items, groups),
    items: items.map((x) => ({ groupId: x.groupId, optionId: x.optionId })),
    discount: {},
    types: [],
    typeDiscount: {},
    styleDiscount: {},
    styleMode: {},
    active: true,
    pct: null,
    typePct: {},
  }
}

// เขียนค่าลงช่องเดียว (คืนชุดใหม่ ไม่แก้ต้นฉบับ) · amount ว่าง = ลบค่าของช่องนี้ · ไม่มีชุดและไม่มีค่า = null
// ไม่แตะเปอร์เซ็นต์ที่ตั้งไว้ของชุด (ถ้าช่องที่แก้ไม่ตรงกับเปอร์เซ็นต์ ระบบหน้าชุดจะแจ้งตามปกติ)
export function writeCell(existing, { items, groups, scope, sizeId, amount }) {
  if (!existing && (amount == null || amount === '')) return null
  const b = existing ? JSON.parse(JSON.stringify(existing)) : newPairBundle(items, groups)
  b.discount ??= {}
  b.typeDiscount ??= {}
  b.styleDiscount ??= {}
  b.styleMode ??= {}
  const val = amount == null || amount === '' ? null : Number(amount)
  if (scope.kind === 'all') {
    if (val == null) delete b.discount[sizeId]
    else b.discount[sizeId] = val
  } else if (scope.kind === 'type') {
    const row = { ...(b.typeDiscount[scope.id] || {}) }
    if (val == null) delete row[sizeId]
    else row[sizeId] = val
    b.typeDiscount[scope.id] = row
  } else {
    const row = { ...(b.styleDiscount[scope.id] || {}) }
    if (val == null) delete row[sizeId]
    else row[sizeId] = val
    b.styleDiscount[scope.id] = row
    b.styleMode[scope.id] = 'own'
  }
  return b
}

// ชุดยังมีส่วนลดที่มากกว่า 0 อย่างน้อยหนึ่งช่องหรือไม่ (ใช้ถามก่อนปิดชุดที่ไม่มีส่วนลดแล้ว)
export function hasAnyDiscount(b) {
  const pos = (v) => Number(v) > 0
  return Object.values(b.discount || {}).some(pos) ||
    Object.values(b.typeDiscount || {}).some((row) => Object.values(row || {}).some(pos)) ||
    Object.entries(b.styleMode || {}).some(([sid, m]) => m === 'own' && Object.values(b.styleDiscount?.[sid] || {}).some(pos))
}

// ชื่อตัวเลือกของคู่ สำหรับข้อความยืนยัน
export const pairNames = (items, groups) => items.map((x) => findItemOption(groups, x)?.name || '').filter(Boolean).join(' + ')
