// โหมดรอบเวลาบนจอมือถือ (390×844) แบบอัตโนมัติ: ฟอร์มผู้จัดการ หน้าลูกค้า และตรวจรอบซ้ำถูกปฏิเสธ
// ตรวจไม่มีแนวนอนล้นและองค์ประกอบสำคัญแสดงอยู่ · เซิร์ฟเวอร์จำลอง ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderRoundsMobile.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper } from './_supabaseApp.mjs'

const SLOT = {
  id: 'prm', name: 'เค้กรอบมือถือ', orderFrom: '2026-11-01', orderTo: '2026-12-31', pickupFrom: '2026-12-24', pickupTo: '2026-12-26',
  depositPercent: 50, payDueMin: 120, parcelEnabled: false, shipping: null, deals: [], pickupMode: 'slot',
  rounds: [{ time: '10:00', cap: 5 }, { time: '13:00', cap: 3 }],
  items: [{ retailId: 'rt1', name: 'คัพเค้กวานิลลา', price: 45, dayCap: null }],
}
const preorder = (b) => (b.action === 'campaigns' ? { campaigns: [SLOT] } : { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } })
const adminFn = (b) => (b.action === 'list' ? { orders: [] } : { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } })

const app = await startApp({ rpc: {}, fn: { preorder, 'preorder-admin': adminFn } })
const { base, guestPage, page, close } = app
const { step, finish } = stepper(page)
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

await step('1. ฟอร์มแคมเปญบนมือถือ 390×844 แสดงตัวแก้รอบและไม่มีแนวนอนล้น', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/#/admin/settings/preorders`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
  await page.getByRole('radio', { name: 'เลือกรอบเวลา' }).check()
  await page.locator('[data-rounds-editor]').waitFor({ timeout: 15000 })
  assert.equal(await noOverflow(page), 0)
})

await step('2. รอบเวลาซ้ำถูกปฏิเสธเมื่อบันทึก', async () => {
  const editor = page.locator('[data-rounds-editor]')
  await editor.getByRole('button', { name: '+ เพิ่มรอบ' }).click()
  await editor.getByRole('button', { name: '+ เพิ่มรอบ' }).click()
  const times = editor.locator('input[aria-label="เวลารอบ"]')
  const caps = editor.locator('input[aria-label="จำนวนออร์เดอร์ต่อรอบ"]')
  await times.nth(0).fill('10:00')
  await caps.nth(0).fill('2')
  await times.nth(1).fill('10:00')
  await caps.nth(1).fill('2')
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await page.getByText(/ซ้ำ/).first().waitFor({ timeout: 15000 })
})

await step('3. หน้าลูกค้าบนมือถือ: รายการรอบแสดงครบและไม่มีแนวนอนล้น', async () => {
  const p = await guestPage()
  await p.setViewportSize({ width: 390, height: 844 })
  await p.goto(`${base}/#/preorder`, { waitUntil: 'domcontentloaded' })
  const card = p.locator('li', { hasText: 'เค้กรอบมือถือ' })
  await card.getByRole('button', { name: 'เลือกแคมเปญนี้' }).waitFor({ timeout: 30000 })
  await card.getByRole('button', { name: 'เลือกแคมเปญนี้' }).click()
  const picker = p.locator('[data-round-picker]')
  await picker.waitFor({ timeout: 15000 })
  assert.equal(await picker.getByRole('radio').count(), 2)
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.equal(over, 0)
  await p.close()
})

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
