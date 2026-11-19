// ทดสอบโหมดโหลดลูกค้าเฉพาะที่ใช้ + ค้นที่เซิร์ฟเวอร์ + เบอร์ซ้ำ · รัน: node src/lib/customersSync.lazy.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCustomersLazy, searchCustomerIds, lazyWanted, pushCustomers, LAZY_RECENT, pageCustomerIds, CUSTOMER_PAGE } from './customersSync.js'

// ตัวสร้างคำสั่งจำลองแบบต่อกัน: จดเงื่อนไขไว้ แล้วกรองข้อมูลในหน่วยความจำ
function fakeClient(tables, { insertError = null } = {}) {
  const calls = []
  const from = (table) => {
    const q = { table, filters: [], lim: null, head: false, count: false, ord: [] }
    const rows = () => {
      let r = [...(tables[table] || [])]
      for (const [op, col, val] of q.filters) {
        const get = (x) => (col.startsWith('data->>') ? x.data?.[col.slice(7)] : x[col])
        if (op === 'eq') r = r.filter((x) => get(x) === val)
        if (op === 'in') r = r.filter((x) => val.includes(get(x)))
        if (op === 'like' || op === 'ilike') { const v = val.replace(/%/g, ''); r = r.filter((x) => String(get(x) ?? '').toLowerCase().includes(v.toLowerCase())) }
        if (op === 'notin') r = r.filter((x) => !val.includes(get(x)))
        if (op === 'notnull') r = r.filter((x) => get(x) != null)
      }
      if (q.ord[0] === 'updated_at desc') r.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      return r
    }
    const api = {
      select(_c, opts) { if (opts?.head) { q.head = true; q.count = true } return api },
      eq(c, v) { q.filters.push(['eq', c, v]); return api },
      in(c, v) { q.filters.push(['in', c, v]); return api },
      like(c, v) { q.filters.push(['like', c, v]); calls.push(['like', c, v]); return api },
      ilike(c, v) { q.filters.push(['ilike', c, v]); calls.push(['ilike', c, v]); return api },
      not(c, op, v) { if (op === 'in') q.filters.push(['notin', c, v.replace(/[()]/g, '').split(',')]); if (op === 'is') q.filters.push(['notnull', c]); return api },
      order(c, o) { q.ord.push(`${c}${o?.ascending === false ? ' desc' : ''}`); return api },
      limit(n) { q.lim = n; return api },
      range(a, b) { return Promise.resolve({ data: rows().slice(a, b + 1), error: null }) },
      insert() { return Promise.resolve({ error: insertError }) },
      then(res, rej) {
        if (q.count) return Promise.resolve({ count: rows().length, error: null }).then(res, rej)
        calls.push(['query', table, q.filters.map((f) => f[0] + ':' + f[1]).join(',')])
        const r = rows()
        return Promise.resolve({ data: q.lim ? r.slice(0, q.lim) : r, error: null }).then(res, rej)
      },
    }
    return api
  }
  return { from, calls }
}
const cust = (n, extra = {}) => ({ id: 'c' + String(n).padStart(5, '0'), name: 'ลูกค้า ' + n, phone: '08' + String(10000000 + n), note: '', data: {}, updated_at: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(), ...extra })

test('โหมดโหลดเฉพาะที่ใช้: ลูกค้าล่าสุด + ลูกค้าของออร์เดอร์ค้าง + ที่ถืออยู่ ไม่โหลดทั้งตาราง', async () => {
  const customers = Array.from({ length: 3000 }, (_, i) => cust(i))
  const orders = [{ id: 'o1', customer_id: 'c00005', status: 'preparing' }, { id: 'o2', customer_id: 'c00007', status: 'delivered' }]
  const c = fakeClient({ punpang_customers: customers, punpang_orders: orders })
  const r = await loadCustomersLazy(c, ['c00010'])
  const ids = new Set(r.items.map((x) => x.id))
  assert.ok(r.items.length <= LAZY_RECENT + 2, `โหลด ${r.items.length} ราย`)
  assert.ok(ids.has('c02999'), 'ลูกค้าที่แก้ล่าสุด')
  assert.ok(ids.has('c00005'), 'ลูกค้าของออร์เดอร์ที่ยังไม่ปิด')
  assert.ok(!ids.has('c00007'), 'ออร์เดอร์ที่ปิดแล้วไม่ดึงลูกค้า')
  assert.ok(ids.has('c00010'), 'ลูกค้าที่เครื่องถืออยู่ไม่หาย')
})

test('ค้นที่เซิร์ฟเวอร์: เบอร์ / รหัสสมาชิก / ชื่อ / คำสั้นเกินไป', async () => {
  const c = fakeClient({ punpang_customers: [cust(1), cust(2, { data: { scanCode: '0123456789abcdef0123456789abcdef' } })] })
  assert.deepEqual((await searchCustomerIds(c, '081 000 0001')).ids, ['c00001'])
  assert.deepEqual((await searchCustomerIds(c, '0123456789ABCDEF0123456789ABCDEF')).ids, ['c00002'])
  assert.deepEqual((await searchCustomerIds(c, 'ลูกค้า 2')).ids, ['c00002'])
  assert.deepEqual((await searchCustomerIds(c, 'ก')).ids, [])
  assert.ok(c.calls.some((x) => x[0] === 'like' && x[1] === 'phone'))
  assert.ok(c.calls.some((x) => x[0] === 'ilike' && x[1] === 'name'))
})

test('เปิดโหมดได้เฉพาะเมื่อตั้ง shop.customerLazy และเซิร์ฟเวอร์ส่งเตือนตามเวลา', async () => {
  const kv = (lazy, server) => fakeClient({ punpang_kv: [{ collection: 'config', id: 'shop', data: { v: { customerLazy: lazy } } }, { collection: 'config', id: 'scheduled', data: { v: { server } } }] })
  assert.equal(await lazyWanted(kv(true, true)), true)
  assert.equal(await lazyWanted(kv(true, false)), false)
  assert.equal(await lazyWanted(kv(false, true)), false)
})

test('เพิ่มลูกค้าเบอร์ซ้ำกับที่มีในฐานข้อมูล → แจ้งข้อผิดพลาด ไม่แปลงเป็นแก้แถว', async () => {
  const c = fakeClient({}, { insertError: { code: '23505', message: 'duplicate key value violates unique constraint "punpang_customers_phone_digits_uniq"' } })
  const r = await pushCustomers(c, { upserts: [{ id: 'cnew', name: 'ใหม่', phone: '0811111111' }] }, { known: new Set() })
  assert.match(r.error, /เบอร์นี้มีลูกค้าในระบบแล้ว/)
})

test('หน้ารายชื่อลูกค้า: ดึงทีละหน้า (ขนาดคงที่) จนหมด', async () => {
  const c = fakeClient({ punpang_customers: Array.from({ length: 120 }, (_, i) => cust(i)) })
  const a = await pageCustomerIds(c, 0)
  const b = await pageCustomerIds(c, CUSTOMER_PAGE)
  const d = await pageCustomerIds(c, CUSTOMER_PAGE * 2)
  assert.equal(a.ids.length, CUSTOMER_PAGE)
  assert.equal(b.ids.length, CUSTOMER_PAGE)
  assert.equal(d.ids.length, 120 - CUSTOMER_PAGE * 2, 'หน้าสุดท้ายน้อยกว่าขนาดหน้า = หมดแล้ว')
  assert.equal(new Set([...a.ids, ...b.ids, ...d.ids]).size, 120, 'ไม่ซ้ำ ไม่ตกหล่น')
})
