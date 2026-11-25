// กรอกการส่งสั่งล่วงหน้าทั้งชุดบนแอปจริงที่เชื่อม Supabase: วางเลขพัสดุ จับคู่ตามแถว · เลขซ้ำบันทึกไม่ได้ · บันทึกทีละรายการ
// เซิร์ฟเวอร์จำลองตอบ Edge Function 'preorder-admin' ตามรูปแบบของ preorder-admin/index.ts · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderShipBatch.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const log = []
const ready = (id, code, customerName) => ({ id, code, customerName, status: 'payment_confirmed', pickupDate: '2099-12-24', fulfillment: 'delivery', total: 100, paid: 100, shippingFee: 20, pendingCash: [], shipping: null, returns: [], returnRequest: null, extensions: [], extensionRequest: null, deposit: { percent: 100, amount: 100 }, payDueAt: null })
const state = { orders: [ready('a'.repeat(32), 'PRE-241124-000011', 'สมหญิง'), ready('b'.repeat(32), 'PRE-241124-000012', 'สมชาย')] }

const adminFn = (b) => {
  log.push(b)
  if (b.action === 'list') return { orders: state.orders }
  if (b.action === 'set_shipping') {
    state.orders = state.orders.map((o) => (o.id === b.orderId ? { ...o, status: 'shipped', shipping: { carrier: b.carrier, trackingNo: b.trackingNo, postage: b.postage, shippedAt: at(0) } } : o))
    return { ok: true, result: {} }
  }
  return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
}

const app = await startApp({ rpc: {}, fn: { 'preorder-admin': adminFn } })
const { page, go, close } = app
const { step, finish } = stepper(page)

await step('1. วางเลขพัสดุสองรายการแล้วบันทึกทั้งชุด (ส่งครบทั้งสองออร์เดอร์ ค่าไปรษณีย์ถูกส่งไป)', async () => {
  await go('/admin/settings/preorders')
  await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
  await page.getByRole('button', { name: 'กรอกการส่งทั้งชุด' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'กรอกการส่งทั้งชุด' }).click()
  await page.getByLabel('ชื่อขนส่งทั้งชุด').fill('Kerry')
  await page.getByLabel('วางเลขพัสดุทั้งชุด').fill('TH-000001\nTH-000002')
  await page.getByRole('button', { name: 'จับคู่เลขกับแถว' }).click()
  await page.getByRole('button', { name: 'บันทึก 2 รายการ' }).click()
  await page.getByText(/บันทึกการส่งสำเร็จ 2 รายการ/).waitFor({ timeout: 30000 })
  const calls = log.filter((b) => b.action === 'set_shipping')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((c) => c.trackingNo), ['TH-000001', 'TH-000002'])
  assert.ok(calls.every((c) => c.carrier === 'Kerry' && c.postage === 0))
})

await step('2. เลขซ้ำในชุดเดียวกันบันทึกไม่ได้ และไม่ส่งคำขอไปเซิร์ฟเวอร์', async () => {
  log.length = 0
  state.orders = [ready('c'.repeat(32), 'PRE-241124-000013', 'ทดสอบ'), ready('d'.repeat(32), 'PRE-241124-000014', 'ทดสอบ2')]
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
  await page.locator('[data-order-code="PRE-241124-000013"]').waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'กรอกการส่งทั้งชุด' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'กรอกการส่งทั้งชุด' }).click()
  await page.getByLabel('ชื่อขนส่งทั้งชุด').fill('Kerry')
  await page.getByLabel('วางเลขพัสดุทั้งชุด').fill('TH-000009\nth-000009')
  await page.getByRole('button', { name: 'จับคู่เลขกับแถว' }).click()
  await page.getByRole('button', { name: 'บันทึก 2 รายการ' }).click()
  await page.getByText('กรอกข้อมูลให้ถูกต้องก่อนบันทึก').waitFor({ timeout: 30000 })
  assert.equal(log.filter((b) => b.action === 'set_shipping').length, 0)
})

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
