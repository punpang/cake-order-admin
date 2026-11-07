import { watch } from 'vue'

// ซิงก์ "ตั้งค่า/แคตตาล็อก" (ร้าน, คะแนน, ตัวเลือกเค้ก, ราคา, POS ฯลฯ) กับ punpang_kv — 1 แถวต่อ 1 คีย์ของ db
// ไม่รวมความลับ/ข้อมูลรายคน (integrations, users, ลูกค้า, ออร์เดอร์ ฯลฯ) — ดู CONFIG_KEYS
// ยังไม่รวม ingredients และ optionGroups: มีต้นทุน/สูตร (packPrice, recipe) ต้องแยกให้เฉพาะสิทธิ์ viewProfit/viewMaterials แบบเดียวกับ item_costs ก่อน
// storefront/legal ใช้ collection ของตัวเอง เพื่อให้หน้าร้านสาธารณะอ่านได้ภายหลัง (นโยบาย kv_public_read)
export const CONFIG_KEYS = [
  'shop', 'loyalty', 'rewards', 'gachaPrizes', 'priceLists', 'bundles',
  'cannedReplies', 'notifyRules', 'posModifiers', 'posDiscounts', 'posBundles', 'posDeals', 'pointPromos',
  'storefront', 'legal',
]
const PUBLIC_COLLECTIONS = ['storefront', 'legal']
export const collectionOf = (key) => (PUBLIC_COLLECTIONS.includes(key) ? key : 'config')

export async function loadConfig(client, keys = CONFIG_KEYS) {
  const r = await client.from('punpang_kv').select('collection,id,data').in('collection', [...new Set(keys.map(collectionOf))])
  if (r.error) return { error: r.error.message }
  const map = {}
  for (const row of r.data || []) if (keys.includes(row.id) && row.collection === collectionOf(row.id)) map[row.id] = row.data?.v
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

export async function pushConfig(client, db, keys) {
  const rows = keys.map((k) => ({ collection: collectionOf(k), id: k, data: { v: JSON.parse(JSON.stringify(db[k] ?? null)) } }))
  const r = await client.from('punpang_kv').upsert(rows)
  return r.error ? { error: r.error.message } : { ok: true }
}

export async function startConfigSync({ client, db, canWrite, onError = () => {}, keys = CONFIG_KEYS, debounceMs = 800 }) {
  const loaded = await loadConfig(client, keys)
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
      const r = await pushConfig(client, db, changed)
      if (r.error) onError('บันทึกตั้งค่าไม่สำเร็จ: ' + r.error)
      else for (const k of changed) snap.set(k, JSON.stringify(db[k]))
    }
    busy = false
    if (again) { again = false; flush() }
  }
  const stopWatch = watch(() => keys.map((k) => JSON.stringify(db[k])).join('\u0001'), () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) })
  return { stop() { stopWatch(); clearTimeout(timer) }, loaded: true, flush }
}
