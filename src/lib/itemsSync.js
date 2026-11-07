import { watch } from 'vue'

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
  const a = await client.from('punpang_items').select('id,name,price,active,data').eq('kind', 'retail').order('id')
  if (a.error) return { error: a.error.message }
  const b = await client.from('punpang_kv').select('id,data').eq('collection', COST_COLLECTION)
  if (b.error) return { error: b.error.message }
  const costs = new Map((b.data || []).map((c) => [c.id, c]))
  return { items: (a.data || []).map((r) => rowsToItem(r, costs.get(r.id))) }
}

// เทียบกับสแนปช็อตที่ซิงก์ล่าสุด → รายการที่ต้องเพิ่ม/แก้ และที่ถูกลบ
export function diffItems(snapshot, items) {
  const upserts = []
  const seen = new Set()
  for (const it of items) {
    seen.add(it.id)
    if (snapshot.get(it.id) !== JSON.stringify(it)) upserts.push(it)
  }
  const deletes = [...snapshot.keys()].filter((id) => !seen.has(id))
  return { upserts, deletes }
}

export async function pushChanges(client, { upserts, deletes }) {
  if (upserts.length) {
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

// เริ่มซิงก์: โหลดไม่สำเร็จ = ไม่เริ่มตัวเขียนกลับ (กันเขียนทับข้อมูลจริงด้วยรายการว่าง/ตัวอย่าง)
export async function startItemsSync({ client, db, canWrite, onError = () => {}, debounceMs = 600 }) {
  const loaded = await loadItems(client)
  if (loaded.error) { onError('โหลดสินค้าจากฐานข้อมูลไม่สำเร็จ: ' + loaded.error); return { stop() {}, loaded: false } }
  db.retailItems.splice(0, db.retailItems.length, ...loaded.items)
  const snapshot = new Map(db.retailItems.map((i) => [i.id, JSON.stringify(i)]))
  if (!canWrite) return { stop() {}, loaded: true }
  let timer = null
  let busy = false
  let again = false
  const flush = async () => {
    if (busy) { again = true; return }
    busy = true
    const changes = diffItems(snapshot, db.retailItems)
    if (changes.upserts.length || changes.deletes.length) {
      const r = await pushChanges(client, changes)
      if (r.error) onError('บันทึกสินค้าไม่สำเร็จ: ' + r.error)
      else {
        for (const it of changes.upserts) snapshot.set(it.id, JSON.stringify(it))
        for (const id of changes.deletes) snapshot.delete(id)
      }
    }
    busy = false
    if (again) { again = false; flush() }
  }
  const stopWatch = watch(() => JSON.stringify(db.retailItems), () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) })
  return { stop() { stopWatch(); clearTimeout(timer) }, loaded: true, flush }
}
