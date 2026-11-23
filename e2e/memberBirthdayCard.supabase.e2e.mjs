// การ์ดสมาชิกฝั่งลูกค้า: บรรทัด "ส่วนลดหมวดเค้กเดือนเกิด" ขึ้นเฉพาะเมื่อเข้าเงื่อนไขครบ (โหมดเชื่อม Supabase)
// ใช้คำตอบ customer-auth ที่เทสต์กำหนด (ไม่ใช่การคำนวณจริง · การคำนวณจริงทดสอบใน supabase/tests/member_benefits.test.sql และ birthday_pos.test.sql)
// เปิดเป็นลูกค้า (ไม่ล็อกอินพนักงาน) เพราะการกู้เซสชันลูกค้าทำงานเฉพาะตอนไม่มีพนักงานล็อกอิน
// รัน: node e2e/memberBirthdayCard.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { startSupabaseMock } from './supabaseMock.mjs'
import { stepper, at } from './_supabaseApp.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const cust = { id: 'c1', name: 'มาลี ทดสอบ', phone: '0850001111', note: '', data: { memberCode: 'M0001', points: [] }, updated_at: at(5), created_at: at(30) }
const LINE = 'ส่วนลดหมวดเค้กเดือนเกิด 5% (สูงสุด 25 บาท)'

// เปิดเว็บแบบลูกค้า: เซิร์ฟเวอร์จำลอง + Vite + เบราว์เซอร์ (ไม่ล็อกอินพนักงาน)
async function startCustomerApp(tables, opts = {}) {
  const mock = await startSupabaseMock({ punpang_kv: [{ collection: 'config', id: 'shop', data: { v: {} }, updated_at: at(10), created_at: at(10) }], punpang_customers: [cust], ...tables }, opts)
  for (const [k, v] of Object.entries({ VITE_USE_SUPABASE: '1', VITE_SUPABASE_URL: mock.url, VITE_SUPABASE_ANON_KEY: 'test-anon-key' })) process.env[k] = v
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const pageErrors = () => errors.filter((e) => !/WebSocket connection|Failed to load resource/.test(e))
  const close = async () => { await browser.close(); await server.close(); await mock.close() }
  return { page, base, pageErrors, close }
}

// คำตอบ customer-auth: ระดับ LV3 ใช้งานอยู่ · birth = สิทธิเดือนเกิดที่การ์ดได้รับ
const accountOf = (birth) => () => ({
  ok: true,
  customer: { ...cust.data, id: cust.id, name: cust.name, phone: cust.phone },
  orders: [], coupons: [],
  // ยอมรับเอกสารเวอร์ชันปัจจุบันแล้ว (ไม่ให้ค้างหน้ายอมรับ)
  consents: [{ id: 'cs1', customerId: cust.id, kind: 'privacy', version: 2, at: at(5) }, { id: 'cs2', customerId: cust.id, kind: 'terms', version: 2, at: at(5) }],
  reviews: [], deletionRequests: [],
  tier: { enabled: true, levelNo: 3, levelName: 'LV3', mult: 5, status: 'active', golden: false, birth },
  shop: {},
})
const ELIGIBLE = { eligible: true, active: true, rate: 5, cap: 25, birthMult: 6, cakeSet: true }

const cases = [
  { name: 'เข้าเงื่อนไขครบ → แสดงบรรทัดส่วนลดเค้ก', birth: ELIGIBLE, show: true },
  { name: 'ร้านยังไม่เลือกเค้ก (cakeSet = false) → ไม่แสดงบรรทัด', birth: { ...ELIGIBLE, cakeSet: false }, show: false },
  { name: 'ยังไม่ผ่าน 30 วัน (eligible = false) → ไม่แสดงบรรทัด', birth: { ...ELIGIBLE, eligible: false }, show: false },
]

let fails = 0
for (const c of cases) {
  const app = await startCustomerApp({}, { fn: { 'customer-auth': accountOf(c.birth) } })
  const { page } = app
  const { step, finish } = stepper(page)
  try {
    await step(`${c.name}: กู้เซสชันลูกค้าและเปิดหน้าบัญชี`, async () => {
      await page.evaluate(() => localStorage.setItem('punpang_customer_session', 'a'.repeat(64)))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      await page.goto(`${app.base}/#/account`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      assert.ok(page.url().includes('/account') && !page.url().includes('/login'), `ยังอยู่ที่ ${page.url()}`)
    })
    await step(`${c.name}: ตรวจบรรทัดส่วนลดเค้ก`, async () => {
      // การ์ดระดับอยู่ในแท็บ "คะแนน" ของหน้าบัญชี
      await page.getByRole('button', { name: 'คะแนน', exact: true }).first().click()
      await page.getByText('LV3', { exact: false }).first().waitFor({ timeout: 10000 })
      const n = await page.getByText(LINE, { exact: false }).count()
      if (c.show) assert.ok(n >= 1, `ไม่พบบรรทัด "${LINE}"`)
      else assert.equal(n, 0, 'ไม่ควรแสดงบรรทัดส่วนลดเค้ก')
    })
    await step(`${c.name}: ไม่มีข้อผิดพลาดในหน้า`, async () => assert.deepEqual(app.pageErrors().slice(0, 3), []))
  } finally {
    await app.close()
  }
  fails += finish()
}
process.exit(fails ? 1 : 0)
