// คำนวณวัตถุดิบที่ต้องใช้
// ต่อปอนด์ = ปริมาณ × ปอนด์ของสินค้า, ต่อชิ้น = ปริมาณคงที่ แล้วคูณจำนวนชิ้นของรายการ
import { itemBase } from './pricing'

function addRecipe(into, recipe, pounds, qty) {
  for (const line of recipe || []) {
    const amount = line.per === 'piece' ? line.qty : line.qty * pounds
    into[line.ingredientId] = (into[line.ingredientId] || 0) + amount * qty
  }
}

// วัตถุดิบของสินค้า 1 รายการ (รวมจำนวนชิ้นแล้ว) → { ingredientId: ปริมาณ }
export function itemMaterials(item, groups, products, into = {}) {
  const { pounds } = itemBase(item, groups, products)
  const qty = Number(item.qty) || 1
  if (item.kind === 'ready') {
    const p = products.find((x) => x.id === item.productId)
    addRecipe(into, p?.recipe, pounds, qty)
  }
  for (const g of groups) {
    if (g.type === 'text') continue
    const sel = item.selections?.[g.id]
    if (sel == null) continue
    const ids = Array.isArray(sel) ? sel : [sel]
    for (const id of ids) {
      const o = g.options.find((x) => x.id === id)
      if (o) addRecipe(into, o.recipe, pounds, qty)
    }
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
      const { pounds } = itemBase(it, groups, products)
      const n = Number(it.qty) || 1
      if (it.kind === 'ready') {
        const p = products.find((x) => x.id === it.productId)
        const name = p?.name || it.name
        bump(cakes, `r|${name}|${pounds}`, { name, pounds }, n)
      } else {
        const names = flavor ? optNames(flavor, it.selections?.[flavor.id]).map((x) => x.name) : []
        const name = `สั่งทำ · ${names.length ? names.join(' + ') : 'ไม่ระบุเนื้อเค้ก'}`
        bump(cakes, `c|${name}|${pounds}`, { name, pounds }, n)
      }
      for (const g of prepGroups) {
        for (const opt of optNames(g, it.selections?.[g.id])) {
          if (!sets[g.id]) sets[g.id] = {}
          bump(sets[g.id], `${opt.id}|${pounds}`, { name: opt.name, pounds }, n)
        }
      }
    }
  }

  const sort = (rows) => rows.sort((a, b) => a.name.localeCompare(b.name, 'th') || a.pounds - b.pounds)
  return {
    cakes: sort(Object.values(cakes)),
    groups: prepGroups.filter((g) => sets[g.id]).map((g) => ({ id: g.id, name: g.name, rows: sort(Object.values(sets[g.id])) })),
  }
}
