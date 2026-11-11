// ข้อมูลหน้าร้าน (สาธารณะ) คำนวณจากข้อมูลหลังบ้าน · ฟังก์ชันล้วน รับ db เข้ามา
import { activeLists, typePrice, typeSizePrice, flavorPrice } from './pricing'
import { applyPosPromos, inSchedule, describeSchedule, round2 } from './posPromo'
import { describeDeal } from './promoDeals'
import { toDateStr } from './format'
import { alsoBoughtIds, personalIds, topSalesIds } from './retailStats'

const today = () => toDateStr(new Date())
const onlyActive = (list) => (list || []).filter((x) => x.active !== false)
const groupOf = (db, key) => db.optionGroups.find((g) => g.key === key)

// สินค้าที่แสดงหน้าร้าน = สินค้า POS ที่เปิดใช้งาน + เปิด "แสดงที่หน้าร้าน" · ราคาลดตามโปร POS ที่ใช้อยู่ตอนนี้ (ส่วนลดรายสินค้า/หมวด/บันเดิ้ลไม่นับ)
// คืน { product (= สินค้า POS), price, regular, discounted, promo } (คงชื่อฟิลด์ product ไว้ให้หน้าเว็บเดิม)
export function readyMenu(db, now = new Date()) {
  return onlyActive(db.retailItems)
    .filter((x) => x.showOnStore)
    .map((p0) => {
      // รูปสินค้า = รูปเดิม + รูปงานที่เผยแพร่ (ตัดรูปของออร์เดอร์ที่ลูกค้าขอไม่เผยแพร่)
      const p = { ...p0, images: [...(p0.images || []), ...(p0.workImages || []).filter((w) => { const o = (db.orders || []).find((x) => x.id === w.orderId); return !!o && (o.photoConsent?.status || 'ok') === 'ok' }).map((w) => w.image)] }
      const res = applyPosPromos([{ retailId: p.id, category: p.category || '', price: Number(p.price) || 0, qty: 1 }], { discounts: db.posDiscounts.filter((d) => d.scope !== 'bill'), now })
      const seg = res.lines[0][0]
      const price = round2((Number(p.price) || 0) - seg.perUnit)
      return { product: p, price, regular: Number(p.price) || 0, discounted: seg.perUnit > 0, promo: seg.entries[0]?.name || '' }
    })
}

// สินค้าที่กำลังมีโปรโมชั่น (หน้าแรก): สินค้าสำเร็จที่ราคาลดอยู่ตอนนี้ ไม่รวมที่หมดสต็อก · เรียง % ส่วนลดมากสุดก่อน (เท่ากัน → ราคาลดถูกกว่าก่อน)
// คืน { items, total } · items ตัดตาม limit · total = จำนวนทั้งหมดที่เข้าเงื่อนไข
export function promoProducts(db, limit = 6, now = new Date()) {
  const all = readyMenu(db, now)
    .filter((r) => r.discounted && (r.product.stock == null || r.product.stock > 0))
    .map((r) => ({ ...r, pct: r.regular > 0 ? (r.regular - r.price) / r.regular : 0 }))
    .sort((a, b) => b.pct - a.pct || a.price - b.price)
  return { items: all.slice(0, limit), total: all.length }
}

// สินค้าหน้าร้านจัดกลุ่มตามหมวด (หมวดว่าง = "อื่น ๆ" อยู่ท้ายสุด) · ในหมวดปักหมุดก่อน · เงื่อนไขการแสดงเหมือน readyMenu (เปิดใช้งาน + แสดงที่หน้าร้าน)
// แต่ละรายการเพิ่ม: stock, stockState ('out' | 'low' | ''), options = ชื่อกลุ่มตัวเลือกเสริมที่ผูกกับสินค้า (เหมือน POS)
export function readyByCategory(db, now = new Date()) {
  const mods = db.posModifiers || []
  const rows = readyMenu(db, now).map((r) => {
    const st = r.product.stock
    return { ...r, stock: st, stockState: st == null ? '' : st <= 0 ? 'out' : st <= 5 ? 'low' : '', options: (r.product.modifierIds || []).map((id) => mods.find((m) => m.id === id)).filter((m) => m && m.active !== false).map((m) => ({ name: m.name, choices: (m.options || []).map((o) => o.name) })) }
  })
  const order = []
  for (const r of rows) { const c = r.product.category || ''; if (!order.includes(c)) order.push(c) }
  order.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0))
  // ในหมวด: ปักหมุดก่อน แล้วยอดขายมาก→น้อย · ยอดฮิต = 2 อันดับแรกที่มียอดขาย
  const sold = db.publicStats?.retailSales || {}
  return order.map((c) => {
    const items = rows.filter((r) => (r.product.category || '') === c)
      .map((r) => ({ ...r, sold: Number(sold[r.product.id]) || 0 }))
      .sort((a, b) => (b.product.pinned ? 1 : 0) - (a.product.pinned ? 1 : 0) || b.sold - a.sold)
      .map((r, i) => ({ ...r, hot: r.sold > 0 && i < 2 }))
    return { category: c || 'อื่น ๆ', key: c, items }
  })
}

// สินค้าที่มักสั่งร่วมกับสินค้านี้ (หน้าสินค้า) · แสดงเป็นคำแนะนำอย่างเดียว ไม่มีการสั่งจากตรงนี้
export function alsoBoughtFor(db, id, limit = 4) {
  return rowsFor(db, alsoBoughtIds(db.publicStats?.retailPairs, id), [id], limit)
}
// แนะนำจากสิ่งที่ลูกค้าเคยสั่ง (หน้าบัญชี) · ถ้าไม่มีข้อมูลคู่สินค้า ใช้สินค้าขายดีแทน
export function forBoughtIds(db, boughtIds, limit = 4) {
  const bought = boughtIds || []
  const fromPairs = personalIds(db.publicStats?.retailPairs, bought)
  const ids = fromPairs.length ? fromPairs : topSalesIds(db.publicStats?.retailSales)
  return rowsFor(db, ids, bought, limit)
}
// แปลง id เป็นแถวสินค้าที่สั่งได้ (แสดงหน้าร้าน ไม่หมด) · ตัด id ที่ระบุออก
function rowsFor(db, ids, exclude, limit) {
  const skip = new Set(exclude)
  const map = new Map(readyMenu(db).map((r) => [r.product.id, r]))
  const out = []
  for (const id of ids) {
    if (skip.has(id)) continue
    const r = map.get(id)
    if (!r || r.product.stock === 0) continue
    out.push(r)
    if (out.length >= limit) break
  }
  return out
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
    // ราคาเริ่มต้น = ต่ำสุดของ (ราคาขนาด + เนื้อเค้กถูกสุดของขนาดนั้น) เพราะเนื้อเค้กอาจตั้งราคาตามขนาด
    const at = (sid) => (sid ? typeSizePrice(t, sid, lists) : 0) + (flavors.length ? Math.min(...flavors.map((f) => flavorPrice(f, lists, null, sid))) : 0)
    return typePrice(t, lists) + (sizes.length ? Math.min(...sizes.map((s) => at(s.id))) : at(null))
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
  // หน้าร้านสาธารณะไม่มีประวัติออร์เดอร์ → ใช้ยอดขายสาธารณะที่เผยแพร่ไว้
  if (!sold.size) for (const [id, n] of Object.entries(db.publicStats?.retailSales || {})) sold.set(id, Number(n) || 0)
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
    custom: [l.types, l.typeSizes, l.flavors, l.styles, l.shapes, l.flavorSizes, l.styleSizes, l.shapeSizes].some((o) => o && Object.keys(o).length),
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
  // ดีล: แสดงชื่อ + เงื่อนไข (เฉพาะที่สินค้าที่เกี่ยวข้องแสดงหน้าร้านอยู่ หรือดีลตามยอดทั้งบิล)
  const nameOf = (id) => db.retailItems.find((x) => x.id === id)?.name || ''
  for (const d of db.posDeals || []) {
    if (d.active === false || !inSchedule(d.schedule, now)) continue
    if (['spend_free', 'spend_addon'].includes(d.kind) && !store.some((i) => i.id === (d.giftItemId || d.itemId))) continue
    if (d.kind === 'bogo' && d.giftItemId && !store.some((i) => i.id === d.giftItemId)) continue
    if ((d.kind === 'bogo' || d.kind === 'nth') && d.scope !== 'all') {
      const hit = d.scope === 'category' ? store.filter((i) => (d.categories || []).includes(i.category)) : store.filter((i) => (d.itemIds || []).includes(i.id))
      if (!hit.length) continue
    }
    out.push({ id: d.id, name: d.name, from: d.schedule?.from || '', to: d.schedule?.to || '', custom: false, products: [], text: `${describeDeal(d, nameOf)} · ${describeSchedule(d.schedule)}` })
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
