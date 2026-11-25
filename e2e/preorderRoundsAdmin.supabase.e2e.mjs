// โหมดรอบเวลาฝั่งร้านบนแอปจริงที่เชื่อม Supabase: ฟอร์มแคมเปญตั้งโหมดและรอบได้ · ปุ่มเตรียมเสร็จเฉพาะออเดอร์ที่มีรอบ
// เซิร์ฟเวอร์จำลองตอบ 'preorder-admin' (list) · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderRoundsAdmin.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper } from './_supabaseApp.mjs'

const ROUND_ORDER = { id: 'e'.repeat(32), code: 'PRE-241125-000051', customerName: 'สมชาย', status: 'payment_confirmed', pickupDate: '2099-12-24', fulfillment: 'pickup', total: 100, paid: 100, shippingFee: 0, pendingCash: [], shipping: null, returns: [], returnRequest: null, extensions: [], extensionRequest: null, deposit: { percent: 50, amount: 50 }, payDueAt: null, pickupRound: '13:00', readyAt: null }
const DAY_ORDER = { id: 'f'.repeat(32), code: 'PRE-241125-000052', customerName: 'สมหญิง', status: 'payment_confirmed', pickupDate: '2099-12-24', fulfillment: 'pickup', total: 100, paid: 100, shippingFee: 0, pendingCash: [], shipping: null, returns: [], returnRequest: null, extensions: [], extensionRequest: null, deposit: { percent: 50, amount: 50 }, payDueAt: null, pickupRound: null, readyAt: null }
const state = { orders: [ROUND_ORDER, DAY_ORDER] }
const adminFn = (b) => {
  if (b.action === 'list') return { orders: state.orders }
  if (b.action === 'mark_ready') {
    state.orders = state.orders.map((o) => (o.id === b.orderId ? { ...o, readyAt: '2099-12-24T06:00:00Z' } : o))
    return { ok: true, result: { readyAt: '2099-12-24T06:00:00Z' } }
  }
  return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
}

const app = await startApp({ rpc: {}, fn: { 'preorder-admin': adminFn } })
const { page, go, close, base } = app
const { step, finish } = stepper(page)

await step('1. ฟอร์มสร้างแคมเปญมีโหมดรับสินค้า และเลือกรอบเวลาแล้วเพิ่มรอบได้', async () => {
  await go('/admin/settings/preorders')
  await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
  await page.getByRole('radio', { name: 'เลือกรอบเวลา' }).check()
  const editor = page.locator('[data-rounds-editor]')
  await editor.waitFor({ timeout: 15000 })
  await editor.getByRole('button', { name: '+ เพิ่มรอบ' }).click()
  assert.equal(await editor.locator('input[aria-label="เวลารอบ"]').count(), 1)
  await editor.locator('input[aria-label="เวลารอบ"]').first().fill('10:30')
  await editor.locator('input[aria-label="จำนวนออร์เดอร์ต่อรอบ"]').first().fill('4')
  assert.equal(await editor.locator('input[aria-label="เวลารอบ"]').first().inputValue(), '10:30')
})

await step('2. ออเดอร์ที่มีรอบเห็นปุ่มเตรียมเสร็จ และกดแล้วแสดงว่าเตรียมเสร็จแล้ว', async () => {
  await page.goto(`${base}/#/admin/settings/preorders`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
  const row = page.locator('[data-order-code="PRE-241125-000051"]')
  await row.waitFor({ timeout: 30000 })
  const btn = row.getByRole('button', { name: /เตรียมเสร็จ/ })
  await btn.click()
  await page.getByText('บันทึกว่าเตรียมเสร็จแล้ว').waitFor({ timeout: 15000 })
  assert.equal(await row.getByRole('button', { name: /เตรียมเสร็จ/ }).count(), 0)
})

await step('3. ออเดอร์ที่ไม่มีรอบไม่มีปุ่มเตรียมเสร็จ', async () => {
  const row = page.locator('[data-order-code="PRE-241125-000052"]')
  await row.waitFor({ timeout: 15000 })
  assert.equal(await row.getByRole('button', { name: /เตรียมเสร็จ/ }).count(), 0)
})

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
