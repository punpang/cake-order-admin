// ทดสอบปุ่มในใบเสร็จ POS (/admin/pos): กดพิมพ์แล้วปุ่มบอกว่าพิมพ์แล้ว · ขายต่อมีข้อความยืนยัน
// ข้อมูลจำลองในหน่วยความจำ · window.print ถูกแทนด้วยตัวนับ (ไม่เปิดหน้าต่างพิมพ์จริง) · รัน: node e2e/posReceiptFeedback.ui.e2e.mjs
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

const clickBtn = (page, text, exact = false) => page.evaluate(([text, exact]) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && !x.disabled && (exact ? x.textContent.trim() === text : x.textContent.includes(text)))
  if (!b) throw new Error('ไม่พบปุ่ม ' + text)
  b.click()
}, [text, exact])

const addFirstProduct = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /฿/.test(x.innerText) && !x.disabled && x.offsetParent && !/หมด/.test(x.innerText))
  if (!b) throw new Error('ไม่มีสินค้าให้กด')
  b.click()
})

// เปิด POS ขายเงินสดให้ครบจนขึ้นใบเสร็จ "ชำระครบแล้ว"
async function sellCashReceipt() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/pos`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForTimeout(300)
  // นับการเรียกพิมพ์แทนการเปิดหน้าต่างพิมพ์จริง
  await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++ } })
  await clickBtn(page, 'ลูกค้าทั่วไป', true)
  await addFirstProduct(page)
  await clickBtn(page, 'ชำระเงิน', true)
  await page.waitForTimeout(300)
  await clickBtn(page, 'เงินสด', true)
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === 'พอดี' && !x.disabled)
    if (!b) throw new Error('ไม่พบปุ่ม พอดี')
    b.click()
  })
  await page.waitForTimeout(300)
  await clickBtn(page, 'ยืนยันรับเงิน', true)
  await page.waitForTimeout(800)
  assert.equal(await page.getByText('ชำระครบแล้ว').first().isVisible(), true, 'ต้องขึ้นใบเสร็จ "ชำระครบแล้ว"')
  return { page, errors }
}

t('กดพิมพ์แล้วปุ่มเปลี่ยนเป็น "พิมพ์แล้ว ✓" และมีข้อความยืนยัน · กดซ้ำพิมพ์ใหม่ได้', async () => {
  const { page, errors } = await sellCashReceipt()
  try {
    assert.equal(await page.getByRole('button', { name: 'พิมพ์', exact: true }).count(), 1, 'ก่อนกดต้องมีปุ่ม "พิมพ์" เพียงปุ่มเดียว')
    await page.getByRole('button', { name: 'พิมพ์', exact: true }).click()
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.__printCalls), 1, 'ต้องเรียกพิมพ์ 1 ครั้ง')
    assert.equal(await page.getByRole('button', { name: 'พิมพ์แล้ว ✓' }).count(), 1, 'ปุ่มต้องบอกว่าพิมพ์แล้ว')
    assert.equal(await page.getByText('เปิดหน้าต่างพิมพ์แล้ว').isVisible(), true, 'ต้องมีข้อความยืนยันการพิมพ์')
    await page.getByRole('button', { name: 'พิมพ์แล้ว ✓', exact: true }).click()
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.__printCalls), 2, 'กดซ้ำต้องพิมพ์ใหม่ได้')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ขายต่อ: ปิดใบเสร็จและมีข้อความว่าบิลนี้เสร็จแล้ว', async () => {
  const { page, errors } = await sellCashReceipt()
  try {
    await clickBtn(page, 'ขายต่อ', true)
    await page.waitForTimeout(300)
    assert.equal(await page.getByText('บิลนี้เสร็จแล้ว').isVisible(), true, 'ต้องมีข้อความว่าบิลนี้เสร็จแล้ว')
    assert.equal(await page.getByText('ชำระครบแล้ว').count(), 0, 'ใบเสร็จต้องปิดแล้ว')
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
