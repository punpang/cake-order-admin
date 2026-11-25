// หน้าสั่งล่วงหน้าฝั่งร้าน (/admin/preorders) บนแอปจริงที่เชื่อม Supabase: ใช้ได้บนมือถือ 390px · ปุ่มสูงอย่างน้อย 44px · ตัวกรองออร์เดอร์
// เซิร์ฟเวอร์จำลองตอบ 'preorder-admin' (list) · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderAdminLayout.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper } from './_supabaseApp.mjs'

const base = { customerName: 'สมชาย', pickupDate: '2099-12-24', fulfillment: 'pickup', total: 100, paid: 100, shippingFee: 0, pendingCash: [], returns: [], returnRequest: null, extensions: [], extensionRequest: null, deposit: { percent: 50, amount: 50 }, payDueAt: null, pickupRound: null, readyAt: null }
const ORDERS = [
  { ...base, id: 'a'.repeat(32), code: 'PRE-241125-000061', status: 'payment_confirmed', fulfillment: 'delivery', shipping: null },
  { ...base, id: 'b'.repeat(32), code: 'PRE-241125-000062', customerName: 'สมหญิง', status: 'shipped', shipping: { carrier: 'Kerry', trackingNo: 'TH1', shippedAt: '2099-01-01T00:00:00Z' } },
]
const adminFn = (b) => (b.action === 'list' ? { orders: ORDERS } : { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } })

const app = await startApp({ rpc: {}, fn: { 'preorder-admin': adminFn } })
const { page, go, close } = app
const { step, finish } = stepper(page)

// ความกว้างของเนื้อหาเกินหน้าจอหรือไม่ (เลื่อนแนวนอน)
const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
// ความสูงของปุ่มที่ตรงกับชื่อ (พิกเซล)
const heightOf = async (locator) => (await locator.boundingBox()).height

await step('1. บนมือถือ 390px หน้าแคมเปญไม่เลื่อนแนวนอน และแท็บสูงอย่างน้อย 44px', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go('/admin/preorders')
  await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).waitFor({ timeout: 30000 })
  assert.equal(await overflowX(), 0)
  assert.ok((await heightOf(page.getByRole('tab', { name: 'ออร์เดอร์' }))) >= 44)
  assert.ok((await heightOf(page.getByRole('button', { name: '+ สร้างแคมเปญ' }))) >= 44)
})

await step('2. ตัวกรองออร์เดอร์: เลือกส่งแล้ว แสดงเฉพาะออร์เดอร์ที่ส่งแล้ว และปุ่มกดได้สูงอย่างน้อย 44px', async () => {
  await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
  await page.getByRole('button', { name: /^ทั้งหมด/ }).waitFor({ timeout: 30000 })
  const chip = page.getByRole('button', { name: /^ส่งแล้ว/ })
  assert.ok((await heightOf(chip)) >= 44)
  assert.equal(await page.locator('[data-order-code]').count(), 2)
  await chip.click()
  assert.equal(await page.locator('[data-order-code]').count(), 1)
  assert.equal(await page.locator('[data-order-code="PRE-241125-000062"]').count(), 1)
  assert.equal(await chip.getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: /^ทั้งหมด/ }).click()
  assert.equal(await page.locator('[data-order-code]').count(), 2)
  assert.equal(await overflowX(), 0)
})

await step('3. ฟอร์มสร้างแคมเปญบนมือถือไม่เลื่อนแนวนอน และปุ่มบันทึกสูงอย่างน้อย 44px', async () => {
  await page.getByRole('tab', { name: 'แคมเปญ' }).click()
  await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
  await page.getByLabel('ชื่อแคมเปญ').waitFor({ timeout: 30000 })
  assert.equal(await overflowX(), 0)
  assert.ok((await heightOf(page.getByRole('button', { name: 'บันทึก', exact: true }))) >= 44)
  await page.getByRole('button', { name: 'ปิด', exact: true }).first().click()
})

await step('4. บนจอ 1280px ตารางการส่งทั้งชุดมีส่วนหัวคอลัมน์ให้เห็น', async () => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await go('/admin/preorders')
  await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
  await page.getByRole('button', { name: 'กรอกการส่งทั้งชุด' }).click()
  await page.getByText('เลขพัสดุ', { exact: true }).first().waitFor({ timeout: 30000 })
  assert.equal(await overflowX(), 0)
})

await close()
finish()
