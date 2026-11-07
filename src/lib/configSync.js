import { watch } from 'vue'
import { externalizePublic } from './storage'

// ซิงก์ "ตั้งค่า/แคตตาล็อก" (ร้าน, คะแนน, ตัวเลือกเค้ก, ราคา, POS ฯลฯ) กับ punpang_kv — 1 แถวต่อ 1 คีย์ของ db
// ไม่รวมความลับ/ข้อมูลรายคน (integrations, users, ลูกค้า, ออร์เดอร์ ฯลฯ) — ดู CONFIG_KEYS
// ต้นทุน/สูตรแยกเก็บ: ingredients → collection 'materials' · สูตรใน optionGroups → item_costs/_optionGroups
// (อ่านได้เฉพาะ manage / viewProfit / viewMaterials) ส่วน optionGroups ที่เหลือ (ชื่อ/ราคาขาย) อยู่ 'config' ให้พนักงานขายอ่านได้
// storefront/legal ใช้ collection ของตัวเอง เพื่อให้หน้าร้านสาธารณะอ่านได้ภายหลัง (นโยบาย kv_public_read)
export const CONFIG_KEYS = [
  'shop', 'loyalty', 'rewards', 'gachaPrizes', 'priceLists', 'bundles', 'ingredients', 'optionGroups',
  'cannedReplies', 'bot', 'notifyRules', 'posModifiers', 'posDiscounts', 'posBundles', 'posDeals', 'pointPromos',
  'storefront', 'legal', 'cakeGallery',
]
const COLLECTION_OF = { storefront: 'storefront', legal: 'legal', cakeGallery: 'storefront', ingredients: 'materials' } // cakeGallery: หน้าร้านสาธารณะอ่านได้
export const collectionOf = (key) => COLLECTION_OF[key] || 'config'
export const OPTION_COSTS_ID = '_optionGroups'

// แยก/รวมสูตรของตัวเลือกเค้ก: คีย์ "groupId/optionId" → recipe
export function stripRecipes(groups) {
  const costs = {}
  const clean = (groups || []).map((g) => ({
    ...g,
    options: (g.options || []).map((o) => {
      const { recipe, ...rest } = o
      costs[`${g.id}/${o.id}`] = Array.isArray(recipe) ? recipe : []
      return rest
    }),
  }))
  return { groups: clean, costs }
}
export function mergeRecipes(groups, costs) {
  return (groups || []).map((g) => ({ ...g, options: (g.options || []).map((o) => ({ ...o, recipe: costs?.[`${g.id}/${o.id}`] || [] })) }))
}

export async function loadConfig(client, keys = CONFIG_KEYS, col = null) {
  const colOf = col ? () => col : collectionOf // col = ใช้ collection เดียวทั้งชุด (เช่น 'acct')
  const r = await client.from('punpang_kv').select('collection,id,data').in('collection', [...new Set(keys.map(colOf))])
  if (r.error) return { error: r.error.message }
  const map = {}
  for (const row of r.data || []) if (keys.includes(row.id) && row.collection === colOf(row.id)) map[row.id] = row.data?.v
  if (keys.includes('optionGroups') && map.optionGroups != null) {
    const c = await client.from('punpang_kv').select('id,data').eq('collection', 'item_costs').eq('id', OPTION_COSTS_ID)
    if (c.error) return { error: c.error.message }
    map.optionGroups = mergeRecipes(map.optionGroups, c.data?.[0]?.data?.v) // อ่านสูตรไม่ได้ (ไม่มีสิทธิ์) = สูตรว่าง
  }
  return { map }
}

// ใส่ค่าที่โหลดมาลงใน db โดยคงอ็อบเจกต์/อาร์เรย์เดิม (ให้ reactive และ ref ที่ถืออยู่ยังชี้ถูก)
export function applyValue(db, key, value) {
  const cur = db[key]
  if (Array.isArray(cur) && Array.isArray(value)) cur.splice(0, cur.length, ...value)
  else if (cur && typeof cur === 'object' && !Array.isArray(cur) && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of Object.keys(cur)) if (!(k in value)) delete cur[k]
    Object.assign(cur, value)
  } else db[key] = value
}

export async function pushConfig(client, db, keys, col = null) {
  const colOf = col ? () => col : collectionOf
  // ตั้งค่าร้าน/ตัวเลือกเค้ก/หน้าร้าน: รูปที่เพิ่งเลือกอัปโหลดไป Storage สาธารณะก่อน (ชุด acct/audit ไม่มีรูป ข้าม)
  if (!col) {
    const cache = new Map() // รูปเดียวกันต่างคีย์ อัปโหลดครั้งเดียว
    try { for (const k of keys) if (db[k] && typeof db[k] === 'object') await externalizePublic(client, db[k], 'config', cache) } catch (e) { return { error: `อัปโหลดรูปไม่สำเร็จ: ${e.message}` } }
  }
  const rows = []
  for (const k of keys) {
    const v = JSON.parse(JSON.stringify(db[k] ?? null))
    if (k === 'optionGroups') {
      const { groups, costs } = stripRecipes(v)
      rows.push({ collection: colOf(k), id: k, data: { v: groups } })
      rows.push({ collection: 'item_costs', id: OPTION_COSTS_ID, data: { v: costs } })
    } else rows.push({ collection: colOf(k), id: k, data: { v } })
  }
  const r = await client.from('punpang_kv').upsert(rows)
  return r.error ? { error: r.error.message } : { ok: true }
}

export async function startConfigSync({ client, db, canWrite, onError = () => {}, keys = CONFIG_KEYS, debounceMs = 800, collection = null }) {
  const loaded = await loadConfig(client, keys, collection)
  if (loaded.error) { onError('โหลดตั้งค่าจากฐานข้อมูลไม่สำเร็จ: ' + loaded.error); return { stop() {}, loaded: false } }
  for (const k of keys) if (k in loaded.map && loaded.map[k] != null) applyValue(db, k, loaded.map[k])
  // คีย์ที่ยังไม่มีในฐานข้อมูล = ใช้ค่าตั้งต้นในแอปต่อ และเขียนเมื่อมีการแก้ไขเท่านั้น
  const snap = new Map(keys.map((k) => [k, k in loaded.map ? JSON.stringify(db[k]) : null]))
  const baseline = new Map(keys.map((k) => [k, JSON.stringify(db[k])]))
  if (!canWrite) return { stop() {}, loaded: true }
  let timer = null
  let busy = false
  let again = false
  const flush = async () => {
    if (busy) { again = true; return }
    busy = true
    const changed = keys.filter((k) => {
      const now = JSON.stringify(db[k])
      return snap.get(k) === null ? now !== baseline.get(k) : now !== snap.get(k)
    })
    if (changed.length) {
      const r = await pushConfig(client, db, changed, collection)
      if (r.error) onError('บันทึกตั้งค่าไม่สำเร็จ: ' + r.error)
      else for (const k of changed) snap.set(k, JSON.stringify(db[k]))
    }
    busy = false
    if (again) { again = false; flush() }
  }
  const stopWatch = watch(() => keys.map((k) => JSON.stringify(db[k])).join('\u0001'), () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) })
  return { stop() { stopWatch(); clearTimeout(timer) }, loaded: true, flush }
}
