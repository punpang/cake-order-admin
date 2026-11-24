// ทดสอบช่องวันที่แบบไทย (วัน · เดือน · ปี พ.ศ.) ในฟอร์มโปรโมชัน: ข้อความไม่ถูกตัดและลูกศรไม่ทับตัวอักษร · ที่ 390px และ 1280px
// ข้อมูลจำลองในหน่วยความจำ · รัน: node e2e/thaiDateField.ui.e2e.mjs (ต้องมี Chromium ของ Playwright)
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

async function openPromoForm(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/promos`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.getByRole('button', { name: 'เพิ่มส่วนลด' }).first().click()
  await page.waitForSelector('select[aria-label$="ปี พ.ศ."]', { timeout: 15000 })
  return { page, errors }
}

// ตรวจทุกช่องวัน/เดือน/ปี: เนื้อหาต้องไม่ล้นช่อง และลูกศร (padding ขวา) ต้องเว้นที่ไว้
const CHECK = () => [...document.querySelectorAll('select[aria-label*="วัน"], select[aria-label*="เดือน"], select[aria-label*="ปี พ.ศ."]')].map((el) => {
  const cs = getComputedStyle(el)
  const pr = parseFloat(cs.paddingRight)
  return { label: el.getAttribute('aria-label'), overflow: el.scrollWidth > el.clientWidth + 1, arrowRoom: pr >= 28, width: el.clientWidth }
})

for (const width of [390, 1280]) {
  t(`ช่องวันที่แบบไทย ${width}px: ปี พ.ศ. ไม่ถูกตัด และลูกศรเว้นที่ไว้`, async () => {
    const { page, errors } = await openPromoForm(width)
    try {
      const rows = await page.evaluate(CHECK)
      assert.ok(rows.length >= 6, `ต้องมีช่องวัน/เดือน/ปีอย่างน้อย 6 ช่อง (พบ ${rows.length})`)
      const clipped = rows.filter((r) => r.overflow).map((r) => r.label)
      assert.deepEqual(clipped, [], `ช่องที่ข้อความถูกตัด: ${clipped.join(', ')}`)
      const noRoom = rows.filter((r) => !r.arrowRoom).map((r) => r.label)
      assert.deepEqual(noRoom, [], `ช่องที่ลูกศรทับข้อความ: ${noRoom.join(', ')}`)
      assert.deepEqual(errors, [])
    } finally { await page.context().close() }
  })
}

let failed = 0
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`) } catch (e) { failed++; console.log(`✗ ${name}\n  ${e.message}`) }
}
await browser.close()
await server.close()
if (failed) { console.log(`✗ ไม่ผ่าน ${failed} รายการ`); process.exit(1) }
console.log(`✓ ผ่านทั้งหมด ${cases.length} รายการ`)
