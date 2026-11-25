// โหมดรอบเวลาของสั่งล่วงหน้าบนแอปจริงที่เชื่อม Supabase: ลูกค้าเห็นรอบเวลาเฉพาะแคมเปญโหมดรอบ และเลือกรอบได้
// เซิร์ฟเวอร์จำลองตอบ Edge Function 'preorder' (campaigns) เท่านั้น · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderRounds.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper } from './_supabaseApp.mjs'

const SLOT = {
  id: 'prs', name: 'เค้กรอบเวลา', orderFrom: '2026-11-01', orderTo: '2026-12-31', pickupFrom: '2026-12-24', pickupTo: '2026-12-26',
  depositPercent: 50, payDueMin: 120, parcelEnabled: false, shipping: null, deals: [], pickupMode: 'slot',
  rounds: [{ time: '10:00', cap: 5 }, { time: '13:00', cap: 3 }],
  items: [{ retailId: 'rt1', name: 'คัพเค้กวานิลลา', price: 45, dayCap: null }],
}
const DAY = { ...SLOT, id: 'prd', name: 'เค้กรับทั้งวัน', pickupMode: 'day', rounds: [] }

const preorder = (b) => {
  if (b.action === 'campaigns') return { campaigns: [SLOT, DAY] }
  return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
}

const app = await startApp({ rpc: {}, fn: { preorder } })
const { base, guestPage, close } = app
const p = await guestPage()
const { step, finish } = stepper(p)

await step('1. แคมเปญโหมดรอบแสดงรอบเวลาให้เลือก และเลือกรอบอื่นได้', async () => {
  await p.goto(`${base}/#/preorder`, { waitUntil: 'domcontentloaded' })
  const card = p.locator('li', { hasText: 'เค้กรอบเวลา' })
  await card.getByRole('button', { name: 'เลือกแคมเปญนี้' }).waitFor({ timeout: 30000 })
  await card.getByRole('button', { name: 'เลือกแคมเปญนี้' }).click()
  const picker = p.locator('[data-round-picker]')
  await picker.waitFor({ timeout: 15000 })
  const text = await picker.innerText()
  assert.match(text, /รับได้ตั้งแต่ 10:00 ถึงสิ้นวัน/)
  assert.match(text, /รับได้ตั้งแต่ 13:00 ถึงสิ้นวัน/)
  await picker.getByRole('radio', { name: /13:00/ }).check()
  assert.equal(await picker.getByRole('radio', { name: /13:00/ }).isChecked(), true)
})

await step('2. แคมเปญโหมดรับทั้งวันไม่แสดงรอบเวลา', async () => {
  await p.goto(`${base}/#/preorder`, { waitUntil: 'domcontentloaded' })
  await p.reload({ waitUntil: 'domcontentloaded' })
  const card = p.locator('li', { hasText: 'เค้กรับทั้งวัน' })
  await card.getByRole('button', { name: 'เลือกแคมเปญนี้' }).waitFor({ timeout: 30000 })
  await card.getByRole('button', { name: 'เลือกแคมเปญนี้' }).click()
  await p.getByLabel('วันรับสินค้า').waitFor({ timeout: 15000 })
  assert.equal(await p.locator('[data-round-picker]').count(), 0)
})

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
