// หน้าออร์เดอร์ของฉันฝั่งลูกค้า (เฟส 3F ส่วนติดตาม) บนแอปจริงที่เชื่อม Supabase: เลขพัสดุ · ยอดคงค้างชำระด้วย QR · ขอคืนสินค้า
// เซิร์ฟเวอร์จำลองตอบ Edge Function 'preorder' ตามรูปแบบของ customerOrderView · ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/preorderOrders.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const TOKEN = 't'.repeat(64)
const state = { status: 'shipped', balanceDue: 0, returnRequested: false, qrCalls: [], returnCalls: [] }
const ORDER = {
  id: 'a'.repeat(32), code: 'PRE-241124-000009', status: 'shipped', campaignId: 'pc1', pickupDate: '2099-12-24',
  total: 130, deposit: { percent: 50, amount: 65 }, payDueAt: null, paid: 100, balanceDue: 30, fulfillment: 'delivery',
  shipping: { carrier: 'Kerry', trackingNo: 'TH-123456', shippedAt: at(1) },
  extensionStatus: null, returnRequestStatus: null, returnDecision: null,
}

const preorder = (b) => {
  switch (b.action) {
    case 'state': return { orders: [{ ...ORDER, status: state.status, balanceDue: state.balanceDue, returnRequestStatus: state.returnRequested ? 'pending' : null }] }
    case 'qr_request': state.qrCalls.push(b); return { ok: true, qrRef: 'PRE241124000001ABCDE', amount: b.amount, payload: '00020101021153037645802TH6304ABCD' }
    case 'return_request': state.returnCalls.push(b); state.returnRequested = true; return { ok: true, already: false }
    default: return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
  }
}

const app = await startApp({ rpc: {}, fn: { preorder } })
const { base, guestPage, close } = app
const p = await guestPage()
const { step: s, finish } = stepper(p)

// ตั้งโทเคนก่อนทุกการโหลดหน้า (ไม่ผ่านการเปลี่ยน hash ที่อาจถูกเราเตอร์เปลี่ยนทาง)
await p.addInitScript((t) => { try { localStorage.setItem('punpang_preorder_session', t) } catch { /* ข้าม */ } }, TOKEN)

await s('1. แสดงเลขพัสดุ และไม่มียอดคงค้างเมื่อชำระครบแล้ว', async () => {
  await p.goto(`${base}/#/preorder/orders`, { waitUntil: 'domcontentloaded' })
  await p.locator('[data-order]').waitFor({ timeout: 30000 })
  assert.match(await p.locator('[data-shipping]').innerText(), /TH-123456/)
  assert.equal(await p.locator('[data-balance]').count(), 0, 'พัสดุที่ส่งแล้วต้องชำระครบ จึงไม่มียอดคงค้าง')
})

await s('2. ตีกลับแล้วจัดส่งใหม่: กดชำระส่วนต่างแล้วได้ QR จากเซิร์ฟเวอร์ (ยอด 30)', async () => {
  state.status = 'returned'
  state.balanceDue = 30
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.locator('[data-balance]').waitFor({ timeout: 15000 })
  await p.getByRole('button', { name: 'ชำระด้วย QR' }).click()
  await p.locator('[data-qr]').waitFor({ timeout: 15000 })
  assert.match(await p.locator('[data-qr]').innerText(), /ยอด 30 บาท/)
  assert.equal(state.qrCalls[0].amount, 30)
})

await s('3. ยังไม่ได้รับพัสดุ จึงไม่มีปุ่มขอคืน', async () => {
  state.status = 'shipped'
  state.balanceDue = 0
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.locator('[data-order]').waitFor({ timeout: 15000 })
  assert.equal(await p.locator('[data-return]').count(), 0)
})

await s('4. ได้รับพัสดุแล้วไม่มีปุ่มขอคืนและไม่มีข้อความว่าขอคืนได้', async () => {
  state.status = 'delivered'
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.locator('[data-order]').first().waitFor({ timeout: 15000 })
  assert.equal(await p.locator('[data-return]').count(), 0)
  assert.equal(await p.getByRole('button', { name: 'ขอคืนสินค้า' }).count(), 0)
  assert.doesNotMatch(await p.locator('body').innerText(), /ขอคืน|รอร้านตรวจสอบคำขอคืน/)
  assert.equal(state.returnCalls.length, 0)
})

const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
