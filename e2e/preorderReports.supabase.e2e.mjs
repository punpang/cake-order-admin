// รายงานสั่งล่วงหน้าบนแอปจริงที่เชื่อม Supabase: แท็บรายงานแสดงใบจัดเตรียมและข้อยกเว้น · ต้องเลือกแคมเปญก่อนดูสรุป
// เซิร์ฟเวอร์จำลองตอบ Edge Function 'preorder-admin' (action reports) ตามรูปแบบที่ตกลงไว้ · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderReports.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper } from './_supabaseApp.mjs'

const log = []
const PREP = [{ pickupDate: '2099-12-24', items: [{ retailId: 'r1', name: 'คัพเค้กวานิลลา', qty: 5 }], orderCount: 2, paidCount: 1, unpaidCount: 1, exceptions: [{ code: 'PRE-241124-000031', reason: 'ไม่มีวันรับ' }] }]
const EXC = [{ code: 'PRE-241124-000032', status: 'cancelled', reason: 'ยกเลิกแล้ว' }]

const adminFn = (b) => {
  log.push(b)
  if (b.action === 'list') return { orders: [] }
  if (b.action === 'reports') {
    if (b.report === 'prep') return { ok: true, data: PREP }
    if (b.report === 'exceptions') return { ok: true, data: EXC }
    return { ok: true, data: [] }
  }
  return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
}

const app = await startApp({ rpc: {}, fn: { 'preorder-admin': adminFn } })
const { page, go, close } = app
const { step, finish } = stepper(page)

await step('1. แท็บรายงานแสดงใบจัดเตรียมตามวันรับ พร้อมจำนวนสินค้าและข้อที่ต้องตรวจ', async () => {
  await go('/admin/settings/preorders')
  await page.getByRole('tab', { name: 'รายงาน' }).click()
  const card = page.locator('[data-prep-day]').first()
  await card.waitFor({ timeout: 30000 })
  const text = await card.innerText()
  assert.match(text, /คัพเค้กวานิลลา/)
  assert.match(text, /5/)
  assert.match(text, /ออร์เดอร์ 2 · ชำระครบ 1 · ค้างชำระ 1/)
  assert.match(text, /PRE-241124-000031/)
  assert.equal(log.find((b) => b.action === 'reports' && b.report === 'prep') !== undefined, true)
})

await step('2. สรุปแคมเปญขอให้เลือกแคมเปญก่อน และไม่ส่งคำขอสรุปเมื่อยังไม่เลือก', async () => {
  log.length = 0
  await page.getByRole('button', { name: 'สรุปแคมเปญ' }).click()
  await page.getByText('เลือกแคมเปญก่อนดูสรุป').waitFor({ timeout: 15000 })
  assert.equal(log.filter((b) => b.action === 'reports' && b.report === 'campaign').length, 0)
})

await step('3. ยกเลิก/หมดเวลา/คืน แสดงรายการพร้อมเหตุผล', async () => {
  await page.getByRole('button', { name: 'ยกเลิก/หมดเวลา/คืน' }).click()
  await page.getByText('PRE-241124-000032').waitFor({ timeout: 15000 })
  assert.match(await page.locator('body').innerText(), /ยกเลิกแล้ว/)
})

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
