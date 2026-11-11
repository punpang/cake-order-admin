// สถิติสินค้าพร้อมขายสำหรับหน้าร้านสาธารณะ: ยอดขายรวม 30 วัน และสินค้าที่มักสั่งร่วมกัน
// เป็นตัวเลขรวมไม่มีรหัสลูกค้า · คู่สินค้าต้องพบอย่างน้อย PAIR_MIN ออร์เดอร์ (กันการระบุตัวตนจากออร์เดอร์เดียว)
// ฟังก์ชันในไฟล์นี้ล้วน ไม่พึ่ง store/Vue เพื่อให้ทดสอบด้วย node ได้

export const RETAIL_STATS = { days: 30, pairMin: 2, pairTop: 6 }
const SKIP = ['draft', 'cancelled']

// ออร์เดอร์ที่นับ = ไม่ใช่ร่าง/ยกเลิก และอยู่ในช่วงวันย้อนหลัง
export function computeRetailStats(orders, { now = new Date(), days = RETAIL_STATS.days } = {}) {
  const since = now.getTime() - days * 86400e3
  const sales = {}
  const co = new Map() // a -> Map(b -> ออร์เดอร์ที่มีทั้งคู่)
  for (const o of orders || []) {
    if (!o || SKIP.includes(o.status)) continue
    if (new Date(o.createdAt).getTime() < since) continue
    const ids = new Set()
    for (const it of o.items || []) {
      if (it?.kind !== 'retail' || !it.retailId) continue
      sales[it.retailId] = (sales[it.retailId] || 0) + (Number(it.qty) || 0)
      ids.add(it.retailId)
    }
    if (ids.size < 2) continue
    for (const a of ids) {
      if (!co.has(a)) co.set(a, new Map())
      for (const b of ids) if (a !== b) co.get(a).set(b, (co.get(a).get(b) || 0) + 1)
    }
  }
  const pairs = {}
  for (const [a, m] of co) {
    const top = [...m.entries()].filter(([, n]) => n >= RETAIL_STATS.pairMin).sort((x, y) => y[1] - x[1]).slice(0, RETAIL_STATS.pairTop)
    if (top.length) pairs[a] = top.map(([id, n]) => ({ id, n }))
  }
  return { sales, pairs }
}

// id สินค้าที่มักสั่งร่วมกับสินค้านี้ (เรียงตามจำนวนออร์เดอร์ที่พบ)
export function alsoBoughtIds(pairs, id) {
  return (pairs?.[id] || []).map((x) => x.id)
}

// id สินค้าที่แนะนำจากสิ่งที่ลูกค้าเคยสั่ง: รวมคะแนนจากคู่สินค้า แล้วตัดสินค้าที่เคยสั่งแล้วออก
// ถ้าไม่มีข้อมูลคู่สินค้า → คืนว่าง (ผู้เรียกจะ fallback ไปขายดี)
export function personalIds(pairs, boughtIds) {
  const bought = new Set(boughtIds || [])
  const score = new Map()
  for (const b of bought) for (const x of pairs?.[b] || []) {
    if (bought.has(x.id)) continue
    score.set(x.id, (score.get(x.id) || 0) + x.n)
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

// id สินค้าเรียงจากยอดขายมากไปน้อย (ตัดที่ยอดเป็นศูนย์)
export function topSalesIds(sales) {
  return Object.entries(sales || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
