// ทดสอบฟอร์มของแลกในหน้าสะสมแต้ม: พิมพ์ราคาแล้วคะแนนคำนวณให้ · แก้คะแนนเองได้ · คูปองลดเป็นบาทใช้ "ลด (บาท)" เป็นราคา
// ข้อมูลจำลองในหน่วยความจำ · รัน: node e2e/rewardPoints.ui.e2e.mjs (ต้องมี Chromium ของ Playwright)
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

async function openRewardForm() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/loyalty`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.getByRole('button', { name: 'ของแลก', exact: true }).first().click()
  await page.getByRole('button', { name: 'เพิ่มของแลก' }).first().click()
  await page.waitForSelector('xpath=//label[contains(., "ราคาของที่แลก")]')
  return { page, errors }
}
// ช่อง input ที่อยู่ถัดจาก label ที่มีข้อความนั้น
const fieldOf = (page, text) => page.locator(`xpath=//label[contains(., "${text}")]/following::input[1]`)

t('พิมพ์ราคา 120 → ใช้คะแนน = 120 และมีบรรทัดอธิบายการคิด', async () => {
  const { page, errors } = await openRewardForm()
  try {
    await fieldOf(page, 'ราคาของที่แลก').fill('120')
    await fieldOf(page, 'ราคาของที่แลก').blur()
    await page.waitForTimeout(200)
    assert.equal(await fieldOf(page, 'ใช้คะแนน').inputValue(), '120')
    assert.ok(await page.getByText('คิดจาก 120 ÷ 1 บาท/คะแนน (ปัดขึ้น) · แก้เองได้').isVisible())
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

t('แก้คะแนนเองเป็น 90 แล้วคงค่า 90 (ไม่ถูกเขียนทับจากราคา)', async () => {
  const { page, errors } = await openRewardForm()
  try {
    await fieldOf(page, 'ราคาของที่แลก').fill('120')
    await fieldOf(page, 'ราคาของที่แลก').blur()
    await page.waitForTimeout(200)
    await fieldOf(page, 'ใช้คะแนน').fill('90')
    await fieldOf(page, 'ใช้คะแนน').blur()
    await page.waitForTimeout(200)
    assert.equal(await fieldOf(page, 'ใช้คะแนน').inputValue(), '90')
    assert.deepEqual(errors, [])
  } finally { await page.context().close() }
})

t('คูปองลดเป็นบาท: พิมพ์ "ลด (บาท)" 50 → ราคาและคะแนนเติมให้', async () => {
  const { page, errors } = await openRewardForm()
  try {
    await page.getByRole('button', { name: 'คูปองส่วนลด', exact: true }).first().click()
    await page.getByRole('button', { name: 'ลดเป็นบาท', exact: true }).first().click()
    await fieldOf(page, 'ลด (บาท)').fill('50')
    await fieldOf(page, 'ลด (บาท)').blur()
    await page.waitForTimeout(200)
    assert.equal(Number(await fieldOf(page, 'ราคาของที่แลก').inputValue()), 50)
    assert.equal(await fieldOf(page, 'ใช้คะแนน').inputValue(), '50')
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
