// ราคาต่อชิ้น = ราคาฐาน (ตามขนาด หรือราคาเค้กสำเร็จ) + ตัวเลือก (คงที่ หรือ ต่อปอนด์)

export function itemBase(item, groups, products) {
  if (item.kind === 'ready') {
    const p = products.find((x) => x.id === item.productId)
    return { base: p?.price || 0, pounds: p?.pounds || 1 }
  }
  const sizeGroup = groups.find((g) => g.key === 'size')
  const opt = sizeGroup?.options.find((o) => o.id === item.selections[sizeGroup.id])
  return { base: opt?.price || 0, pounds: opt?.pounds || 1 }
}

export function calcUnitPrice(item, groups, products) {
  const { base, pounds } = itemBase(item, groups, products)
  let extra = 0
  for (const g of groups) {
    if (g.key === 'size' || g.type === 'text') continue
    const sel = item.selections[g.id]
    if (sel == null) continue
    const ids = Array.isArray(sel) ? sel : [sel]
    for (const id of ids) {
      const o = g.options.find((x) => x.id === id)
      if (!o) continue
      extra += o.priceType === 'per_pound' ? o.price * pounds : o.price
    }
  }
  return base + extra
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

// แปลงตัวเลือกเป็นข้อความอ่านง่าย
export function describeSelections(item, groups) {
  const out = []
  for (const g of groups) {
    const sel = item.selections[g.id]
    if (sel == null || sel === '' || (Array.isArray(sel) && !sel.length)) continue
    if (g.type === 'text') {
      out.push({ group: g.name, value: sel })
      continue
    }
    const ids = Array.isArray(sel) ? sel : [sel]
    const names = ids.map((id) => g.options.find((o) => o.id === id)?.name).filter(Boolean)
    if (names.length) out.push({ group: g.name, value: names.join(', ') })
  }
  return out
}
