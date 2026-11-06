// ข้อมูลหน้าร้าน (สาธารณะ) คำนวณจากข้อมูลหลังบ้าน · ฟังก์ชันล้วน รับ db เข้ามา
import { activeLists, productPrice, typePrice, typeSizePrice, flavorPrice } from './pricing'
import { toDateStr } from './format'

const today = () => toDateStr(new Date())
const onlyActive = (list) => (list || []).filter((x) => x.active !== false)
const groupOf = (db, key) => db.optionGroups.find((g) => g.key === key)

// เค้กสำเร็จที่เปิดใช้งาน พร้อมราคาที่ใช้ + ราคาปกติ
export function readyMenu(db) {
  const active = activeLists(db.priceLists, today())
  return onlyActive(db.products).map((p) => {
    const price = productPrice(p, db.optionGroups, active)
    const regular = productPrice(p, db.optionGroups, [])
    return { product: p, price, regular, discounted: price < regular }
  })
}

// เนื้อเค้ก/ขนาดที่ประเภทนั้นมีให้เลือก (ตาม allow)
export function typeChoices(db, type) {
  const flavor = groupOf(db, 'flavor')
  const size = groupOf(db, 'size')
  const ok = (g, o) => !type.allow?.[g?.id] || type.allow[g.id].includes(o.id)
  return {
    flavors: onlyActive(flavor?.options).filter((o) => ok(flavor, o)),
    sizes: onlyActive(size?.options).filter((o) => ok(size, o)),
  }
}

// เค้กสั่งทำ แยกตามประเภท (เฉพาะที่เปิดใช้งาน) · ราคาเริ่มต้น = ประเภท + ขนาดเล็กสุด + เนื้อเค้กถูกสุด
export function customMenu(db) {
  const active = activeLists(db.priceLists, today())
  const flavor = groupOf(db, 'flavor')
  const type = groupOf(db, 'type')
  const from = (t, lists) => {
    const { flavors, sizes } = typeChoices(db, t)
    const sizePrices = sizes.map((s) => typeSizePrice(t, s.id, lists))
    const flavorPrices = flavors.map((f) => flavorPrice(f, lists))
    return typePrice(t, lists) + (sizePrices.length ? Math.min(...sizePrices) : 0) + (flavorPrices.length ? Math.min(...flavorPrices) : 0)
  }
  return onlyActive(type?.options).map((t) => {
    const { flavors, sizes } = typeChoices(db, t)
    const price = from(t, active)
    const regular = from(t, [])
    const sizeRows = sizes.map((s) => ({ size: s, price: typePrice(t, active) + typeSizePrice(t, s.id, active), regular: typePrice(t, []) + typeSizePrice(t, s.id, []) }))
    return { type: t, flavors, sizes: sizeRows, flavorGroupName: flavor?.name || 'เนื้อเค้ก', from: price, regularFrom: regular, discounted: price < regular }
  })
}

// ขายดี: เค้กสำเร็จที่ขายได้มากสุดในช่วง days วัน (ไม่นับร่าง/ยกเลิก) · สินค้าที่แอดมินปักหมุดขึ้นก่อน
export function bestSellers(db, days = 30, limit = 6) {
  const since = Date.now() - days * 86400e3
  const sold = new Map()
  for (const o of db.orders) {
    if (['draft', 'cancelled'].includes(o.status)) continue
    if (new Date(o.createdAt).getTime() < since) continue
    for (const it of o.items) if (it.kind === 'ready' && it.productId) sold.set(it.productId, (sold.get(it.productId) || 0) + (Number(it.qty) || 0))
  }
  const rows = readyMenu(db).map((r) => ({ ...r, sold: sold.get(r.product.id) || 0, pinned: !!r.product.pinned }))
  const pinned = rows.filter((r) => r.pinned)
  const auto = rows.filter((r) => !r.pinned && r.sold > 0).sort((a, b) => b.sold - a.sold)
  return [...pinned, ...auto].slice(0, limit)
}

// โปรโมชัน: แบบราคาพิเศษที่เปิดอยู่ตอนนี้ + เค้กสำเร็จที่ราคาถูกลง
export function activePromotions(db) {
  const d = today()
  return activeLists(db.priceLists, d).map((l) => {
    const one = [l]
    const products = onlyActive(db.products)
      .map((p) => ({ product: p, price: productPrice(p, db.optionGroups, one), regular: productPrice(p, db.optionGroups, []) }))
      .filter((x) => x.price < x.regular)
    const custom = [l.types, l.typeSizes, l.flavors].some((o) => o && Object.keys(o).length)
    return { id: l.id, name: l.name, from: l.scheduled ? l.from : '', to: l.scheduled ? l.to : '', products, custom }
  })
}

// รีวิวที่แสดงหน้าร้าน (อนุมัติแล้ว ใหม่สุดก่อน)
export const approvedReviews = (db, limit = 12) =>
  db.reviews.filter((r) => r.status === 'approved').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
export const avgRating = (list) => (list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : 0)

// ลิงก์สั่งทาง LINE / Facebook พร้อมข้อความตั้งต้น (ถ้าร้านตั้งลิงก์ไว้)
export function orderLinks(db, text = '') {
  const s = db.storefront
  return { line: s.lineUrl || '', facebook: s.facebookUrl || '', text }
}
