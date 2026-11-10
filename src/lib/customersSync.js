import { startSync, selectAll, withVer, casUpdate } from './tableSync'

// ซิงก์ลูกค้า (db.customers) กับ punpang_customers · ข้อมูลทั่วไป/คะแนน/ที่อยู่ ฯลฯ เก็บใน data (jsonb)
// ลูกค้าไม่ถูกลบจริง (ใช้ธง deleted/active) — ตารางไม่มี policy ลบ จึงข้ามการลบ
// หมายเหตุ: PIN/OTP ไม่อยู่ในที่นี้ (จะอยู่ punpang_customer_auth ฝั่งเซิร์ฟเวอร์)
export function customerToRow(c) {
  const { id, name, phone, line, note, ...rest } = c
  return { id, name: String(name ?? ''), phone: phone || null, line: line || null, note: note || null, data: rest }
}
export function rowToCustomer(r) {
  return withVer({ ...(r.data || {}), id: r.id, name: r.name, phone: r.phone || '', line: r.line || '', note: r.note || '' }, r.updated_at)
}
export async function loadCustomers(client) {
  const a = await selectAll((x, y) => client.from('punpang_customers').select('id,name,phone,line,note,data,updated_at').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToCustomer) }
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
    if (r.error && r.error.code === '23505') old.push(...fresh) // มีอยู่แล้วในฐานข้อมูล → แก้แทน
    else if (r.error) return { error: r.error.message }
    else for (const c of fresh) known.add(c.id)
  }
  for (const c of old) { const r = await upd(c); if (r.error) return r }
  return conflicts.length ? { ok: true, conflicts } : { ok: true }
}
export async function loadCustomersByIds(client, ids) {
  const r = await client.from('punpang_customers').select('id,name,phone,line,note,data,updated_at').in('id', ids)
  if (r.error) return { error: r.error.message }
  return { items: (r.data || []).map(rowToCustomer) }
}
export function startCustomersSync({ client, db, canWrite, onError, debounceMs }) {
  const known = new Set()
  return startSync({
    list: () => db.customers,
    replace: (items) => { db.customers.splice(0, db.customers.length, ...items); known.clear(); for (const i of items) known.add(i.id) },
    load: () => loadCustomers(client),
    loadByIds: (ids) => loadCustomersByIds(client, ids),
    push: (changes) => pushCustomers(client, changes, { known }),
    canWrite, onError, debounceMs, label: 'ลูกค้า', poll: true,
  })
}
