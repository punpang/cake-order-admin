// คำนวณวัตถุดิบที่ต้องใช้
// ต่อปอนด์ = ปริมาณ × ปอนด์ของสินค้า, ต่อชิ้น = ปริมาณคงที่ แล้วคูณจำนวนชิ้นของรายการ
import { itemBase, tiersOf, isTierGroup } from './pricing'

function addRecipe(into, recipe, pounds, qty) {
  for (const line of recipe || []) {
    const amount = line.per === 'piece' ? line.qty : line.qty * pounds
    into[line.ingredientId] = (into[line.ingredientId] || 0) + amount * qty
  }
}

// วัตถุดิบของสินค้า 1 รายการ (รวมจำนวนชิ้นแล้ว) → { ingredientId: ปริมาณ }
// กลุ่มแยกชั้นคิดตามปอนด์ของชั้นนั้น กลุ่มอื่นคิดตามปอนด์รวม
export function itemMaterials(item, groups, products, into = {}) {
  const { pounds, tierPounds } = itemBase(item, groups, products)
  const qty = Number(item.qty) || 1
  const tiers = tiersOf(item)
  if (item.kind === 'ready') {
    const p = products.find((x) => x.id === item.productId)
    addRecipe(into, p?.recipe, pounds, qty)
  }
  const addSel = (g, sel, lb) => {
    if (sel == null) return
    for (const id of Array.isArray(sel) ? sel : [sel]) {
      const o = g.options.find((x) => x.id === id)
      if (o) addRecipe(into, o.recipe, lb, qty)
    }
  }
  for (const g of groups) {
    if (g.type === 'text') continue
    if (isTierGroup(g, item)) tiers.forEach((t, i) => addSel(g, t.selections?.[g.id], tierPounds[i]))
    else addSel(g, item.selections?.[g.id], pounds)
  }
  return into
}

// วัตถุดิบรวมของหลายออร์เดอร์
export function ordersMaterials(orders, groups, products) {
  const total = {}
  for (const o of orders) for (const it of o.items) itemMaterials(it, groups, products, total)
  return total
}

// ---------- รายการเตรียม ----------
// ตัวเค้ก: สั่งทำ = ขนาด(ปอนด์) + เนื้อเค้ก (กลุ่ม key 'flavor'), สำเร็จ = ชื่อเค้ก + ปอนด์ → นับเป็นก้อน
// กลุ่มที่เปิด prepList: ตัวเลือก + ปอนด์ → นับเป็นชุด
const optNames = (g, sel) => {
  const ids = sel == null ? [] : Array.isArray(sel) ? sel : [sel]
  return ids.map((id) => g.options.find((o) => o.id === id)).filter(Boolean)
}

function bump(map, key, data, n) {
  if (!map[key]) map[key] = { ...data, count: 0 }
  map[key].count += n
}

export function prepList(orders, groups, products) {
  const cakes = {}
  const sets = {} // groupId → { key → row }
  const flavor = groups.find((g) => g.key === 'flavor')
  const prepGroups = groups.filter((g) => g.prepList && g.type !== 'text' && g.key !== 'size' && g.key !== 'flavor')

  for (const o of orders) {
    for (const it of o.items) {
      const { pounds, tierPounds } = itemBase(it, groups, products)
      const tiers = tiersOf(it)
      const n = Number(it.qty) || 1
      if (it.kind === 'ready') {
        const p = products.find((x) => x.id === it.productId)
        const name = p?.name || it.name
        bump(cakes, `r|${name}|${pounds}`, { name, pounds }, n)
      } else {
        // แต่ละชั้น = 1 ก้อน
        tiers.forEach((t, i) => {
          const sel = flavor ? (isTierGroup(flavor, it) ? t.selections : it.selections)?.[flavor.id] : null
          const names = flavor ? optNames(flavor, sel).map((x) => x.name) : []
          const name = `สั่งทำ · ${names.length ? names.join(' + ') : 'ไม่ระบุเนื้อเค้ก'}`
          bump(cakes, `c|${name}|${tierPounds[i]}`, { name, pounds: tierPounds[i] }, n)
        })
      }
      const addSet = (g, sel, lb) => {
        for (const opt of optNames(g, sel)) {
          if (!sets[g.id]) sets[g.id] = {}
          bump(sets[g.id], `${opt.id}|${lb}`, { name: opt.name, pounds: lb }, n)
        }
      }
      for (const g of prepGroups) {
        if (isTierGroup(g, it)) tiers.forEach((t, i) => addSet(g, t.selections?.[g.id], tierPounds[i]))
        else addSet(g, it.selections?.[g.id], pounds)
      }
    }
  }

  const sort = (rows) => rows.sort((a, b) => a.name.localeCompare(b.name, 'th') || a.pounds - b.pounds)
  return {
    cakes: sort(Object.values(cakes)),
    groups: prepGroups.filter((g) => sets[g.id]).map((g) => ({ id: g.id, name: g.name, rows: sort(Object.values(sets[g.id])) })),
  }
}
