// ทดสอบ dialog แนวนอน: ที่ 1280×800 dialog หลักต้องไม่สูงเกินจอ และเนื้อหาแบ่งสองคอลัมน์ · ที่ 390×844 (มือถือ) ยังคอลัมน์เดียว
// รัน: node e2e/dialogLandscape.ui.e2e.mjs
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
const cases = []
const t = (name, fn) => cases.push([name, fn])

async function openPage(hash, viewport) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  return { page, errors }
}
const dialogBox = (page) => page.evaluate(() => {
  const d = document.querySelector('[data-dialog]')
  if (!d) return null
  const r = d.getBoundingClientRect()
  const b = d.querySelector('[data-dialog-body]')
  return { h: Math.round(r.height), vh: window.innerHeight, cols: getComputedStyle(d.querySelector('.dlg-cols') || b).columnCount, footer: !!d.querySelector('button.btn-primary') }
})

const LANDSCAPE = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }

t('แนวนอน 1280×800: เพิ่มสินค้า (ซ้าย/ขวา) ไม่สูงเกินจอ และปุ่มบันทึกอยู่ล่าง', async () => {
  const { page, errors } = await openPage('/admin/settings/retail', LANDSCAPE)
  try {
    await page.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).first().click()
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 })
    const m = await dialogBox(page)
    assert.ok(m.h <= m.vh, `dialog สูง ${m.h}px เกินจอ ${m.vh}px`)
    assert.ok(m.footer, 'ต้องมีปุ่มบันทึกที่ footer')
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.close() }
})

t('แนวนอน 1280×800: กลุ่มตัวเลือกไม่สูงเกินจอ (ตัวเลือกอยู่ขวา)', async () => {
  const { page, errors } = await openPage('/admin/settings/retail', LANDSCAPE)
  try {
    await page.getByRole('button', { name: 'เพิ่มกลุ่ม', exact: true }).first().click()
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 })
    const m = await dialogBox(page)
    assert.ok(m.h <= m.vh, `dialog สูง ${m.h}px เกินจอ ${m.vh}px`)
    assert.ok(m.footer, 'ต้องมีปุ่มบันทึกที่ footer')
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.close() }
})

t('แนวนอน 1280×800: เพิ่มลูกค้า แบ่งสองคอลัมน์ · มือถือ 390×844 คอลัมน์เดียว', async () => {
  const land = await openPage('/admin/settings/customers', LANDSCAPE)
  try {
    await land.page.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).first().click()
    await land.page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 })
    const m = await dialogBox(land.page)
    assert.equal(m.cols, '2', 'แนวนอนต้องแบ่งสองคอลัมน์')
    assert.ok(m.h <= m.vh, `dialog สูง ${m.h}px เกินจอ ${m.vh}px`)
    assert.deepEqual(land.errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${land.errors.join(' | ')}`)
  } finally { await land.page.close() }
  const phone = await openPage('/admin/settings/customers', PHONE)
  try {
    await phone.page.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).first().click()
    await phone.page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 })
    const m = await dialogBox(phone.page)
    assert.notEqual(m.cols, '2', 'มือถือต้องคอลัมน์เดียว')
    assert.deepEqual(phone.errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${phone.errors.join(' | ')}`)
  } finally { await phone.page.close() }
})

try {
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
