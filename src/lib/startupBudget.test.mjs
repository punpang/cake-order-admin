// กันถอยหลัง (ช่วง 6): จำนวนแถวที่แอปพนักงานดึงตอนเปิดระบบ ต้องไม่โตตามขนาดตาราง
// ใช้ตัวโหลดจริง (ordersSync / customersSync / chatSync / shiftsSync / recordsSync / acctSync) กับฐานข้อมูลจำลองขนาดใหญ่
// โหลดผ่าน Vite (ไฟล์ต้นทางใช้ import แบบไม่มีนามสกุล) · รัน: node src/lib/startupBudget.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// ---------- ฐานข้อมูลจำลอง: ตัวสร้างคำสั่งแบบ PostgREST (เฉพาะที่ตัวโหลดใช้) · นับแถวที่ส่งออกต่อตาราง ----------
function fakeDb(tables, rpc = {}) {
  const sent = {}
  const get = (r, col) => (col.startsWith('data->>') ? r.data?.[col.slice(7)] : r[col])
  const from = (table) => {
    const f = []
    let ord = []
    let lim = null
    let head = false
    const run = (a = 0, b = Infinity) => {
      let rows = (tables[table] || []).filter((r) => f.every((x) => x(r)))
      if (ord.length) rows = [...rows].sort((x, y) => { for (const [c, asc] of ord) { const p = String(get(x, c) ?? ''), q = String(get(y, c) ?? ''); if (p !== q) return (p < q ? -1 : 1) * (asc ? 1 : -1) } return 0 })
      if (lim != null) rows = rows.slice(0, lim)
      rows = rows.slice(a, b + 1)
      if (head) return { count: rows.length, data: null, error: null }
      sent[table] = (sent[table] || 0) + rows.length
      return { data: rows, error: null }
    }
    const q = {
      select(_c, o) { if (o?.head) head = true; return q },
      eq(c, v) { f.push((r) => get(r, c) === v); return q },
      neq(c, v) { f.push((r) => get(r, c) !== v); return q },
      in(c, v) { f.push((r) => v.includes(get(r, c))); return q },
      gt(c, v) { f.push((r) => String(get(r, c)) > v); return q },
      gte(c, v) { f.push((r) => String(get(r, c)) >= v); return q },
      lt(c, v) { f.push((r) => String(get(r, c)) < v); return q },
      lte(c, v) { f.push((r) => String(get(r, c)) <= v); return q },
      is(c, v) { f.push((r) => (get(r, c) ?? null) === v); return q },
      not(c, op, v) {
        if (op === 'in') { const set = String(v).replace(/[()]/g, '').split(','); f.push((r) => !set.includes(get(r, c))) }
        if (op === 'is') f.push((r) => get(r, c) != null)
        return q
      },
      order(c, o) { ord.push([c, o?.ascending !== false]); return q },
      limit(n) { lim = n; return q },
      range(a, b) { return Promise.resolve(run(a, b)) },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] || null, error: null }) },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    return q
  }
  return { from, rpc: async (name, args) => ({ data: rpc[name] ? rpc[name](args) : [], error: null }), sent }
}

// ---------- ข้อมูลจำลองขนาดใหญ่ ----------
const N = { orders: 50000, openEvery: 50, customers: 30000, chats: 3000, quotes: 5000, quoteOpenEvery: 50, shifts: 1500, entries: 20000 }
const iso = (d) => new Date(Date.UTC(2020, 0, 1) + d * 86400e3).toISOString()
const day = (d) => iso(d).slice(0, 10)
function bigData() {
  const customers = Array.from({ length: N.customers }, (_, i) => ({ id: `c${String(i).padStart(6, '0')}`, name: `ลูกค้า ${i}`, phone: `08${String(10000000 + i)}`, note: '', data: {}, updated_at: iso(i % 2500) }))
  const orders = Array.from({ length: N.orders }, (_, i) => ({ id: `o${String(i).padStart(6, '0')}`, code: `OR-${i}`, customer_id: customers[i % N.customers].id, status: i % N.openEvery === 0 ? 'preparing' : 'delivered', fulfillment: 'pickup', channel: null, data: { createdAt: iso(i % 2500), items: [], payments: [] }, updated_at: iso(i % 2500) }))
  const chats = Array.from({ length: N.chats }, (_, i) => ({ id: `ch${i}`, channel: 'facebook', external_id: `p${i}`, customer_id: null, data: { messages: [] }, updated_at: iso(i) }))
  const quotes = Array.from({ length: N.quotes }, (_, i) => ({ id: `q${i}`, code: `QT-${i}`, chat_id: `ch${i % N.chats}`, customer_id: null, status: i % N.quoteOpenEvery === 0 ? 'pending' : 'accepted', order_id: null, data: { createdAt: iso(i) }, updated_at: iso(i) }))
  const shifts = Array.from({ length: N.shifts }, (_, i) => ({ id: `s${i}`, opened_at: iso(i), closed_at: i === N.shifts - 1 ? null : iso(i), data: {}, updated_at: iso(i) }))
  const recs = (collection, n) => Array.from({ length: n }, (_, i) => ({ collection, id: `${collection}${i}`, data: {}, created_at: iso(i % 2500) }))
  const records = [...recs('bell', 5000), ...recs('outbox', 3000), ...recs('spinLog', 4000), ...recs('luckyTokens', 6000)]
  const entries = Array.from({ length: N.entries }, (_, i) => ({ id: `e${i}`, no: `JV-${i}`, entry_date: day(Math.floor((i / N.entries) * 2500)), data: { lines: [] }, created_at: iso(i % 2500) }))
  return { punpang_customers: customers, punpang_orders: orders, punpang_chats: chats, punpang_quotes: quotes, punpang_shifts: shifts, punpang_records: records, punpang_acct_entries: entries, punpang_acct_frozen: entries.slice(0, 5000).map((e) => ({ ...e, id: 'f' + e.id })) }
}

let vite
const load = (p) => vite.ssrLoadModule(p)
test.before(async () => { vite = await createServer({ root: ROOT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' }) })
test.after(async () => { await vite?.close() })

test('ออร์เดอร์: โหลดเฉพาะที่ยังไม่ปิด (ไม่ใช่ทั้ง 50,000 แถว)', async () => {
  const { loadOrders } = await load('/src/lib/ordersSync.js')
  const db = fakeDb(bigData())
  const r = await loadOrders(db)
  assert.equal(r.items.length, N.orders / N.openEvery)
  assert.equal(db.sent.punpang_orders, N.orders / N.openEvery)
})

test('ลูกค้า (โหมดโหลดเฉพาะที่ใช้): ≤ 500 รายล่าสุด + ลูกค้าของออร์เดอร์ค้าง', async () => {
  const { loadCustomersLazy, LAZY_RECENT } = await load('/src/lib/customersSync.js')
  const data = bigData()
  const db = fakeDb(data)
  const r = await loadCustomersLazy(db, [])
  const openCustomers = new Set(data.punpang_orders.filter((o) => o.status !== 'delivered').map((o) => o.customer_id)).size
  assert.ok(r.items.length <= LAZY_RECENT + openCustomers, `${r.items.length} ราย`)
  assert.ok(db.sent.punpang_customers < N.customers / 10, `ส่ง ${db.sent.punpang_customers} แถวจาก ${N.customers}`)
})

test('แชท ≤ 150 · ใบเสนอเฉพาะของแชทที่โหลด + ที่ยังต้องดำเนินการ', async () => {
  const { loadChats, loadQuotesFor, RECENT_CHATS } = await load('/src/lib/chatSync.js')
  const data = bigData()
  const db = fakeDb(data)
  const c = await loadChats(db, [])
  assert.ok(c.items.length <= RECENT_CHATS)
  const q = await loadQuotesFor(db, c.items.map((x) => x.id))
  const open = data.punpang_quotes.filter((x) => x.status === 'pending').length
  const ofLoaded = data.punpang_quotes.filter((x) => c.items.some((ch) => ch.id === x.chat_id)).length
  assert.ok(q.items.length <= open + ofLoaded, `${q.items.length} ใบ`)
  assert.ok(db.sent.punpang_quotes < N.quotes / 4, `ส่ง ${db.sent.punpang_quotes} แถวจาก ${N.quotes}`)
})

test('กะ POS: กะที่เปิดอยู่ + 60 กะล่าสุด', async () => {
  const { loadShifts, RECENT_SHIFTS } = await load('/src/lib/shiftsSync.js')
  const db = fakeDb(bigData())
  const r = await loadShifts(db)
  assert.ok(r.items.length <= RECENT_SHIFTS + 1)
})

test('records ที่มีเพดาน ไม่เกินเพดาน', async () => {
  const { loadRecords, RECORD_SPECS } = await load('/src/lib/recordsSync.js')
  const db = fakeDb(bigData())
  for (const name of ['bell', 'outbox', 'spinLog', 'luckyTokens']) {
    const spec = RECORD_SPECS[name]
    assert.ok(spec.limit, `${name} ต้องมีเพดาน`)
    const r = await loadRecords(db, name, spec)
    assert.ok(r.items.length <= spec.limit, `${name}: ${r.items.length} > ${spec.limit}`)
  }
})

test('บัญชี: ปิดงวดแล้ว → โหลดเฉพาะรายการหลังจุดตัด (ไม่ใช่ทั้ง 20,000 รายการ)', async () => {
  const { loadAll, acctCutOf } = await load('/src/lib/acctSync.js')
  const db = fakeDb(bigData())
  const cut = acctCutOf('2025-06-30', new Date('2026-11-19T00:00:00Z'))
  assert.equal(cut, '2024-12-31')
  const r = await loadAll(db, 'punpang_acct_entries', 'id,no,data,created_at', 'created_at', (q) => q.gt('entry_date', cut))
  const after = bigData().punpang_acct_entries.filter((e) => e.entry_date > cut).length
  assert.equal(r.rows.length, after)
  assert.ok(after < N.entries / 2)
})

test('รวมตอนเปิดระบบ (โหมดโหลดเฉพาะที่ใช้): ต่ำกว่า 5% ของข้อมูลทั้งหมด', async () => {
  const [{ loadOrders }, { loadCustomersLazy }, { loadChats, loadQuotesFor }, { loadShifts }] = await Promise.all(['/src/lib/ordersSync.js', '/src/lib/customersSync.js', '/src/lib/chatSync.js', '/src/lib/shiftsSync.js'].map(load))
  const data = bigData()
  const db = fakeDb(data)
  await loadOrders(db)
  await loadCustomersLazy(db, [])
  const c = await loadChats(db, [])
  await loadQuotesFor(db, c.items.map((x) => x.id))
  await loadShifts(db)
  const total = Object.values(db.sent).reduce((s, n) => s + n, 0)
  const all = ['punpang_orders', 'punpang_customers', 'punpang_chats', 'punpang_quotes', 'punpang_shifts'].reduce((s, t) => s + data[t].length, 0)
  console.log(`เปิดระบบดึง ${total.toLocaleString()} แถว จากทั้งหมด ${all.toLocaleString()} แถว`, db.sent)
  assert.ok(total < all * 0.05, `${total} แถว`)
})
