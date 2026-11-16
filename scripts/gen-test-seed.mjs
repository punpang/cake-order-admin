// สร้างชุดตัวอย่างโหมดทดสอบ (~90 วันย้อนหลัง) จากโค้ดของแอปเอง
// เรียก store.js จริง (createOrder / reportPayment / confirmPayment / setStatus / cancelOrder) ด้วยนาฬิกาจำลอง
// แล้วเขียนผลเป็น migration: supabase/migrations/20261116140000_punpang_test_seed.sql
// รัน: TZ=Asia/Bangkok node scripts/gen-test-seed.mjs  (เครื่องมือสำหรับนักพัฒนา ไม่ทำงานตอนแอปใช้งาน)
import { createServer } from 'vite'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.TZ = 'Asia/Bangkok'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'supabase', 'migrations', '20261116140000_punpang_test_seed.sql')
const DAYS = 90
const TEST_PREFIX = 'TEST-' // เลขเอกสารของโหมดทดสอบ (ตรงกับ TEST_CODE_PREFIX ใน src/lib/testMode.js)

// ---- นาฬิกาจำลอง: new Date() ที่ไม่มีอาร์กิวเมนต์ได้เวลาที่ตั้งไว้ (store ใช้ตรงนี้ทำ createdAt/ประวัติ/เลขที่) ----
const RealDate = Date
const REAL_NOW = new RealDate()
let fake = null
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length === 0 && fake !== null) super(fake); else super(...args) }
  static now() { return fake !== null ? fake : RealDate.now() }
}
const clock = (d) => { fake = d ? d.getTime() : null }
const pad = (n) => String(n).padStart(2, '0')
const wall = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayAt = (offset, h, m = 0) => { const d = new RealDate(REAL_NOW); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d }
const plusMin = (d, minutes) => new RealDate(d.getTime() + minutes * 60000)

// ---- ตัวสุ่มแบบกำหนดผลได้ (mulberry32) ให้สร้างซ้ำได้เหมือนเดิม ----
let rs = 20261116
const rnd = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

const FIRST = ['สมศรี', 'วิชัย', 'นภา', 'ประเสริฐ', 'มาลี', 'อนันต์', 'รัตนา', 'ธนพล', 'กัลยา', 'สุชาติ', 'พิมพ์ใจ', 'ชาญชัย', 'วรรณา', 'ปิยะ']
const LAST = ['มีสุข', 'ใจดี', 'รักษ์ไทย', 'สายสุวรรณ', 'แก้วกัลยา', 'ทองดี']
const MESSAGES = ['HBD แม่', 'สุขสันต์วันเกิด', 'ขอบคุณที่อุดหนุน', 'Happy Birthday', 'ยินดีด้วยนะ']
const METHODS = ['โอนเงิน', 'โอนเงิน', 'เงินสด', 'บัตร']

const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false } })
try {
  const store = await vite.ssrLoadModule('/src/data/store.js')
  const pricing = await vite.ssrLoadModule('/src/lib/pricing.js')
  const { orderToRow } = await vite.ssrLoadModule('/src/lib/ordersSync.js')
  const { customerToRow } = await vite.ssrLoadModule('/src/lib/customersSync.js')
  const { db, createOrder, reportPayment, confirmPayment, setStatus, cancelOrder, addCustomer } = store
  const { orderTotals } = pricing
  // ตัดคีย์ภายในที่ขึ้นต้นด้วย _ (เช่น เวอร์ชันฝั่งหน้าจอ) ออก ให้เหลือเฉพาะข้อมูลที่บันทึกจริง
  const clone = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k.startsWith('_') ? undefined : v)))

  // เริ่มจากศูนย์: ข้อมูลตัวอย่างเดิมของแอป (seed ตอนโหลด store) ไม่ใช่ชุดนี้
  db.orders.splice(0)
  db.customers.splice(0)

  const customers = []
  for (let i = 0; i < 36; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`
    const phone = `08${String(10000000 + i * 104729).slice(-8)}`
    const r = addCustomer({ name, phone, note: '' })
    if (r?.error) throw new Error(`เพิ่มลูกค้าไม่ได้: ${r.error}`)
    customers.push(db.customers[db.customers.length - 1])
  }

  // รายการสินค้า: ใช้รหัสเดียวกับชุดตัวอย่างเดิมของ store.js (รหัสที่รู้ว่าอยู่ในแคตตาล็อกตัวอย่าง)
  const ITEMS = {
    retail: () => {
      const id = pick(['rt8', 'rt9', 'rt10', 'rt11'])
      const p = db.retailItems.find((x) => x.id === id)
      return { kind: 'retail', retailId: id, retailPrice: p?.price ?? 0, sizeId: pick(['s1', 's2']), typeId: pick(['t1', 't2', 't3']), name: p?.name ?? id, qty: between(1, 2), note: '', images: [] }
    },
    custom: () => ({
      kind: 'custom', name: 'เค้กสั่งทำ', qty: 1, note: pick(['', 'ตามรูปตัวอย่าง']), images: [],
      tiers: [{ selections: { g_size: 's2', g_sponge: 'sp2', g_filling: ['f2'], g_type: 't1', g_shape: 'sh3', g_color: 'ชมพูพาสเทล', g_topping: ['tp2'] } }],
      selections: { g_message: pick(MESSAGES), g_extra: ['x2'] },
    }),
  }

  const stats = { orders: 0, cancelled: 0, unpaid: 0, skipped: 0, events: 0 }
  for (let off = -(DAYS - 1); off <= 0; off++) {
    const weekend = [0, 6].includes(dayAt(off, 12).getDay())
    const perDay = weekend ? between(3, 5) : between(2, 4)
    for (let k = 0; k < perDay; k++) {
      const created = dayAt(off, between(9, 19), between(0, 59))
      if (created > REAL_NOW) continue
      const delivery = rnd() < 0.25
      const pickup = dayAt(off + between(0, 6), between(10, 18), pick([0, 30]))
      if (pickup.getTime() < plusMin(created, 480).getTime()) { stats.skipped++; continue } // ต้องมีเวลาเตรียมอย่างน้อย 8 ชม.
      const customer = pick(customers)
      const items = Array.from({ length: between(1, 2) }, () => (rnd() < 0.6 ? ITEMS.retail() : ITEMS.custom()))
      const birthday = rnd() < 0.2 ? { name: pick(['แม่', 'พ่อ', 'เพื่อน']), md: `${pad(pickup.getMonth() + 1)}-${pad(pickup.getDate())}` } : null

      clock(created)
      const o = createOrder({
        customerId: customer.id, pickupAt: wall(pickup), fulfillment: delivery ? 'delivery' : 'pickup',
        items, birthday, notify: false, sms: false,
        ...(delivery ? { address: 'ที่อยู่ตัวอย่าง 99 ถ.ทดสอบ', shippingFee: 50, placeName: '', mapUrl: '', detail: '', distanceKm: '', feeManual: false } : {}),
      })
      if (!o || o.error) { stats.skipped++; continue }
      stats.orders++

      // ยกเลิกก่อนชำระ ~5%
      if (rnd() < 0.05) {
        clock(plusMin(created, 90))
        if (!cancelOrder(o, { reason: 'ลูกค้าขอยกเลิก', refunds: [] })?.error) stats.cancelled++
        continue
      }

      // แจ้งยอดแล้วยืนยันตามเวลา (ทุกเหตุการณ์ต้องไม่เกินเวลาจริงตอนสร้างชุดนี้)
      const takePayment = (reportAt, confirmAt, amount, confirm = true) => {
        if (reportAt > REAL_NOW || amount <= 0) return false
        clock(reportAt)
        const n = o.payments.length
        if (reportPayment(o, { amount, method: pick(METHODS), paidAt: wall(reportAt) })?.error || o.payments.length === n) return false
        stats.events++
        const p = o.payments[o.payments.length - 1]
        if (!confirm || confirmAt > REAL_NOW) return false
        clock(confirmAt)
        confirmPayment(o, p.id, { amount, method: p.method, paidAt: wall(confirmAt) })
        return p.status === 'confirmed'
      }

      const total = orderTotals(o).total
      const depPct = Number(db.shop.depositPercent) || 0
      const firstAmt = depPct > 0 && rnd() < 0.6 ? Math.ceil((total * depPct) / 100) : total
      const t1 = plusMin(created, between(20, 150))
      const t2 = plusMin(t1, between(5, 60))
      const paidFirst = rnd() >= 0.08 // ~8% แจ้งยอดแล้วแต่ยังไม่ยืนยัน
      if (!takePayment(t1, t2, firstAmt, paidFirst)) { stats.unpaid++ }

      // ก่อนวันนัดที่ผ่านไปแล้ว: ชำระส่วนที่เหลือ
      const pickupDone = pickup <= REAL_NOW
      const paidSoFar = orderTotals(o).paid
      if (pickupDone && paidSoFar > 0) {
        const rest = Math.round(orderTotals(o).balance * 100) / 100
        if (rest > 0) takePayment(plusMin(pickup, -120), plusMin(pickup, -100), rest)
      }

      // สถานะตามลำดับ: เฉพาะออร์เดอร์ที่ชำระแล้วและถึงเวลา (ส่งมอบต้องชำระครบ)
      if (paidSoFar > 0) {
        const steps = delivery
          ? [[-240, 'preparing', 'เริ่มเตรียมงาน'], [-120, 'prepared', 'เตรียมเสร็จแล้ว'], [-60, 'ready_to_ship', 'พร้อมจัดส่ง'], [0, 'shipping', 'กำลังจัดส่ง'], [30, 'delivered', 'จัดส่งแล้ว']]
          : [[-240, 'preparing', 'เริ่มเตรียมงาน'], [0, 'delivered', 'ส่งมอบที่ร้านแล้ว']]
        for (const [min, st, text] of steps) {
          const at = plusMin(pickup, min)
          if (at > REAL_NOW || at < plusMin(created, 60)) continue
          if (st === 'delivered' && orderTotals(o).balance > 0.004) break
          clock(at)
          setStatus(o, st, text)
          stats.events++
        }
      }
    }
  }
  clock(null)

  // ---- แปลงเป็นแถวฐานข้อมูลด้วยตัวแปลงเดียวกับที่แอปใช้ตอนซิงก์ ----
  const orderRows = db.orders.map((o) => orderToRow(clone(o)))
  const customerRows = customers.map((c) => customerToRow(clone(c)))

  // ตรวจความถูกต้องด้วยฟังก์ชันคิดยอดจริง: ยอดเป็นตัวเลข ยอดคงค้างตรงคอลัมน์ และส่งมอบแล้วต้องไม่ค้างยอด
  const problems = []
  const seenCodes = new Set()
  for (const r of orderRows) {
    const t = orderTotals(clone(db.orders.find((x) => x.id === r.id)))
    if (!Number.isFinite(t.total) || !Number.isFinite(t.balance)) problems.push(`ยอดไม่ใช่ตัวเลข ${r.code}`)
    if (r.balance !== null && Math.abs(r.balance - t.balance) > 0.01) problems.push(`ยอดคงค้างไม่ตรง ${r.code}`)
    if (r.status === 'delivered' && t.balance > 0.004) problems.push(`ส่งมอบแล้วแต่ยังค้างยอด ${r.code}`)
    if (seenCodes.has(r.code)) problems.push(`เลขซ้ำ ${r.code}`)
    seenCodes.add(r.code)
  }
  if (problems.length) { console.error(problems.slice(0, 20).join('\n')); throw new Error(`ชุดตัวอย่างไม่ผ่านการตรวจ ${problems.length} รายการ`) }

  // ---- ตัวนับเลขเอกสาร: ค่าสูงสุดของแต่ละ (ประเภท, วัน) เพื่อให้เลขใหม่ต่อจากชุดตัวอย่าง ----
  const counters = new Map()
  const bump = (code) => {
    const m = /^(OR|PAY)-(\d{6})-(\d+)$/.exec(String(code || '')) // ก่อนเติม TEST-
    if (!m) return
    const k = `${m[1]}|${m[2]}`
    counters.set(k, Math.max(counters.get(k) || 0, Number(m[3])))
  }
  for (const r of orderRows) {
    bump(r.code)
    for (const p of r.data.payments || []) bump(p.code)
  }
  for (const r of orderRows) {
    r.code = TEST_PREFIX + r.code
    for (const p of r.data.payments || []) if (p.code) p.code = TEST_PREFIX + p.code
  }

  const doc = {
    anchor: ymd(REAL_NOW), // วันที่สร้างชุดนี้: ตอนรีเซ็ต ฐานข้อมูลเลื่อนวันทั้งหมดตามวันที่จริงของวันนั้น
    customers: customerRows,
    orders: orderRows.map((r) => ({ id: r.id, code: r.code, customer_id: r.customer_id, status: r.status, fulfillment: r.fulfillment, channel: r.channel, pickup_at: r.pickup_at, balance: r.balance, data: r.data })),
    counters: [...counters].map(([k, last]) => { const [prefix, day] = k.split('|'); return { prefix, day, last } }),
  }
  const json = JSON.stringify(doc)
  if (json.includes('$seed$')) throw new Error('ข้อมูลมีตัวคั่น $seed$')

  const byStatus = {}
  for (const r of orderRows) byStatus[r.status] = (byStatus[r.status] || 0) + 1
  writeFileSync(OUT, sqlFile(json))
  console.log(`customers ${customerRows.length} · orders ${orderRows.length} · cancelled ${stats.cancelled} · unpaid ${stats.unpaid} · skipped ${stats.skipped} · events ${stats.events}`)
  console.log('statuses', JSON.stringify(byStatus))
  console.log(`anchor ${doc.anchor} · json ${(json.length / 1024).toFixed(0)} KB · wrote ${OUT}`)
} finally {
  await vite.close()
}

// ---- ไฟล์ migration: ฟังก์ชันเลื่อนวัน + ฟังก์ชันใส่ชุดตัวอย่าง (ข้อมูล JSON อยู่ในฟังก์ชัน) ----
function sqlFile(json) {
  return `-- ชุดตัวอย่างโหมดทดสอบ ~90 วัน (สร้างโดย scripts/gen-test-seed.mjs · ห้ามแก้ด้วยมือ ให้รันสคริปต์ใหม่)
-- ใช้เฉพาะหลังล้างข้อมูลทดสอบ (punpang_reset_test_data) · ข้อมูลในไฟล์นี้เป็นข้อมูลสมมติทั้งหมด ไม่มีข้อมูลลูกค้าจริง
-- วันที่ทุกค่าเลื่อนตามวันที่รีเซ็ต (anchor = วันที่สร้างชุดนี้) เลขเอกสารคงลำดับเดิมในแต่ละวัน

-- เลื่อนวันที่ (YYYY-MM-DD ต้นสตริง) และวันในเลขเอกสาร (ddmmyy) ทุกค่าในเอกสาร jsonb ไปอีก n วัน
create or replace function punpang_test.punpang_test_shift(j jsonb, n int) returns jsonb
language plpgsql stable set search_path = '' as $fn$
declare
  r record;
  acc jsonb;
  s text;
  m text[];
begin
  if jsonb_typeof(j) = 'object' then
    acc := '{}'::jsonb;
    for r in select key, value from jsonb_each(j) loop
      acc := acc || jsonb_build_object(r.key, punpang_test.punpang_test_shift(r.value, n));
    end loop;
    return acc;
  elsif jsonb_typeof(j) = 'array' then
    select coalesce(jsonb_agg(punpang_test.punpang_test_shift(e.v, n) order by e.i), '[]'::jsonb)
      into acc from jsonb_array_elements(j) with ordinality as e(v, i);
    return acc;
  elsif jsonb_typeof(j) = 'string' then
    s := j #>> '{}';
    if s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
      return to_jsonb(to_char(substr(s, 1, 10)::date + n, 'YYYY-MM-DD') || substr(s, 11));
    end if;
    m := regexp_match(s, '^(TEST-)?(OR|POS|QT|PAY)-([0-9]{6})-([0-9]+)$');
    if m is not null then
      return to_jsonb(coalesce(m[1], '') || m[2] || '-' || to_char(to_date(m[3], 'DDMMYY') + n, 'DDMMYY') || '-' || m[4]);
    end if;
    return j;
  end if;
  return j;
end $fn$;

revoke all on function punpang_test.punpang_test_shift(jsonb, int) from public, anon, authenticated;

-- ใส่ชุดตัวอย่าง: คืนจำนวนแถวที่ใส่ทั้งหมด
create or replace function punpang_test.punpang_test_seed() returns int
language plpgsql security definer set search_path = '' as $fn$
declare
  s jsonb := $seed$${json}$seed$::jsonb;
  n int;
  k int;
  total int := 0;
begin
  n := current_date - (s->>'anchor')::date;

  insert into punpang_test.punpang_customers (id, name, phone, note, data)
    select c->>'id', c->>'name', nullif(c->>'phone', ''), nullif(c->>'note', ''), punpang_test.punpang_test_shift(c->'data', n)
    from jsonb_array_elements(s->'customers') as c;
  get diagnostics k = row_count;
  total := total + k;

  insert into punpang_test.punpang_orders (id, code, customer_id, status, fulfillment, channel, pickup_at, balance, data, created_at)
    select o->>'id',
           punpang_test.punpang_test_shift(to_jsonb(o->>'code'), n) #>> '{}',
           nullif(o->>'customer_id', ''),
           o->>'status',
           o->>'fulfillment',
           nullif(o->>'channel', ''),
           nullif(punpang_test.punpang_test_shift(to_jsonb(o->>'pickup_at'), n) #>> '{}', '')::timestamptz,
           nullif(o->>'balance', '')::numeric,
           punpang_test.punpang_test_shift(o->'data', n),
           (punpang_test.punpang_test_shift(to_jsonb(o->'data'->>'createdAt'), n) #>> '{}')::timestamptz
    from jsonb_array_elements(s->'orders') as o;
  get diagnostics k = row_count;
  total := total + k;

  insert into punpang_test.punpang_counters (prefix, day, last)
    select c->>'prefix', to_char(to_date(c->>'day', 'DDMMYY') + n, 'DDMMYY'), (c->>'last')::int
    from jsonb_array_elements(s->'counters') as c;
  get diagnostics k = row_count;
  total := total + k;

  return total;
end $fn$;

revoke all on function punpang_test.punpang_test_seed() from public, anon, authenticated;
`
}
