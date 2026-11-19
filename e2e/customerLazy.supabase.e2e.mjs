// โหมด "โหลดลูกค้าเฉพาะที่ใช้" บนแอปจริงที่เชื่อม Supabase (เซิร์ฟเวอร์จำลองในเครื่อง · ไม่แตะฐานข้อมูลจริง)
// ครอบคลุมรายการตรวจ 1–9: กล่องแจ้งโหมด · ค้นชื่อ/เบอร์ · โหลดเพิ่ม · สร้างออร์เดอร์ · เปิดออร์เดอร์เก่า · POS · เพิ่มลูกค้า · อัปเดตข้ามเครื่อง
// ข้อจำกัด: ไม่ทดสอบ RLS/Realtime/เครือข่ายจริง (RLS อยู่ใน supabase/tests)
// รัน: node e2e/customerLazy.supabase.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { startSupabaseMock } from './supabaseMock.mjs'
import { ALL_PERMS } from '../src/lib/constants.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const N = 3000
const pad = (i) => String(i).padStart(4, '0')
const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400e3).toISOString()
const FIRST = ['สมชาย', 'สมหญิง', 'วิชัย', 'มาลี', 'ประยุทธ', 'นภา', 'กิตติ', 'อรุณี', 'ธนา', 'ศิริพร']
// ลูกค้า 3,000 ราย: แก้ล่าสุดเรียงจาก c0000 (ใหม่สุด) → c2999 (เก่าสุด) · ลูกค้าเก่าอยู่นอก 500 รายที่โหลดไว้
const customers = Array.from({ length: N }, (_, i) => ({
  id: `c${pad(i)}`, name: `${FIRST[i % 10]} ทดสอบ${pad(i)}`, phone: `08${50000000 + i * 37}`, note: '',
  data: { memberCode: `M${pad(i)}`, points: [], createdAt: at(1000 - i / 4) }, updated_at: at(i / 10 + 1), created_at: at(1000),
}))
const OLD = customers[2900]
const OLD_ID = OLD.id // ลูกค้าเก่า (ไม่ได้โหลดตอนเปิดระบบ)
const OPEN = customers[2500]
const OPEN_ID = OPEN.id // ลูกค้าเก่าที่มีออร์เดอร์ค้าง (ต้องโหลดมาด้วย)
const order = (id, c, status, daysAgo) => ({
  id, code: `OR-${id}`, customer_id: c.id, status, fulfillment: 'pickup', channel: null,
  data: { createdAt: at(daysAgo), pickupAt: at(-2), items: [{ name: 'เค้กส้ม 1 ปอนด์', qty: 1, price: 450 }], payments: [], history: [{ at: at(daysAgo), by: 'พนักงาน', action: 'สร้างออร์เดอร์' }] }, updated_at: at(daysAgo), created_at: at(daysAgo),
})
const kv = (id, v) => ({ collection: 'config', id, data: { v }, updated_at: at(10), created_at: at(10) })

const mock = await startSupabaseMock({
  punpang_staff: [{ user_id: 'u-staff', name: 'พนักงานทดสอบ', role: 'owner', perms: ALL_PERMS, active: true, email: 'staff@test.local' }],
  punpang_kv: [kv('shop', { name: 'ร้านทดสอบ', customerLazy: true }), kv('scheduled', { server: true })],
  punpang_customers: customers,
  punpang_orders: [order('o1', OPEN, 'preparing', 3), order('o2', OLD, 'delivered', 400)],
  punpang_acct_state: [{ id: 1, closed_through: null }],
  punpang_items: [{ id: 'rt1', kind: 'retail', name: 'คัพเค้กวานิลลา', price: 45, active: true, data: { stock: 50, category: 'คัพเค้ก' } }],
})
for (const [k, v] of Object.entries({ VITE_USE_SUPABASE: '1', VITE_SUPABASE_URL: mock.url, VITE_SUPABASE_ANON_KEY: 'test-anon-key' })) process.env[k] = v
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(process.env.DEBUG ? e.stack : e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

const results = []
async function step(name, fn) {
  try { await fn(); results.push([true, name]) } catch (e) { results.push([false, name, e.message.split('\n')[0]]); await page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/lazy-fail-${results.length}.png` }).catch(() => {}) }
}
const body = () => page.locator('body').innerText()
const until = (fn, ms = 15000) => page.waitForFunction(fn, null, { timeout: ms })
const sentCustomers = () => mock.log.filter((x) => x.table === 'punpang_customers' && x.method === 'GET').reduce((s, x) => s + x.sent, 0)
const go = async (hash) => {
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  const leave = page.getByRole('button', { name: 'ออกโดยไม่บันทึก' }) // ออกจากหน้าสร้างออร์เดอร์ที่ยังไม่บันทึก
  if (await leave.isVisible().catch(() => false)) await leave.click()
  await page.waitForTimeout(800)
}
const search = async (placeholder, text) => { const i = page.getByPlaceholder(placeholder).first(); await i.fill(''); await i.fill(text) }

try {
  // ค่าตั้งร้านเริ่มต้นของแอป + เปิดโหมด (ค่าที่ไม่ได้ตั้งจะไม่เป็น undefined บนหน้าจอ)
  await page.goto(`${base}/#/admin/login`, { waitUntil: 'domcontentloaded' })
  const shop = await page.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/data/store.js')).db.shop)))
  mock.db.punpang_kv.find((x) => x.id === 'shop').data.v = { ...shop, customerLazy: true }
  await page.getByLabel('อีเมล').fill('staff@test.local')
  await page.getByLabel('รหัสผ่าน').fill('test-password')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await until(() => !location.hash.includes('/admin/login'), 30000)
  await page.waitForTimeout(1500)

  await step('1. หน้าลูกค้าแจ้งโหมด · ไม่โหลดลูกค้าทั้งตาราง', async () => {
    await go('/admin/settings/customers')
    await page.getByText(`ลูกค้าทั้งหมด ${N.toLocaleString()} ราย`).first().waitFor({ timeout: 15000 })
    const sent = sentCustomers()
    assert.ok(sent <= 520, `ส่งลูกค้า ${sent} แถว (ควร ≤ 500 + ลูกค้าของออร์เดอร์ค้าง)`)
    const ids = await page.evaluate(async () => (await import('/src/data/store.js')).db.customers.map((c) => c.id))
    assert.ok(ids.includes(OPEN_ID), 'ลูกค้าของออร์เดอร์ค้างต้องโหลดมาด้วย')
    assert.ok(!ids.includes(OLD_ID), 'ลูกค้าเก่าต้องยังไม่อยู่ในเครื่อง')
  })
  await step('2. ค้นชื่อลูกค้าที่ไม่ได้โหลด → เจอ', async () => {
    await search('ค้นหา ชื่อ / เบอร์', `ทดสอบ${OLD_ID.slice(1)}`)
    await page.getByText(OLD.name).first().waitFor({ timeout: 10000 })
  })
  await step('3. ค้นเบอร์ 4 ตัวท้าย → เจอ', async () => {
    const c = customers[2700]
    await search('ค้นหา ชื่อ / เบอร์', c.phone.slice(-4))
    await page.getByText(c.name).first().waitFor({ timeout: 10000 })
  })
  await step('4. โหลดลูกค้าเพิ่ม (เรียงตามชื่อ) → เพิ่มทีละหน้า', async () => {
    await search('ค้นหา ชื่อ / เบอร์', '')
    // หน้าแรกตามชื่ออาจเป็นลูกค้าที่โหลดไว้แล้วทั้งหมด → กดจนกว่าจะได้ลูกค้าใหม่ (แต่ละครั้งไม่เกิน 50)
    const count = () => page.evaluate(async () => (await import('/src/data/store.js')).db.customers.length)
    const start = await count()
    let prev = start
    for (let i = 0; i < 4 && prev === start; i++) {
      await page.getByRole('button', { name: 'โหลดลูกค้าเพิ่ม (เรียงตามชื่อ)' }).click()
      await page.waitForTimeout(1200)
      const n = await count()
      assert.ok(n - prev <= 50, `ครั้งที่ ${i + 1} เพิ่ม ${n - prev} ราย (เกินหน้าละ 50)`)
      prev = n
    }
    assert.ok(prev > start, `กดแล้วไม่ได้ลูกค้าเพิ่ม (${start} → ${prev})`)
    assert.equal(await page.getByRole('alert').filter({ hasText: /ไม่สำเร็จ|ผิดพลาด/ }).count(), 0)
  })
  await step('5. สร้างออร์เดอร์: ค้นลูกค้าที่ไม่ได้โหลด → เลือกได้', async () => {
    const c = customers[2950]
    await go('/admin/orders/new')
    await search('ค้นหา ชื่อ / เบอร์', c.phone)
    const hit = page.getByText(c.name).first()
    await hit.waitFor({ timeout: 10000 })
    await hit.click()
    await page.waitForTimeout(500)
    assert.ok((await body()).includes(c.name))
  })
  await step('6. เปิดออร์เดอร์เก่าของลูกค้าที่ไม่ได้โหลด → ชื่อ/เบอร์ขึ้น', async () => {
    await go('/admin/orders/o2')
    try { await page.getByText(OLD.name).first().waitFor({ timeout: 15000 }) } catch (e) {
      if (process.env.DEBUG) console.log('DBG', JSON.stringify(mock.log.filter((x) => x.table === 'punpang_orders')), await page.evaluate(async () => { const s = await import('/src/data/store.js'); return [s.db.orders.map((o) => o.id), location.href] }))
      throw e
    }
    await page.waitForTimeout(1500)
    const wrote = mock.log.filter((x) => (x.fn === 'order-create' && x.id === 'o2') || (x.method === 'PATCH' && x.ids?.includes('o2')))
    assert.equal(wrote.length, 0, `เปิดดูอย่างเดียวต้องไม่เขียนออร์เดอร์กลับ: ${JSON.stringify(wrote)}`)
  })
  await step('7. POS: ค้นสมาชิกด้วยเบอร์ → เจอ', async () => {
    const c = customers[2850]
    await go('/admin/pos')
    const open = page.getByRole('button', { name: 'เปิดกะ', exact: true })
    if (await open.count()) { await open.click(); await page.waitForTimeout(800) }
    const box = page.getByLabel('เบอร์สมาชิก')
    await box.waitFor({ timeout: 15000 })
    await box.fill(c.phone)
    await box.press('Enter')
    await page.getByText(c.name).first().waitFor({ timeout: 10000 })
  })
  await step('8. เพิ่มลูกค้าใหม่ → ค้นเจอทันที · เขียนลงเซิร์ฟเวอร์', async () => {
    await go('/admin/settings/customers')
    await page.getByRole('button', { name: 'เพิ่มลูกค้า' }).first().click()
    const dlg = page.getByRole('dialog')
    await dlg.locator('input.input').first().fill('ลูกค้าใหม่ทดสอบ')
    await dlg.locator('input[type="tel"], input[inputmode="tel"]').first().fill('0899998888')
    await dlg.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.waitForTimeout(500)
    await search('ค้นหา ชื่อ / เบอร์', 'ลูกค้าใหม่')
    await page.getByText('ลูกค้าใหม่ทดสอบ').first().waitFor({ timeout: 5000 })
    await page.waitForFunction(() => true, null, { timeout: 100 })
    for (let i = 0; i < 20 && !mock.db.punpang_customers.some((x) => x.name === 'ลูกค้าใหม่ทดสอบ'); i++) await page.waitForTimeout(250)
    assert.ok(mock.db.punpang_customers.some((x) => x.name === 'ลูกค้าใหม่ทดสอบ' && x.phone === '0899998888'), 'แถวต้องถูกเขียนลงเซิร์ฟเวอร์')
  })
  await step('9. อีกเครื่องแก้ชื่อลูกค้า → เครื่องนี้เห็นหลังรีเฟรช', async () => {
    const row = mock.db.punpang_customers.find((x) => x.id === OPEN_ID)
    row.name = 'ชื่อแก้จากอีกเครื่อง'
    row.updated_at = new Date().toISOString()
    await go('/admin/settings/customers')
    await search('ค้นหา ชื่อ / เบอร์', '')
    await page.evaluate(() => window.dispatchEvent(new Event('online'))) // ให้แอปรีเฟรชทันที (แทนรอรอบ 45 วินาที)
    await page.getByText('ชื่อแก้จากอีกเครื่อง').first().waitFor({ timeout: 15000 })
  })
  // ข้อผิดพลาดเครือข่ายที่ตั้งใจ (Realtime ปฏิเสธ · 409 จาก order-create) ไม่นับ · นับ error ของโค้ดในหน้า
  const pageErrors = errors.filter((e) => !/WebSocket connection|Failed to load resource/.test(e))
  if (process.env.DEBUG) console.log('WRITES', JSON.stringify(mock.log.filter((x) => x.method === 'PATCH' || x.fn)))
  results.push([pageErrors.length === 0, 'ไม่มีข้อผิดพลาดในหน้า', pageErrors.slice(0, 3).join(' | ')])
} finally {
  await browser.close(); await server.close(); await mock.close()
}
for (const [ok, name, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${why}`}`)
const bad = results.filter((r) => !r[0]).length
console.log(`\nรวม ${results.length} ข้อ · ผ่าน ${results.length - bad} · ไม่ผ่าน ${bad}`)
process.exit(bad ? 1 : 0)
