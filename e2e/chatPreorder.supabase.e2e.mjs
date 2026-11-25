// แผงสั่งล่วงหน้าในหน้าแชทบนแอปจริงที่เชื่อม Supabase: ลูกค้าที่ผูกแล้วเห็นออร์เดอร์สั่งล่วงหน้าของตนเองเท่านั้น
// เซิร์ฟเวอร์จำลองตอบ 'preorder-admin' (customerOrders) กรองตามรหัสลูกค้าเหมือนฝั่งจริง · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/chatPreorder.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const log = []
const PRE = {
  cust1: [{ id: 'p1', code: 'PRE-241125-000041', status: 'awaiting_payment', pickupDate: '2099-12-24', due: 70, payDueAt: '2099-12-01T10:00:00Z' }],
  cust2: [],
}
const adminFn = (b) => {
  log.push(b)
  if (b.action === 'list') return { orders: [] }
  if (b.action === 'customerOrders') return { ok: true, data: PRE[b.customerId] ?? [] }
  return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
}

const app = await startApp({
  tables: {
    punpang_customers: [
      { id: 'cust1', name: 'สมชาย', phone: '0812345678', data: {} },
      { id: 'cust2', name: 'สมหญิง', phone: '0898765432', data: {} },
    ],
    punpang_chats: [
      { id: 'chat1', channel: 'line', external_id: 'L1', customer_id: 'cust1', data: { messages: [], name: 'สมชาย', updatedAt: at(0) }, updated_at: at(0) },
      { id: 'chat2', channel: 'line', external_id: 'L2', customer_id: 'cust2', data: { messages: [], name: 'สมหญิง', updatedAt: at(1) }, updated_at: at(1) },
    ],
  },
  rpc: {},
  fn: { 'preorder-admin': adminFn },
})
const { page, go, close } = app
const { step, finish } = stepper(page)

async function openChat(id) {
  await go(`/admin/chat/${id}`)
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
}

await step('1. ลูกค้าที่ผูกแล้วเห็นออร์เดอร์สั่งล่วงหน้าของตนเองในแผงข้อมูลลูกค้า', async () => {
  await openChat('chat1')
  await page.getByRole('button', { name: /ข้อมูลลูกค้า สมชาย/ }).click()
  const panel = page.locator('[data-chat-preorders]')
  await panel.waitFor({ timeout: 30000 })
  await page.locator('[data-chat-preorder]').first().waitFor({ timeout: 15000 })
  const text = await panel.innerText()
  assert.match(text, /PRE-241125-000041/)
  assert.match(text, /ค้าง 70 บาท/)
  const calls = log.filter((b) => b.action === 'customerOrders')
  assert.equal(calls.length >= 1, true)
  assert.equal(calls.every((b) => b.customerId === 'cust1'), true)
})

await step('2. ลูกค้าที่ไม่มีออร์เดอร์สั่งล่วงหน้า แสดงข้อความว่าง และไม่เห็นของคนอื่น', async () => {
  log.length = 0
  await openChat('chat2')
  await page.getByRole('button', { name: /ข้อมูลลูกค้า สมหญิง/ }).click()
  const panel = page.locator('[data-chat-preorders]')
  await panel.waitFor({ timeout: 15000 })
  await page.getByText('ไม่มีออร์เดอร์สั่งล่วงหน้าที่ยังไม่ปิด').waitFor({ timeout: 15000 })
  assert.doesNotMatch(await panel.innerText(), /PRE-241125-000041/)
  assert.equal(log.filter((b) => b.action === 'customerOrders').every((b) => b.customerId === 'cust2'), true)
})

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
