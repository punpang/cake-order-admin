// POS แนะนำขาย (ฟังก์ชันล้วน): ซื้อคู่กัน · อันดับขายดี · ชุดบันเดิ้ลที่ใกล้ครบ
import { inSchedule, round2 } from './posPromo'

const COUNTED = (o) => !['draft', 'cancelled'].includes(o.status)
const inWindow = (o, days, now) => now.getTime() - new Date(o.createdAt).getTime() <= days * 86400e3 && new Date(o.createdAt).getTime() <= now.getTime() + 60e3
const retailIds = (o) => [...new Set((o.items || []).filter((i) => i.kind === 'retail' && i.retailId).map((i) => i.retailId))]

export const REC = { coDays: 90, coMin: 2, coLimit: 3, rankDays: 30, stars: 5 }

// สินค้าที่มักถูกซื้อพร้อมสินค้าในตะกร้า: นับ "จำนวนออร์เดอร์/บิล" ที่มีทั้งคู่ (ไม่ใช่จำนวนชิ้น)
// cartIds = retailId ในตะกร้า · ตัดสินค้าที่อยู่ในตะกร้าแล้ว · eligible = Set ของ retailId ที่แนะนำได้ (ว่าง = ทุกตัว)
export function coBought(orders, cartIds, { days = REC.coDays, min = REC.coMin, limit = REC.coLimit, now = new Date(), eligible = null } = {}) {
  const inCart = new Set(cartIds)
  if (!inCart.size) return []
  const score = new Map()
  for (const o of orders) {
    if (!COUNTED(o) || !inWindow(o, days, now)) continue
    const ids = retailIds(o)
    const hits = ids.filter((id) => inCart.has(id)).length
    if (!hits) continue
    for (const id of ids) {
      if (inCart.has(id) || (eligible && !eligible.has(id))) continue
      score.set(id, (score.get(id) || 0) + 1) // ออร์เดอร์นี้มีทั้งสินค้าในตะกร้าและสินค้าแนะนำ
    }
  }
  return [...score].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit).map(([retailId, count]) => ({ retailId, count }))
}

// อันดับขายดี: รวมจำนวนชิ้นในช่วง days วัน (ไม่นับร่าง/ยกเลิก) · ต้องขายได้ ≥ 1 · เสมอ = เรียงตามชื่อ · ดาวให้ stars อันดับแรก
// คืน Map<retailId, { rank, sold, star }>
export function rankSellers(orders, items, { days = REC.rankDays, stars = REC.stars, now = new Date() } = {}) {
  const sold = new Map()
  for (const o of orders) {
    if (!COUNTED(o) || !inWindow(o, days, now)) continue
    for (const i of o.items || []) if (i.kind === 'retail' && i.retailId) sold.set(i.retailId, (sold.get(i.retailId) || 0) + (Number(i.qty) || 0))
  }
  const name = new Map(items.map((x) => [x.id, x.name || '']))
  const rows = [...sold].filter(([id, n]) => n > 0 && name.has(id)).sort((a, b) => b[1] - a[1] || name.get(a[0]).localeCompare(name.get(b[0]), 'th'))
  return new Map(rows.map(([id, n], i) => [id, { rank: i + 1, sold: n, star: i < stars }]))
}

// ชุดบันเดิ้ลที่ลูกค้ามีบางชิ้นในตะกร้าแล้ว และชิ้นที่ขาดซื้อได้ (เปิดใช้/มีสต็อก)
// cart = [{ retailId, qty }] · items = [{ id, name, price, stock, ... }] (สินค้าที่ขายได้ใน POS)
// คืน [{ bundle, missing: [{ itemId, name, qty, price }], setRegular, saving, addCost }] เรียงตามประหยัดมาก สูงสุด limit
// used = { [itemId]: จำนวนชิ้นที่ถูกจัดเข้าบันเดิ้ลอื่นไปแล้ว } (ไม่นับซ้ำ ชิ้นเดียวอยู่ได้ชุดเดียว)
export function suggestBundles(cart, bundles, items, { now = new Date(), limit = 3, used = {} } = {}) {
  const have = new Map()
  for (const l of cart) have.set(l.retailId, (have.get(l.retailId) || 0) + (Number(l.qty) || 0))
  for (const [id, n] of Object.entries(used)) if (have.has(id)) have.set(id, Math.max(0, have.get(id) - (Number(n) || 0)))
  const byId = new Map(items.map((x) => [x.id, x]))
  const out = []
  for (const b of bundles || []) {
    if (b.active === false || !inSchedule(b.schedule, now) || !(b.items || []).length) continue
    const reqs = b.items.map((r) => ({ itemId: r.itemId, qty: Math.max(1, Number(r.qty) || 1) }))
    if (reqs.some((r) => !byId.has(r.itemId))) continue // ชิ้นในชุดขายใน POS ไม่ได้
    const partial = reqs.some((r) => (have.get(r.itemId) || 0) > 0)
    const missing = reqs.map((r) => ({ ...r, need: Math.max(0, r.qty - (have.get(r.itemId) || 0)) })).filter((r) => r.need > 0)
    if (!partial || !missing.length) continue // ไม่มีชิ้นเลย หรือครบชุดแล้ว
    const okStock = missing.every((r) => { const x = byId.get(r.itemId); return x.stock == null || x.stock - (have.get(r.itemId) || 0) >= r.need })
    if (!okStock) continue
    const setRegular = round2(reqs.reduce((s, r) => s + (Number(byId.get(r.itemId).price) || 0) * r.qty, 0))
    const saving = round2(setRegular - (Number(b.price) || 0))
    if (!(saving > 0)) continue
    out.push({
      bundle: b, saving, setRegular, addCost: round2(missing.reduce((s, r) => s + (Number(byId.get(r.itemId).price) || 0) * r.need, 0)),
      missing: missing.map((r) => ({ itemId: r.itemId, name: byId.get(r.itemId).name, qty: r.need, price: Number(byId.get(r.itemId).price) || 0 })),
    })
  }
  return out.sort((a, b) => b.saving - a.saving || String(a.bundle.id).localeCompare(String(b.bundle.id))).slice(0, limit)
}
