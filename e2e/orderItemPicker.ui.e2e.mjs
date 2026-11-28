// ทดสอบตัวเลือกสินค้าในออร์เดอร์ใหม่: สินค้าสำเร็จเหลือสองคอลัมน์ · ชื่อสินค้าไม่ถูกตัด · แสดงสถานะเลือกแล้ว · ยังไม่เลือกไม่แสดง 0 ฿ · ปุ่มวางรหัสอ่านได้
// ข้อมูลจำลองในหน่วยความจำ · รัน: node e2e/orderItemPicker.ui.e2e.mjs (ต้องมี Chromium ของ Playwright)
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

const cases = []
const t = (name, fn) => cases.push([name, fn])

async function openItemModal(width = 1280, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/orders/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  // ขั้นตอน: เลือกลูกค้า → ถัดไป (นัดรับ) → ถัดไป (สินค้า) แล้วจึงเปิดฟอร์มเพิ่มสินค้า
  await page.getByRole('button', { name: /คุณมะลิ/ }).first().click()
  await page.getByRole('button', { name: 'ถัดไป' }).first().click()
  await page.waitForTimeout(400)
  // นัดรับต้องเป็นวันในอนาคตและเวลาที่ร้านเปิด: เลือกวันสุดท้ายของเดือน (ไม่ผูกกับวันที่รันเทสต์) และเวลา 10:00
  const daySel = page.locator('select[aria-label="วันที่ วัน"]')
  await daySel.selectOption(await daySel.locator('option').last().getAttribute('value'))
  await page.getByRole('button', { name: '10:00', exact: true }).first().click()
  await page.getByRole('button', { name: 'ถัดไป' }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'เพิ่มสินค้า' }).first().click()
  await page.waitForSelector('[data-dialog-body]', { timeout: 15000 })
  return { page, errors }
}

t('สินค้าสำเร็จ: เหลือสองคอลัมน์ (ไม่มีคอลัมน์กลางว่าง)', async () => {
  const { page, errors } = await openItemModal()
  try {
    const n = await page.evaluate(() => document.querySelector('[data-dialog-body]').children.length)
    assert.equal(n, 2, `ต้องมี 2 คอลัมน์ (ซ้าย/ขวา) แต่พบ ${n}`)
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

t('สั่งทำ: ยังมีสามคอลัมน์ (ชั้น/ตัวเลือก)', async () => {
  const { page, errors } = await openItemModal()
  try {
    await page.getByRole('button', { name: 'สั่งทำ', exact: true }).first().click()
    await page.waitForTimeout(300)
    const n = await page.evaluate(() => document.querySelector('[data-dialog-body]').children.length)
    assert.equal(n, 3, `สั่งทำต้องมี 3 คอลัมน์ แต่พบ ${n}`)
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

t('การ์ดสินค้า: ชื่อไม่ถูกตัดจนเหลือตัวอักษรไม่กี่ตัว และสถานะเลือกเปลี่ยนเมื่อกดการ์ด', async () => {
  const { page, errors } = await openItemModal()
  try {
    const card = page.locator('[aria-pressed]').filter({ hasText: /บาท|฿|\d/ }).first()
    await card.waitFor({ timeout: 15000 })
    const r = await card.evaluate((el) => {
      const name = el.querySelector('.line-clamp-2')
      return { cardW: el.clientWidth, nameW: name ? name.clientWidth : 0 }
    })
    assert.ok(r.nameW >= r.cardW * 0.5, `ชื่อสินค้ากว้างน้อยเกินไป: ${r.nameW}/${r.cardW}`)
    await card.click()
    assert.equal(await card.getAttribute('aria-pressed'), 'true')
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

t('ยังไม่เลือกสินค้า: แสดงข้อความแทนราคา 0 ฿', async () => {
  const { page, errors } = await openItemModal()
  try {
    assert.ok(await page.getByText('ยังไม่ได้เลือกสินค้า', { exact: true }).isVisible())
    assert.equal(await page.locator('[role="dialog"]').getByText('0.00 ฿', { exact: true }).count(), 0, 'ใน modal ต้องไม่แสดง 0.00')
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

t('ปุ่มใส่ในฟอร์ม: ตัวอักษรเข้มพอ (ไม่ใช่ชมพูบนชมพู)', async () => {
  const { page, errors } = await openItemModal()
  try {
    const btn = page.getByRole('button', { name: 'ใส่ในฟอร์ม' })
    const cls = await btn.getAttribute('class')
    assert.ok(/btn-outline|btn-primary/.test(cls), `ปุ่มต้องใช้ btn-outline หรือ btn-primary: ${cls}`)
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

let failed = 0
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`) } catch (e) { failed++; console.log(`✗ ${name}\n  ${e.message}`) }
}
await browser.close()
await server.close()
if (failed) { console.log(`✗ ไม่ผ่าน ${failed} รายการ`); process.exit(1) }
console.log(`✓ ผ่านทั้งหมด ${cases.length} รายการ`)
