import { startSync, selectAll } from './tableSync'
import { externalizePublic } from './storage'

// ซิงก์สินค้าหน้าร้าน (db.retailItems) กับ Supabase: โหลดตอนเริ่ม + เขียนกลับเมื่อแก้ (เฉพาะผู้มีสิทธิ์ editItems)
// punpang_items = ชื่อ/ราคา/สถานะ/ข้อมูลทั่วไป (หน้าร้านอ่านได้)
// punpang_kv('item_costs') = สูตร/ต้นทุน (เฉพาะพนักงานที่มีสิทธิ์) — ห้ามเก็บสูตรใน punpang_items
export const COST_COLLECTION = 'item_costs'

export function itemToRows(it) {
  const { recipe, id, name, price, active, ...rest } = it
  return {
    item: { id, kind: 'retail', name: String(name ?? ''), price: price == null ? null : Number(price), active: active !== false, data: rest },
    cost: { collection: COST_COLLECTION, id, data: { recipe: Array.isArray(recipe) ? recipe : [] } },
  }
}

export function rowsToItem(row, cost) {
  return { ...(row.data || {}), id: row.id, name: row.name, price: row.price == null ? null : Number(row.price), active: row.active, recipe: cost?.data?.recipe || [] }
}

export async function loadItems(client) {
  const a = await selectAll((x, y) => client.from('punpang_items').select('id,name,price,active,data').eq('kind', 'retail').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  const b = await selectAll((x, y) => client.from('punpang_kv').select('id,data').eq('collection', COST_COLLECTION).order('id').range(x, y))
  if (b.error) return { error: b.error.message }
  const costs = new Map((b.data || []).map((c) => [c.id, c]))
  return { items: (a.data || []).map((r) => rowsToItem(r, costs.get(r.id))) }
}

export { diffById as diffItems } from './tableSync'

export async function pushChanges(client, { upserts, deletes }) {
  if (upserts.length) {
    // รูปที่เพิ่งเลือก (data:/blob:) → อัปโหลดไป Storage แล้วใช้ลิงก์ถาวร (ล้มเหลว = ไม่เขียนลงฐานข้อมูล)
    try { for (const it of upserts) await externalizePublic(client, it, 'items') } catch (e) { return { error: `อัปโหลดรูปไม่สำเร็จ: ${e.message}` } }
    const rows = upserts.map(itemToRows)
    const r1 = await client.from('punpang_items').upsert(rows.map((x) => x.item))
    if (r1.error) return { error: r1.error.message }
    const r2 = await client.from('punpang_kv').upsert(rows.map((x) => x.cost))
    if (r2.error) return { error: r2.error.message }
  }
  if (deletes.length) {
    const r3 = await client.from('punpang_items').delete().in('id', deletes)
    if (r3.error) return { error: r3.error.message }
    const r4 = await client.from('punpang_kv').delete().eq('collection', COST_COLLECTION).in('id', deletes)
    if (r4.error) return { error: r4.error.message }
  }
  return { ok: true }
}

// เริ่มซิงก์สินค้า (ใช้เครื่องยนต์กลาง tableSync)
export function startItemsSync({ client, db, canWrite, onError, debounceMs }) {
  return startSync({
    list: () => db.retailItems,
    replace: (items) => db.retailItems.splice(0, db.retailItems.length, ...items),
    load: () => loadItems(client),
    push: (changes) => pushChanges(client, changes),
    canWrite, onError, debounceMs, label: 'สินค้า', poll: true,
  })
}
