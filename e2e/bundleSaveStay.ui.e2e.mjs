// ทดสอบการบันทึกชุดที่มีอยู่แล้ว: ต้องอยู่หน้าแก้ไขเดิม ไม่กลับไปหน้ารายการ · ใช้ข้อมูลจำลองในหน่วยความจำ · รัน: node e2e/bundleSaveStay.ui.e2e.mjs
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
  await page.waitForSelector('[data-bundle-card]', { timeout: 15000 })
  const id = await page.locator('[data-bundle-card]').first().getAttribute('data-bundle-card')
  await page.goto(`${base}/#/admin/settings/bundles/${id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-save]', { timeout: 15000 })
  await page.locator('[data-save]').click()
  await page.waitForTimeout(800)
  assert.ok(page.url().includes(`/admin/settings/bundles/${id}`), 'หลังบันทึกต้องยังอยู่หน้าแก้ไขชุดเดิม')
  assert.ok(await page.locator('[data-save]').isVisible(), 'ปุ่มบันทึกต้องยังแสดงอยู่')
  assert.deepEqual(errors, [])
  console.log('PASS บันทึกชุดที่มีอยู่แล้วโดยไม่ปิดหน้า')
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
