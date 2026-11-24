// ทดสอบช่องหมวดสินค้า (ฟอร์มสินค้า POS): กดเลือกหมวดที่มีอยู่ได้ · พิมพ์หมวดใหม่ได้ · ไม่มีรายการแนะนำของเบราว์เซอร์ทับช่องอื่น
// ข้อมูลจำลองในหน่วยความจำ · รัน: node e2e/retailCategoryPicker.ui.e2e.mjs (ต้องมี Chromium ของ Playwright)
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

async function openRetail() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/retail`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  return { page, errors }
}

t('ฟอร์มสินค้า: กดหมวดที่มีอยู่เพื่อเลือก · ไม่ใช้ datalist · พิมพ์หมวดใหม่ได้', async () => {
  const { page, errors } = await openRetail()
  try {
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).first().click()
    await page.waitForSelector('#retail-cat-new')
    assert.equal(await page.locator('datalist#retail-cats').count(), 0, 'ต้องไม่มี datalist')
    const chips = page.locator('[role="group"][aria-label="เลือกหมวดที่มีอยู่"] button')
    const n = await chips.count()
    if (n > 0) {
      const first = chips.first()
      const label = (await first.innerText()).trim()
      await first.click()
      assert.equal(await page.inputValue('#retail-cat-new'), label)
      assert.equal(await first.getAttribute('aria-pressed'), 'true')
    }
    await page.fill('#retail-cat-new', 'มินิเค้ก')
    assert.equal(await page.inputValue('#retail-cat-new'), 'มินิเค้ก')
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

t('ฟอร์มสินค้า: สวิตช์ในกรอบห่างกันไม่เกิน 8px และความสูงแถวอย่างน้อย 44px (ปุ่มสัมผัส)', async () => {
  const { page, errors } = await openRetail()
  try {
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).first().click()
    await page.waitForSelector('#retail-cat-new')
    const r = await page.evaluate(() => {
      const box = [...document.querySelectorAll('[role="switch"]')].find((b) => b.textContent.includes('แสดงใน POS'))?.parentElement
      const sw = [...box.querySelectorAll(':scope > [role="switch"]')]
      const rows = sw.map((b) => b.getBoundingClientRect())
      const gaps = rows.slice(1).map((r2, i) => Math.round(r2.top - rows[i].bottom))
      return { gaps, heights: rows.map((x) => Math.round(x.height)), first: sw[0]?.textContent.trim() }
    })
    assert.equal(r.first, 'ใช้งาน (ปิด = ไม่แสดงทุกที่)', 'สวิตช์ใช้งานต้องอยู่เป็นแถวแรกในกรอบ')
    assert.ok(r.gaps.length >= 6, 'ต้องมีสวิตช์ในกรอบอย่างน้อย 7 แถว')
    // คู่แรกคั่นด้วยเส้นแบ่ง จึงอนุญาตช่องว่างมากกว่าคู่อื่น
    assert.ok(Math.max(...r.gaps.slice(1)) <= 8, `ช่องว่างระหว่างแถวเกิน 8px: ${r.gaps.join(', ')}`)
    assert.ok(r.gaps[0] <= 24, `ช่องว่างก่อนเส้นแบ่งเกิน 24px: ${r.gaps[0]}`)
    assert.ok(Math.min(...r.heights) >= 44, `แถวสูงต่ำกว่า 44px: ${r.heights.join(', ')}`)
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
