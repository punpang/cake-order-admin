// ทดสอบปุ่มเปิด/ปิดใช้งานชุดในหน้ารายการบันเดิ้ล · ใช้ข้อมูลจำลองในหน่วยความจำเท่านั้น · รัน: node e2e/bundleListToggle.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
let fails = 0
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/bundles`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForSelector('[data-toggle-active]', { timeout: 15000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  const id = await page.locator('[data-toggle-active]').first().getAttribute('data-toggle-active')
  const before = await page.evaluate((x) => window.__store.db.bundles.find((b) => b.id === x)?.active !== false, id)
  await page.locator(`[data-toggle-active="${id}"]`).click()
  await page.waitForTimeout(300)
  const after = await page.evaluate((x) => window.__store.db.bundles.find((b) => b.id === x)?.active !== false, id)
  assert.equal(after, !before, 'สวิตช์ต้องสลับสถานะของชุด')
  assert.deepEqual(errors, [])
  console.log('PASS เปิด/ปิดใช้งานชุดจากหน้ารายการ')
  await page.close()
} catch (e) {
  fails++
  console.log(`FAIL: ${e.message}`)
} finally {
  await browser.close()
  await server.close()
}
console.log(fails ? '1 FAILED' : 'ALL PASS (1)')
process.exit(fails ? 1 : 0)
