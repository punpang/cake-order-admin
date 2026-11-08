import { startSync, selectAll } from './tableSync'

// ซิงก์ลูกค้า (db.customers) กับ punpang_customers · ข้อมูลทั่วไป/คะแนน/ที่อยู่ ฯลฯ เก็บใน data (jsonb)
// ลูกค้าไม่ถูกลบจริง (ใช้ธง deleted/active) — ตารางไม่มี policy ลบ จึงข้ามการลบ
// หมายเหตุ: PIN/OTP ไม่อยู่ในที่นี้ (จะอยู่ punpang_customer_auth ฝั่งเซิร์ฟเวอร์)
export function customerToRow(c) {
  const { id, name, phone, line, note, ...rest } = c
  return { id, name: String(name ?? ''), phone: phone || null, line: line || null, note: note || null, data: rest }
}
export function rowToCustomer(r) {
  return { ...(r.data || {}), id: r.id, name: r.name, phone: r.phone || '', line: r.line || '', note: r.note || '' }
}
export async function loadCustomers(client) {
  const a = await selectAll((x, y) => client.from('punpang_customers').select('id,name,phone,line,note,data').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToCustomer) }
}
// แถวใหม่ = insert · แถวที่มีแล้ว (known) = update (ห้าม upsert: policy INSERT ต้อง createOrder แต่ UPDATE รับ adjustPoints ด้วย
// → ผู้ที่มีแค่ adjustPoints จะถูกปฏิเสธเพราะ upsert ถูกตรวจฝั่ง INSERT)
export async function pushCustomers(client, { upserts }, { known = new Set() } = {}) {
  const fresh = upserts.filter((c) => !known.has(c.id))
  const old = upserts.filter((c) => known.has(c.id))
  const upd = async (c) => {
    const { id, ...rest } = customerToRow(c)
    const r = await client.from('punpang_customers').update(rest).eq('id', id)
    if (r.error) return { error: r.error.message }
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
  return { ok: true }
}
export function startCustomersSync({ client, db, canWrite, onError, debounceMs }) {
  const known = new Set()
  return startSync({
    list: () => db.customers,
    replace: (items) => { db.customers.splice(0, db.customers.length, ...items); known.clear(); for (const i of items) known.add(i.id) },
    load: () => loadCustomers(client),
    push: (changes) => pushCustomers(client, changes, { known }),
    canWrite, onError, debounceMs, label: 'ลูกค้า', poll: true,
  })
}
