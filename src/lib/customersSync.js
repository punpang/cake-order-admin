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
export async function pushCustomers(client, { upserts }) {
  if (!upserts.length) return { ok: true }
  const r = await client.from('punpang_customers').upsert(upserts.map(customerToRow))
  return r.error ? { error: r.error.message } : { ok: true }
}
export function startCustomersSync({ client, db, canWrite, onError, debounceMs }) {
  return startSync({
    list: () => db.customers,
    replace: (items) => db.customers.splice(0, db.customers.length, ...items),
    load: () => loadCustomers(client),
    push: (changes) => pushCustomers(client, changes),
    canWrite, onError, debounceMs, label: 'ลูกค้า',
  })
}
