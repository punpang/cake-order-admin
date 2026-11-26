// รายการเลือกสินค้าเฉพาะ (ส่วนลดเดือนเกิด): กรองตามชื่อ และจัดกลุ่มตามหมวด พร้อมนับที่เลือกในแต่ละหมวด · ฟังก์ชันล้วน
export function groupPickItems(items, { query = '', selected = [] } = {}) {
  const q = String(query ?? '').trim().toLowerCase()
  const sel = new Set(selected || [])
  const groups = new Map()
  for (const it of items || []) {
    if (!it || !it.id) continue
    if (q && !String(it.name ?? '').toLowerCase().includes(q)) continue
    const category = it.category || 'ไม่มีหมวด'
    if (!groups.has(category)) groups.set(category, { category, items: [], selectedCount: 0 })
    const g = groups.get(category)
    g.items.push(it)
    if (sel.has(it.id)) g.selectedCount++
  }
  return [...groups.values()]
}

// จำนวนสินค้าที่เลือกทั้งหมด (นับไม่ซ้ำ)
export function selectedPickCount(selected) {
  return new Set(selected || []).size
}
