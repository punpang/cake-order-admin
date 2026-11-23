// ทดสอบสินค้าไม่กำหนดราคา (openPrice) บนหน้า POS ด้วยเบราว์เซอร์จริง
//   (1) กดสินค้า → กรอกราคา 150 → ใส่ตะกร้าได้ และราคาในตะกร้าเป็น 150
//   (2) กรอก 0 → ไม่ใส่ตะกร้า แสดงข้อความ "ราคาต้องมากกว่า 0"
// รัน: node e2e/pos-open-price.e2e.mjs
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
  await page.goto(`${base}/#/admin/pos`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => {
    window.__store = await import('/src/data/store.js')
    const r = window.__store.db.retailItems.find((x) => x.id === 'rt3')
    r.openPrice = true
    r.name = 'ของฝากตามราคา'
  })
  await page.getByRole('button', { name: 'ไม่มี', exact: true }).first().click() // ขายแบบไม่มีสมาชิก
  return { page, errors }
}

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('กรอกราคา 150 → ใส่ตะกร้าได้ และราคาในตะกร้าเป็น 150', async () => {
  const { page, errors } = await open()
  try {
    await page.getByRole('button', { name: /ของฝากตามราคา/ }).first().click()
    await page.getByText('ราคาขาย (บาท)').waitFor({ state: 'visible' })
    await page.locator('#open-price-input').fill('150')
    await page.getByRole('button', { name: 'ใส่ตะกร้า', exact: true }).click()
    await page.getByText('ราคาขาย (บาท)').waitFor({ state: 'detached' })
    const cart = await page.evaluate(() => document.body.innerText)
    assert.match(cart, /150(\.00)?/, 'ราคาที่กรอกควรแสดงในตะกร้า')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('กรอก 0 → ไม่ใส่ตะกร้า แสดงข้อความและโมดัลยังเปิดอยู่', async () => {
  const { page, errors } = await open()
  try {
    await page.getByRole('button', { name: /ของฝากตามราคา/ }).first().click()
    await page.getByText('ราคาขาย (บาท)').waitFor({ state: 'visible' })
    await page.locator('#open-price-input').fill('0')
    await page.getByRole('button', { name: 'ใส่ตะกร้า', exact: true }).click()
    await page.getByText('ราคาต้องมากกว่า 0').waitFor({ state: 'visible' })
    assert.ok(await page.getByText('ราคาขาย (บาท)').isVisible(), 'โมดัลควรยังเปิดอยู่')
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
