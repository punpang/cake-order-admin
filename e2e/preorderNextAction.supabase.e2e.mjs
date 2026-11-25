// ปุ่มขั้นถัดไปของออร์เดอร์สั่งล่วงหน้า: ทุกออร์เดอร์แสดงปุ่มหลักหนึ่งปุ่มบนสุด · ปุ่มอื่นซ่อนจนกด "ตัวเลือกเพิ่มเติม" · บนมือถือ 390px กดได้สูงอย่างน้อย 44px
// เซิร์ฟเวอร์จำลองตอบ 'preorder-admin' (list) · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderNextAction.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper } from './_supabaseApp.mjs'

const base = { fulfillment: 'pickup', total: 100, paid: 50, shippingFee: 0, pendingCash: [], returns: [], returnRequest: null, extensions: [], extensionRequest: null, deposit: { percent: 50, amount: 50 }, payDueAt: null, pickupDate: '2099-12-24', pickupRound: null, readyAt: null, shipping: null }
const ORDERS = [
  { ...base, id: 'a'.repeat(32), code: 'PRE-A', customerName: 'ออร์เดอร์รอชำระ', status: 'awaiting_payment' },
  { ...base, id: 'b'.repeat(32), code: 'PRE-B', customerName: 'ออร์เดอร์รอบเวลา', status: 'payment_confirmed', pickupRound: '13:00' },
  { ...base, id: 'c'.repeat(32), code: 'PRE-C', customerName: 'ออร์เดอร์ส่งแล้ว', status: 'shipped', paid: 100, shipping: { carrier: 'Kerry', trackingNo: 'TH1', shippedAt: '2099-01-01T00:00:00Z' } },
  { ...base, id: 'd'.repeat(32), code: 'PRE-D', customerName: 'ออร์เดอร์หมดเวลา', status: 'expired' },
]
const adminFn = (b) => (b.action === 'list' ? { orders: ORDERS } : { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } })

const app = await startApp({ rpc: {}, fn: { 'preorder-admin': adminFn } })
const { page, go, close } = app
const { step, finish } = stepper(page)

const card = (code) => page.locator(`[data-order-code="${code}"]`)
const action = (code, key) => card(code).locator(`[data-action="${key}"]`)
const toggleIn = (code) => card(code).getByRole('button', { name: /ตัวเลือกเพิ่มเติม/ })

await step('1. ออร์เดอร์ที่มีปุ่มเดียว (รอชำระ) แสดงปุ่มรับเงินสดและไม่มีปุ่มตัวเลือกเพิ่มเติม', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go('/admin/preorders')
  await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
  await card('PRE-A').waitFor({ timeout: 30000 })
  assert.equal(await action('PRE-A', 'cash').isVisible(), true)
  assert.equal(await toggleIn('PRE-A').count(), 0)
})

await step('2. ออร์เดอร์ที่มีรอบเวลา: ปุ่มเตรียมเสร็จขึ้นก่อน ปุ่มรับเงินสดซ่อนจนกด "ตัวเลือกเพิ่มเติม"', async () => {
  assert.equal(await action('PRE-B', 'ready').isVisible(), true)
  assert.equal(await action('PRE-B', 'cash').isVisible(), false)
  const t = toggleIn('PRE-B')
  assert.ok((await t.boundingBox()).height >= 44)
  await t.click()
  assert.equal(await action('PRE-B', 'cash').isVisible(), true)
  assert.equal(await toggleIn('PRE-B').getAttribute('aria-expanded'), 'true')
})

await step('3. ปุ่มหลักขึ้นบนสุดของแต่ละออร์เดอร์: ส่งแล้วเป็นได้รับแล้ว และหมดเวลาเป็นขยายเวลา', async () => {
  assert.equal(await card('PRE-C').locator('[data-action="shipped"]').isVisible(), true)
  assert.equal(await card('PRE-D').locator('[data-action="extend"]').isVisible(), true)
  assert.equal(await action('PRE-D', 'cash').isVisible(), false)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
})

await close()
finish()
