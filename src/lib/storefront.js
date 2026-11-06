// ข้อมูลหน้าร้าน (สาธารณะ) คำนวณจากข้อมูลหลังบ้าน · ฟังก์ชันล้วน รับ db เข้ามา
import { activeLists, typePrice, typeSizePrice, flavorPrice } from './pricing'
import { applyPosPromos, inSchedule, describeSchedule, round2 } from './posPromo'
import { toDateStr } from './format'

const today = () => toDateStr(new Date())
const onlyActive = (list) => (list || []).filter((x) => x.active !== false)
const groupOf = (db, key) => db.optionGroups.find((g) => g.key === key)

// สินค้าที่แสดงหน้าร้าน = สินค้า POS ที่เปิดใช้งาน + เปิด "แสดงที่หน้าร้าน" · ราคาลดตามโปร POS ที่ใช้อยู่ตอนนี้ (ส่วนลดรายสินค้า/หมวด/บันเดิ้ลไม่นับ)
// คืน { product (= สินค้า POS), price, regular, discounted, promo } (คงชื่อฟิลด์ product ไว้ให้หน้าเว็บเดิม)
export function readyMenu(db, now = new Date()) {
  return onlyActive(db.retailItems)
    .filter((x) => x.showOnStore)
    .map((p) => {
      const res = applyPosPromos([{ retailId: p.id, category: p.category || '', price: Number(p.price) || 0, qty: 1 }], { discounts: db.posDiscounts.filter((d) => d.scope !== 'bill'), now })
      const seg = res.lines[0][0]
      const price = round2((Number(p.price) || 0) - seg.perUnit)
      return { product: p, price, regular: Number(p.price) || 0, discounted: seg.perUnit > 0, promo: seg.entries[0]?.name || '' }
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
    for (const it of o.items) if (it.kind === 'retail' && it.retailId) sold.set(it.retailId, (sold.get(it.retailId) || 0) + (Number(it.qty) || 0))
  }
  const rows = readyMenu(db).map((r) => ({ ...r, sold: sold.get(r.product.id) || 0, pinned: !!r.product.pinned }))
  const pinned = rows.filter((r) => r.pinned)
  const auto = rows.filter((r) => !r.pinned && r.sold > 0).sort((a, b) => b.sold - a.sold)
  return [...pinned, ...auto].slice(0, limit)
}

// โปรโมชันที่เปิดอยู่ตอนนี้: แบบราคาพิเศษของเค้กสั่งทำ + ส่วนลด/บันเดิ้ล POS ที่เกี่ยวกับสินค้าที่แสดงหน้าร้าน
// คืน [{ id, name, from, to, products: [{ product, price, regular }], custom, text }]
export function activePromotions(db, now = new Date()) {
  const d = today()
  const store = onlyActive(db.retailItems).filter((x) => x.showOnStore)
  const out = activeLists(db.priceLists, d).map((l) => ({
    id: l.id, name: l.name, from: l.scheduled ? l.from : '', to: l.scheduled ? l.to : '', products: [], text: '',
    custom: [l.types, l.typeSizes, l.flavors].some((o) => o && Object.keys(o).length),
  })).filter((p) => p.custom)
  const names = (ids) => store.filter((x) => ids.includes(x.id)).map((x) => x.name)
  for (const x of db.posDiscounts || []) {
    if (x.active === false || !inSchedule(x.schedule, now) || x.scope === 'bill') continue
    const hit = x.scope === 'all' ? store : x.scope === 'category' ? store.filter((i) => (x.categories || []).includes(i.category)) : store.filter((i) => (x.itemIds || []).includes(i.id))
    if (!hit.length) continue
    const off = x.type === 'percent' ? `ลด ${x.value}%` : `ลด ${x.value} บาท`
    out.push({ id: x.id, name: x.name, from: x.schedule?.from || '', to: x.schedule?.to || '', custom: false, text: `${off} · ${describeSchedule(x.schedule)}`, products: hit.map((i) => ({ product: i, price: round2((Number(i.price) || 0) - (x.type === 'percent' ? ((Number(i.price) || 0) * Math.min(x.value, 100)) / 100 : Math.min(x.value, Number(i.price) || 0))), regular: Number(i.price) || 0 })) })
  }
  for (const b of db.posBundles || []) {
    if (b.active === false || !inSchedule(b.schedule, now)) continue
    const ns = names((b.items || []).map((x) => x.itemId))
    if (ns.length !== (b.items || []).length) continue // ต้องแสดงหน้าร้านครบทุกชิ้นในชุด
    out.push({ id: b.id, name: b.name, from: b.schedule?.from || '', to: b.schedule?.to || '', custom: false, products: [], text: `ชุด ${ns.join(' + ')} ราคา ${b.price} บาท · ${describeSchedule(b.schedule)}` })
  }
  return out
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
