// ช่องกรอกในการ์ดออร์เดอร์สั่งล่วงหน้า: ที่ 768px ช่องที่มี placeholder ยาวต้องกว้างพอให้เห็นข้อความทั้งหมด
// เซิร์ฟเวอร์จำลองตอบ 'preorder-admin' (list) · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderOrderInputs.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper } from './_supabaseApp.mjs'

const base = { fulfillment: 'pickup', total: 500, paid: 250, shippingFee: 0, pendingCash: [], returns: [], returnRequest: null, extensions: [], extensionRequest: null, deposit: { percent: 50, amount: 250 }, payDueAt: null, pickupDate: '2099-12-24', pickupRound: null, readyAt: null, shipping: null, customerName: 'สมชาย' }
const ORDERS = [{ ...base, id: 'a'.repeat(32), code: 'PRE-W1', status: 'awaiting_payment' }]
const adminFn = (b) => (b.action === 'list' ? { orders: ORDERS } : { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } })

const app = await startApp({ rpc: {}, fn: { 'preorder-admin': adminFn } })
const { page, go, close } = app
const { step, finish } = stepper(page)

await step('1. ช่องยอดเงินสดที่ 768px กว้างอย่างน้อย 130px เพื่อให้ placeholder ไม่ถูกตัด', async () => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await go('/admin/preorders')
  await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
  const input = page.locator('[data-order-code="PRE-W1"]').getByLabel('ยอดเงินสด')
  await input.waitFor({ timeout: 30000 })
  const box = await input.boundingBox()
  assert.ok(box.width >= 130, `ความกว้างช่อง ${box.width}px`)
})

await close()
finish()
