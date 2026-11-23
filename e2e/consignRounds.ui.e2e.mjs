// ทดสอบหน้าสรุปยอดฝากขาย (หน้าสินค้า) ด้วยเบราว์เซอร์จริง
//   (1) เลือกผู้ฝากขาย + ช่วงวันที่ → สรุปรอบ → แสดงยอดขาย/ยอดจ่าย/ส่วนร้านถูกต้อง
//   (2) สรุปช่วงเดิมซ้ำ → แสดงข้อความว่าทับกัน (ไม่สร้างรอบซ้ำ)
//   (3) ยืนยันจ่ายแล้ว → แสดงสถานะจ่ายแล้ว (ล็อก)
// ข้อมูลจำลอง: ออร์เดอร์ส่งมอบแล้ว 2 ชิ้น × 200 บาท · ส่วนแบ่ง 30% → ยอดขาย 400 · จ่าย 120 · ร้านได้ 280
// รัน: node e2e/consignRounds.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/retail`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => {
    const S = await import('/src/data/store.js')
    window.__store = S
    const item = S.db.retailItems.find((x) => x.id === 'rt3')
    Object.assign(item, { consignment: true, consignorName: 'คุณสมชาย', consignPayout: 'percent', consignPercent: 30, active: true })
    const consign = { name: 'คุณสมชาย', payout: 'percent', percent: 30, fixed: 0 }
    S.db.orders.unshift({
      id: 'e2e_cs1', code: 'E2E-CS1', channel: 'pos', status: 'delivered', customerId: null, createdAt: new Date().toISOString(),
      items: [{ id: 'e2e_i1', kind: 'retail', retailId: 'rt3', name: 'คัพเค้ก', unitPrice: 200, qty: 2, consign, discounts: [] }],
      couponsUsed: [], payments: [], history: [], adjustment: { amount: 0, reason: '' }, vat: null, pointsUsed: null, loyalty: null, shippingFee: 0,
    })
  })
  return { page, errors }
}

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('สรุปรอบ → ยอดขาย 400 · จ่าย 120 · ร้านได้ 280 · ยืนยันจ่ายแล้วล็อกรอบ', async () => {
  const { page, errors } = await open()
  try {
    const panel = page.getByLabel('สรุปยอดฝากขาย')
    await panel.waitFor({ state: 'visible' })
    await panel.getByRole('button', { name: 'สรุปรอบ' }).click()
    const row = page.getByRole('list', { name: 'รอบที่สรุปแล้ว' }).getByRole('listitem').first()
    await row.waitFor({ state: 'visible' })
    const text = await row.innerText()
    assert.match(text, /คุณสมชาย/)
    assert.match(text, /ยอดขาย\s+\S*400/, `ยอดขายไม่ถูก: ${text}`)
    assert.match(text, /จ่าย\s+\S*120/, `ยอดจ่ายไม่ถูก: ${text}`)
    assert.match(text, /ร้านได้\s+\S*280/, `ส่วนร้านไม่ถูก: ${text}`)
    await row.getByRole('button', { name: 'ยืนยันจ่ายแล้ว' }).click()
    await row.getByText('จ่ายแล้ว').waitFor({ state: 'visible' })
    assert.equal(await row.getByRole('button', { name: 'ยืนยันจ่ายแล้ว' }).count(), 0, 'รอบที่จ่ายแล้วต้องไม่มีปุ่มจ่ายอีก')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('สรุปช่วงเดิมซ้ำ → ปฏิเสธว่าทับกัน และไม่สร้างรอบซ้ำ', async () => {
  const { page, errors } = await open()
  try {
    const panel = page.getByLabel('สรุปยอดฝากขาย')
    await panel.waitFor({ state: 'visible' })
    await panel.getByRole('button', { name: 'สรุปรอบ' }).click()
    await page.getByRole('list', { name: 'รอบที่สรุปแล้ว' }).getByRole('listitem').first().waitFor({ state: 'visible' })
    await panel.getByRole('button', { name: 'สรุปรอบ' }).click()
    await panel.getByText('ทับกัน').waitFor({ state: 'visible' })
    const n = await page.evaluate(() => window.__store.db.consignRounds.length)
    assert.equal(n, 1, 'ต้องมีรอบเดียว')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

let fails = 0
for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}\n  ${String(e?.message || e).split('\n').slice(0, 4).join('\n  ')}`) }
}
await browser.close()
await server.close()
console.log(`\nรวม ${cases.length} กรณี · ผ่าน ${cases.length - fails} · ไม่ผ่าน ${fails}`)
process.exitCode = fails ? 1 : 0
