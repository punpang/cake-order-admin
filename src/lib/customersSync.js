import { reactive } from 'vue'
import { startSync, selectAll, withVer, casUpdate, fillArray } from './tableSync.js'

// ซิงก์ลูกค้า (db.customers) กับ punpang_customers · ข้อมูลทั่วไป/คะแนน/ที่อยู่ ฯลฯ เก็บใน data (jsonb)
// ลูกค้าไม่ถูกลบจริง (ใช้ธง deleted/active) — ตารางไม่มี policy ลบ จึงข้ามการลบ
// หมายเหตุ: PIN/OTP ไม่อยู่ในที่นี้ (จะอยู่ punpang_customer_auth ฝั่งเซิร์ฟเวอร์)
export function customerToRow(c) {
  const { id, name, phone, note, ...rest } = c
  return { id, name: String(name ?? ''), phone: phone || null, note: note || null, data: rest }
}
export function rowToCustomer(r) {
  return withVer({ ...(r.data || {}), id: r.id, name: r.name, phone: r.phone || '', note: r.note || '' }, r.updated_at)
}
const COLS = 'id,name,phone,note,data,updated_at'
export async function loadCustomers(client) {
  const a = await selectAll((x, y) => client.from('punpang_customers').select(COLS).order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToCustomer) }
}

// ---------- โหมดโหลดเฉพาะลูกค้าที่ใช้ (สำหรับลูกค้าจำนวนมาก) ----------
// เปิดด้วยมือที่ ตั้งค่าร้าน (shop.customerLazy) และต้องให้เซิร์ฟเวอร์ส่งเตือนตามเวลา (scheduled.server) เพราะรอบเตือนวันเกิดในแอปต้องเห็นลูกค้าทุกคน
// มีผลตอนเข้าสู่ระบบ · ปิด (ค่าเริ่มต้น) = โหลดทั้งตารางเหมือนเดิม
export const LAZY_RECENT = 500 // ลูกค้าที่แก้ล่าสุดที่โหลดไว้ก่อน
export const CUSTOMER_WARN_AT = 1000 // จำนวนลูกค้าที่เริ่มเตือนให้ทดสอบและเปิดโหมดนี้
export const customerScale = reactive({ lazy: false, count: null })
export async function lazyWanted(client) {
  const r = await client.from('punpang_kv').select('id,data').eq('collection', 'config').in('id', ['shop', 'scheduled'])
  if (r.error) return false
  const m = Object.fromEntries((r.data || []).map((x) => [x.id, x.data?.v]))
  return m.shop?.customerLazy === true && m.scheduled?.server === true
}
export async function countCustomers(client) {
  const r = await client.from('punpang_customers').select('id', { count: 'exact', head: true })
  return r.error ? null : r.count
}
// ลูกค้าที่แก้ล่าสุด + ลูกค้าของออร์เดอร์ที่ยังไม่ปิด + ลูกค้าที่เครื่องนี้ถืออยู่ (keepIds: รอบโหลดใหม่ไม่ทิ้งคนที่ดึงมาแล้ว)
export async function loadCustomersLazy(client, keepIds = []) {
  const [recent, open] = await Promise.all([
    client.from('punpang_customers').select(COLS).order('updated_at', { ascending: false }).order('id').limit(LAZY_RECENT),
    selectAll((x, y) => client.from('punpang_orders').select('customer_id').not('status', 'in', '(cancelled,delivered)').not('customer_id', 'is', null).order('id').range(x, y)),
  ])
  if (recent.error) return { error: recent.error.message }
  if (open.error) return { error: open.error.message }
  const have = new Map((recent.data || []).map((r) => [r.id, r]))
  const need = [...new Set([...(open.data || []).map((r) => r.customer_id), ...keepIds])].filter((id) => id && !have.has(id))
  for (let i = 0; i < need.length; i += 100) {
    const p = await client.from('punpang_customers').select(COLS).in('id', need.slice(i, i + 100))
    if (p.error) return { error: p.error.message }
    for (const r of p.data || []) have.set(r.id, r)
  }
  return { items: [...have.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(rowToCustomer) }
}
// หน้ารายชื่อลูกค้า (โหมดโหลดเฉพาะที่ใช้): ดึงทีละหน้าเรียงตามชื่อ · คืนเฉพาะรหัส แล้วให้ตัวซิงก์ดึงแถวมารวม
export const CUSTOMER_PAGE = 50
export async function pageCustomerIds(client, offset = 0, size = CUSTOMER_PAGE) {
  const r = await client.from('punpang_customers').select('id').order('name').order('id').range(offset, offset + size - 1)
  if (r.error) return { error: r.error.message }
  return { ids: (r.data || []).map((x) => x.id) }
}
// ค้นลูกค้าที่เซิร์ฟเวอร์ (คืนเฉพาะรหัส แล้วให้ตัวซิงก์ดึงแถวมารวม) · เบอร์ ≥ 3 หลัก / รหัสสมาชิก 32 ตัว / ชื่อ ≥ 2 ตัวอักษร
const likeSafe = (s) => s.replace(/[%_\\,()*"]/g, ' ').trim()
export async function searchCustomerIds(client, q, limit = 30) {
  const t = String(q ?? '').trim()
  const d = t.replace(/\D/g, '')
  let qy = client.from('punpang_customers').select('id')
  if (/^[0-9a-f]{32}$/i.test(t)) qy = qy.eq('data->>scanCode', t.toLowerCase())
  else if (d.length >= 3 && d.length === t.replace(/[\s-]/g, '').length) qy = qy.like('phone', `%${d}%`)
  else if (likeSafe(t).length >= 2) qy = qy.ilike('name', `%${likeSafe(t)}%`)
  else return { ids: [] }
  const r = await qy.limit(limit)
  if (r.error) return { error: r.error.message }
  return { ids: (r.data || []).map((x) => x.id) }
}
// แถวใหม่ = insert · แถวที่มีแล้ว (known) = update (ห้าม upsert: policy INSERT ต้อง createOrder แต่ UPDATE รับ adjustPoints ด้วย
// → ผู้ที่มีแค่ adjustPoints จะถูกปฏิเสธเพราะ upsert ถูกตรวจฝั่ง INSERT)
export async function pushCustomers(client, { upserts }, { known = new Set() } = {}) {
  const fresh = upserts.filter((c) => !known.has(c.id))
  const old = upserts.filter((c) => known.has(c.id))
  const conflicts = []
  // แก้แถวเดิมแบบเทียบเวอร์ชัน (กันเขียนทับคะแนน/ข้อมูลที่เครื่องอื่นหรือระบบแก้ไปก่อน)
  const upd = async (c) => {
    const { id, ...rest } = customerToRow(c)
    const r = await casUpdate(client, 'punpang_customers', id, rest, c._v)
    if (r.conflict) { conflicts.push(id); return { ok: true } }
    if (r.error) return { error: r.error.message }
    withVer(c, r.ver)
    known.add(id)
    return { ok: true }
  }
  if (fresh.length) {
    const r = await client.from('punpang_customers').insert(fresh.map(customerToRow))
    // เบอร์ซ้ำกับลูกค้าที่มีอยู่แล้ว (เช่น เพิ่มจากอีกเครื่อง หรือยังไม่ได้โหลดมาในเครื่อง) → แจ้ง ไม่แปลงเป็นการแก้แถว (ไม่งั้นข้อมูลหายเงียบ)
    if (r.error && r.error.code === '23505' && /phone/.test(r.error.message || '')) return { error: 'เบอร์นี้มีลูกค้าในระบบแล้ว ค้นหาด้วยเบอร์แล้วเลือกลูกค้าเดิมแทนการเพิ่มใหม่' }
    if (r.error && r.error.code === '23505') old.push(...fresh) // มีอยู่แล้วในฐานข้อมูล → แก้แทน
    else if (r.error) return { error: r.error.message }
    else for (const c of fresh) known.add(c.id)
  }
  for (const c of old) { const r = await upd(c); if (r.error) return r }
  return conflicts.length ? { ok: true, conflicts } : { ok: true }
}
// ดึงเฉพาะลูกค้าที่แก้หลังเวลา since
export async function loadCustomersSince(client, since) {
  const a = await selectAll((x, y) => client.from('punpang_customers').select('id,name,phone,note,data,updated_at').gte('updated_at', since).order('updated_at').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToCustomer) }
}
export async function loadCustomersByIds(client, ids) {
  const r = await client.from('punpang_customers').select('id,name,phone,note,data,updated_at').in('id', ids)
  if (r.error) return { error: r.error.message }
  return { items: (r.data || []).map(rowToCustomer) }
}
export async function startCustomersSync({ client, db, canWrite, onError, debounceMs }) {
  const known = new Set()
  const lazy = await lazyWanted(client)
  customerScale.lazy = lazy
  countCustomers(client).then((n) => { customerScale.count = n }, () => {})
  let started = false // รอบแรกไม่ส่ง keepIds (ในเครื่องยังเป็นข้อมูลตัวอย่าง)
  const h = await startSync({
    list: () => db.customers,
    replace: (items) => { fillArray(db.customers, items); known.clear(); for (const i of items) known.add(i.id) },
    load: () => (lazy ? loadCustomersLazy(client, started ? db.customers.map((c) => c.id) : []) : loadCustomers(client)),
    loadSince: (since) => loadCustomersSince(client, since),
    applyRows: (rows) => { for (const i of rows) known.add(i.id) },
    loadByIds: (ids) => loadCustomersByIds(client, ids),
    push: (changes) => pushCustomers(client, changes, { known }),
    canWrite, onError, debounceMs, label: 'ลูกค้า', poll: true,
  })
  started = true
  h.lazy = lazy
  return h
}
