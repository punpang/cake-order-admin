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
