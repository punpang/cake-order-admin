// ย้อนแคตาล็อกไปยังเวลาที่กำหนด — ใช้ให้ตัวตรวจออร์เดอร์เทียบกับราคาที่ใช้ได้ ณ เวลาที่สร้างออร์เดอร์ ไม่ใช่ราคาวันนี้
// การเปลี่ยนแปลงที่บันทึกในฐานข้อมูล (punpang_catalog_history) ทุกครั้งเก็บค่าก่อนและหลังเปลี่ยน
// change: { source: 'item' | 'config', key, old: ค่าก่อนเปลี่ยน (null = ยังไม่มี), changedAt: ISO }
// ของสินค้า (item) old คือแถวสินค้า { id, name, price, active, data } · ของการตั้งค่า (config) old คือค่า v ของคีย์นั้น

const DEFAULTS = { shop: {}, priceLists: [], bundles: [], optionGroups: [], posDiscounts: [], posBundles: [], posDeals: [], posModifiers: [] }

// แถวสินค้าในฐานข้อมูล → รูปแบบที่แอปใช้ (เหมือน loadCatalog)
export const runtimeItem = (row) => ({ ...(row.data || {}), id: row.id, name: row.name, price: row.price == null ? null : Number(row.price), active: row.active })

// current = แคตาล็อกปัจจุบัน · changes = การเปลี่ยนแปลงหลังเวลาที่สนใจ (ลำดับใดก็ได้) · t = เวลา (ms)
// ทำงานกับสำเนา ไม่แก้ current
export function catalogAt(current, changes, t) {
  const cat = { ...current, retailItems: [...(current.retailItems || [])] }
  const items = new Map(cat.retailItems.map((x) => [x.id, x]))
  const newestFirst = [...(changes || [])].sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt))
  for (const c of newestFirst) {
    if (Date.parse(c.changedAt) <= t) break // ที่เหลือเก่ากว่า t ทั้งหมด
    if (c.source === 'config') cat[c.key] = c.old ?? DEFAULTS[c.key] ?? null
    else if (c.old == null) items.delete(c.key) // สินค้าถูกสร้างหลัง t → ตอนนั้นยังไม่มี
    else items.set(c.key, runtimeItem(c.old)) // สินค้าถูกแก้หรือลบหลัง t → คืนค่าเดิม
  }
  cat.retailItems = [...items.values()]
  return cat
}
