// หน้าสั่งล่วงหน้าฝั่งร้าน (รายการออร์เดอร์) บนแอปจริงที่เชื่อม Supabase: แสดงรายการ · รับเงินสด · บันทึกเลขพัสดุ · ตัดสินจัดส่งใหม่
// เซิร์ฟเวอร์จำลองตอบ Edge Function 'preorder-admin' ตามรูปแบบของ preorder-admin/index.ts · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderAdmin.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const log = []
const ORDER_PAID = { id: 'e'.repeat(32), code: 'PRE-241124-000009', customerName: 'สมชาย', status: 'payment_confirmed', pickupDate: '2099-12-24', fulfillment: 'delivery', total: 100, paid: 50, shippingFee: 20, pendingCash: [], shipping: null, returns: [], returnRequest: null, extensions: [], extensionRequest: null, deposit: { percent: 50, amount: 50 }, payDueAt: null }
const state = { orders: [ORDER_PAID] }

const adminFn = (b) => {
  log.push(b)
  if (b.action === 'list') return { orders: state.orders }
  if (b.action === 'record_payment') { state.orders[0] = { ...state.orders[0], paid: state.orders[0].paid + Number(b.amount) }; return { ok: true, result: {} } }
  if (b.action === 'set_shipping') { state.orders[0] = { ...state.orders[0], shipping: { carrier: b.carrier, trackingNo: b.trackingNo, shippedAt: at(0) }, status: 'shipped' }; return { ok: true, result: {} } }
  return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
}

const app = await startApp({ rpc: {}, fn: { 'preorder-admin': adminFn } })
const { page, go, close } = app
const { step, finish } = stepper(page)

await step('1. แสดงรายการออร์เดอร์สั่งล่วงหน้าและยอดที่ชำระ', async () => {
    await go('/admin/settings/preorders')
    await page.getByRole('tab', { name: 'ออร์เดอร์' }).click()
    await page.locator('[data-order-code="PRE-241124-000009"]').waitFor({ timeout: 30000 })
    assert.match(await page.locator('[data-order-code="PRE-241124-000009"]').innerText(), /ชำระแล้ว 50/)
  })

  await step('2. รับเงินสดเพิ่มแล้วยอดที่ชำระเปลี่ยน', async () => {
    const row = page.locator('[data-order-code="PRE-241124-000009"]')
    // ออร์เดอร์จัดส่งที่ชำระแล้วขึ้นปุ่มบันทึกการส่งก่อน รับเงินสดอยู่ใต้ "ตัวเลือกเพิ่มเติม"
    await row.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).click()
    await row.getByLabel('ยอดเงินสด').fill('20')
    await row.getByRole('button', { name: 'รับเงินสด' }).click()
    await page.getByText('บันทึกเงินสดแล้ว').waitFor({ timeout: 15000 })
    assert.match(await row.innerText(), /ชำระแล้ว 70/)
    assert.equal(log.find((b) => b.action === 'record_payment').amount, 20)
  })

  await step('3. บันทึกเลขพัสดุเมื่อชำระครบแล้ว', async () => {
    const row = page.locator('[data-order-code="PRE-241124-000009"]')
    await row.getByLabel('ชื่อขนส่ง').fill('Kerry')
    await row.getByLabel('เลขพัสดุ').fill('TH-123456')
    await row.getByRole('button', { name: 'บันทึกการส่ง' }).click()
    await page.getByText('บันทึกเลขพัสดุแล้ว').waitFor({ timeout: 15000 })
    await row.getByText('TH-123456').first().waitFor({ timeout: 15000 })
    assert.match(await row.innerText(), /TH-123456/)
    assert.equal(log.find((b) => b.action === 'set_shipping').trackingNo, 'TH-123456')
  })

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
