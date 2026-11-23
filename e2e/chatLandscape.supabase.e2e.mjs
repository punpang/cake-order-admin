// หน้าแชทบนจอแนวนอน 1280×800 (เปิดแผงลงออร์เดอร์): รายการแชท 280px · เธรดกว้างพอ · แผงออร์เดอร์ 360px ไม่ทับข้อความ
// เซิร์ฟเวอร์จำลองในเครื่อง · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/chatLandscape.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const CUST = { id: 'c1', name: 'มาลี ทดสอบ', phone: '0850001111', note: '', data: { memberCode: 'M0001', points: [] }, updated_at: at(5), created_at: at(30) }
const MSGS = [
  { id: 'm1', from: 'customer', kind: 'text', text: 'สวัสดีค่ะ อยากสั่งเค้กวันเสาร์ ได้ไหมคะ', at: at(0) },
  { id: 'm2', from: 'staff', kind: 'text', text: 'ได้ค่ะ ต้องการขนาดเท่าไหร่คะ', at: at(0) },
  { id: 'm3', from: 'customer', kind: 'text', text: 'ขนาด 8 นิ้ว ข้อความ "สุขสันต์วันเกิด" ค่ะ', at: at(0) },
]
const CHAT = { id: 'ch1', channel: 'web', external_id: 'U1', customer_id: 'c1', updated_at: at(0), created_at: at(0), data: { name: CUST.name, messages: MSGS, updatedAt: at(0), unread: 0 } }

const app = await startApp({ tables: { punpang_customers: [CUST], punpang_chats: [CHAT] } })
const { page, go, pageErrors, close } = app
const { step, finish } = stepper(page)
const box = async (loc) => {
  await loc.waitFor({ state: 'visible', timeout: 15000 })
  const b = await loc.boundingBox()
  assert.ok(b, 'ต้องมีกรอบแสดงผล')
  return { left: b.x, right: b.x + b.width, width: b.width }
}

try {
  await page.setViewportSize({ width: 1280, height: 800 })
  await go('/admin/chat/ch1')
  const list = page.locator('aside[aria-label="รายการแชท"]')
  const thread = page.locator('section[aria-label^="แชทกับ"]')

  await step('1. เปิดแผงลงออร์เดอร์: รายการแชทกว้าง 280px และแผงออร์เดอร์กว้าง 360px', async () => {
    await page.getByRole('button', { name: 'ลงออร์เดอร์ในแชทนี้' }).click()
    const panel = page.locator('section[aria-label="ลงออร์เดอร์ในแชท"]')
    const l = await box(list)
    const p = await box(panel)
    assert.ok(Math.abs(l.width - 280) <= 2, `รายการแชทต้องกว้าง ~280px ได้ ${l.width}`)
    assert.ok(Math.abs(p.width - 360) <= 2, `แผงออร์เดอร์ต้องกว้าง ~360px ได้ ${p.width}`)
  })

  await step('2. เธรดกว้างอย่างน้อย 480px และไม่ทับแผงออร์เดอร์', async () => {
    const t = await box(thread)
    const p = await box(page.locator('section[aria-label="ลงออร์เดอร์ในแชท"]'))
    assert.ok(t.width >= 480, `เธรดต้องกว้างอย่างน้อย 480px ได้ ${t.width}`)
    assert.ok(t.right <= p.left + 1, 'เธรดต้องไม่ทับแผงออร์เดอร์')
  })

  await step('3. ตัวนำทางขั้นในแผง 360px: ป้ายขั้นปัจจุบันแสดงครบไม่ถูกตัด', async () => {
    const label = page.locator('section[aria-label="ลงออร์เดอร์ในแชท"] ol span.text-brand-700').first()
    await label.waitFor({ state: 'visible', timeout: 15000 })
    const fits = await label.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    assert.ok(fits, 'ป้ายขั้นปัจจุบันต้องไม่ถูกตัดด้วย …')
  })

  await step('4. ไม่มีข้อผิดพลาดของหน้า', async () => {
    assert.deepEqual(pageErrors(), [], 'ต้องไม่มี error ของหน้า')
  })
} finally {
  const bad = finish()
  await close()
  if (bad) process.exitCode = 1
}
