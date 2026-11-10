import { applyValue } from './configSync'
import { rowsToItem } from './itemsSync'
import { PUBLIC_COLLECTION, PUBLIC_KEYS, mirrorRows } from './publicData'
export { PUBLIC_COLLECTION, PUBLIC_KEYS, publicShop, mirrorRows } from './publicData'

// ข้อมูลที่หน้าร้านสาธารณะ (ผู้เยี่ยมชมที่ไม่ล็อกอิน) อ่านได้ — อ่านอย่างเดียว
//  - สินค้า: punpang_items (เฉพาะ active · สูตร/ต้นทุนอยู่ item_costs ไม่ถูกเปิด)
//  - หน้าร้าน/นโยบาย: kv 'storefront' (รวมแกลเลอรีเค้ก) และ 'legal' (เปิดสาธารณะอยู่แล้ว)
//  - ราคา/ตัวเลือก/โปรโมชั่น/ข้อมูลร้านบางส่วน: kv 'shop_public' = สำเนาที่แอดมินเผยแพร่ (ไม่ใช่ตัวจริงใน 'config')
export async function loadPublic(client) {
  // 3 คำขอไม่ขึ้นต่อกัน → ยิงพร้อมกัน (เร็วกว่าเดิม 2 รอบเครือข่าย)
  const [kv, rc, it] = await Promise.all([
    client.from('punpang_kv').select('collection,id,data').in('collection', [PUBLIC_COLLECTION, 'storefront', 'legal']),
    // ลิงก์ย่อไม่โหลดให้ผู้เยี่ยมชมแล้ว (เปิดผ่าน RPC punpang_resolve_short_link) · รีวิวอ่านได้เฉพาะที่อนุมัติ (RLS)
    client.from('punpang_records').select('collection,id,data').in('collection', ['reviews']),
    client.from('punpang_items').select('id,name,price,active,data').eq('kind', 'retail').eq('active', true).order('id'),
  ])
  if (kv.error) return { error: kv.error.message }
  if (rc.error) return { error: rc.error.message }
  if (it.error) return { error: it.error.message }
  const map = {}
  for (const r of kv.data || []) {
    if (r.collection === PUBLIC_COLLECTION && (r.id === 'shop' || PUBLIC_KEYS.includes(r.id))) map[r.id] = r.data?.v
    else if (r.collection === 'storefront' && (r.id === 'storefront' || r.id === 'cakeGallery')) map[r.id] = r.data?.v
    else if (r.collection === 'legal' && r.id === 'legal') map.legal = r.data?.v
  }
  const pubRec = { reviews: [], shortLinks: [] }
  for (const r of rc.data || []) pubRec[r.collection]?.push({ ...(r.data || {}), id: r.id })
  const t = (x) => String(x.createdAt || '')
  pubRec.reviews.sort((a, b) => t(b).localeCompare(t(a)))
  map.reviews = pubRec.reviews
  return { map, items: (it.data || []).map((r) => rowsToItem(r, null)) }
}

// ใส่ค่าลง db (คงอ็อบเจกต์เดิม) · ร้าน: ทับเฉพาะฟิลด์ที่เปิดสาธารณะ ที่เหลือคงค่าตั้งต้นในแอป
export function applyPublic(db, { map, items }) {
  for (const k of Object.keys(map)) {
    if (map[k] == null) continue
    if (k === 'shop') Object.assign(db.shop, map.shop)
    else applyValue(db, k, map[k])
  }
  db.retailItems.splice(0, db.retailItems.length, ...items)
}

// ผู้เยี่ยมชม/ผู้ที่ยังไม่ล็อกอิน: โหลดครั้งเดียว (อ่านอย่างเดียว) · ล้มเหลว = คงข้อมูลเดิม ไม่แสดง error ให้ผู้เยี่ยมชม
export async function startPublicLoad({ client, db, onError = () => {} }) {
  const r = await loadPublic(client)
  if (r.error) { onError(r.error); return false }
  applyPublic(db, r)
  return true
}

// แอดมิน: ถ้ายังไม่มีสำเนาสาธารณะครบ → เขียนจากข้อมูลปัจจุบัน (ครั้งแรกหลังเปิดใช้) · optionGroups ต้องตัดสูตรแล้ว
export async function ensureMirror(client, db, stripRecipes) {
  const have = await client.from('punpang_kv').select('id').eq('collection', PUBLIC_COLLECTION)
  if (have.error) return { error: have.error.message }
  const ids = new Set((have.data || []).map((x) => x.id))
  const want = ['shop', ...PUBLIC_KEYS]
  if (want.every((k) => ids.has(k))) return { ok: true, wrote: 0 }
  const values = {}
  for (const k of want) values[k] = k === 'optionGroups' ? stripRecipes(db.optionGroups).groups : db[k]
  const rows = mirrorRows(values).filter((r) => !ids.has(r.id))
  const w = await client.from('punpang_kv').upsert(rows)
  return w.error ? { error: w.error.message } : { ok: true, wrote: rows.length }
}
