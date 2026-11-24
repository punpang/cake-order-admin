// ทดสอบรูปในการ์ดสินค้าหน้า POS (/admin/pos): มีรูปแสดงรูป · ไม่มีรูปแสดงภาพสำรอง · สินค้าหมดสต็อกเป็นสีจาง
// ข้อมูลจำลองในหน่วยความจำ · รัน: node e2e/posProductImage.ui.e2e.mjs
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

// รูปจำลอง 1x1 พิกเซล (PNG) ไม่ต้องโหลดไฟล์จากภายนอก
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function openPos() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/pos`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors }
}

// จัดข้อมูลสินค้าที่แสดงใน POS: รายการแรกมีรูป · รายการที่สองไม่มีรูป · รายการที่สามหมดสต็อก
const seed = (page) => page.evaluate((png) => {
  const items = window.__store.db.retailItems.filter((r) => r.active !== false && r.showInPos !== false && !r.openPrice)
  if (items.length < 3) throw new Error('ข้อมูลจำลองมีสินค้าไม่พอสำหรับเทสต์')
  items[0].images = [png]
  items[1].images = []
  items[2].stock = 0
  return { withImage: items[0].name, noImage: items[1].name, outOfStock: items[2].name }
}, PNG)

// การ์ดของสินค้าตามชื่อ (ปุ่มที่มีชื่อนั้น)
const cardInfo = (page, name) => page.evaluate((name) => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.includes(name) && b.textContent.includes('฿'))
  if (!btn) throw new Error('ไม่พบการ์ด ' + name)
  const img = btn.querySelector('img')
  const fallback = btn.querySelector('[role="img"]')
  const wrap = img?.closest('span.aspect-square') || fallback?.closest('span.aspect-square')
  const box = wrap ? wrap.getBoundingClientRect() : null
  return {
    ratio: box ? box.width / box.height : 0,
    imgBox: img ? (() => { const r = img.getBoundingClientRect(); return { w: r.width, h: r.height } })() : null,
    imgSrc: img?.getAttribute('src') || '',
    hasFallback: !!fallback,
    fallbackLabel: fallback?.getAttribute('aria-label') || '',
    grayscale: !!wrap && wrap.classList.contains('grayscale'),
    text: btn.textContent,
  }
}, name)

t('สินค้าที่มีรูปแสดงรูปในการ์ด · สินค้าที่ไม่มีรูปแสดงภาพสำรอง · ชื่อและราคายังอยู่', async () => {
  const { page, errors } = await openPos()
  try {
    const names = await seed(page)
    await page.waitForTimeout(300)
    const withImg = await cardInfo(page, names.withImage)
    assert.equal(withImg.imgSrc, PNG, 'การ์ดที่มีรูปต้องแสดงรูปนั้น')
    assert.ok(Math.abs(withImg.ratio - 1) < 0.02, `กรอบรูปต้องเป็น 1:1 (ได้ ${withImg.ratio.toFixed(3)})`)
    assert.ok(withImg.imgBox && Math.abs(withImg.imgBox.w - withImg.imgBox.h) < 1, 'รูปต้องเติมเต็มกรอบเป็นจัตุรัส')
    assert.ok(withImg.text.includes(names.withImage), 'ชื่อสินค้ายังต้องอยู่ในการ์ด')
    const noImg = await cardInfo(page, names.noImage)
    assert.equal(noImg.imgSrc, '', 'การ์ดที่ไม่มีรูปต้องไม่มี img')
    assert.equal(noImg.hasFallback, true, 'การ์ดที่ไม่มีรูปต้องแสดงภาพสำรอง')
    assert.equal(noImg.fallbackLabel, names.noImage)
    assert.ok(Math.abs(noImg.ratio - 1) < 0.02, `ภาพสำรองต้องเป็นกรอบ 1:1 (ได้ ${noImg.ratio.toFixed(3)})`)
    assert.ok(noImg.text.includes('฿'), 'ราคายังต้องอยู่ในการ์ด')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('สินค้าหมดสต็อกแสดงรูปแบบจาง (grayscale)', async () => {
  const { page, errors } = await openPos()
  try {
    const names = await seed(page)
    await page.waitForTimeout(300)
    const out = await cardInfo(page, names.outOfStock)
    assert.equal(out.grayscale, true, 'สินค้าหมดสต็อกต้องเป็นสีจาง')
    const inStock = await cardInfo(page, names.withImage)
    assert.equal(inStock.grayscale, false, 'สินค้าที่มีสต็อกต้องไม่จาง')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

let failed = 0
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`) } catch (e) { failed++; console.log(`✗ ${name}\n  ${e.message}`) }
}
await browser.close()
await server.close()
if (failed) { console.log(`✗ ไม่ผ่าน ${failed} รายการ`); process.exit(1) }
console.log(`✓ ผ่านทั้งหมด ${cases.length} รายการ`)
