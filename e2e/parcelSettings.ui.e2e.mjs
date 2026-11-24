// ทดสอบช่องน้ำหนัก/ขนาดสินค้าสำหรับค่าส่งพัสดุ (สั่งล่วงหน้า เฟส 2A) และตารางอัตราในหน้าตั้งค่าร้าน
//   (1) กรอกน้ำหนักอย่างเดียวบันทึกไม่ได้ · (2) น้ำหนัก+ขนาดครบบันทึกเป็นฟิลด์สินค้า · (3) แก้แล้วฟอร์มแสดงค่าเดิม · (4) ไม่กรอกบันทึกได้เป็น null
//   (5) ตารางอัตราค่าส่งพัสดุในหน้าตั้งค่าร้าน: เพิ่มขั้น บันทึก ตรวจซ้ำ/ลดราคา
// รัน: node e2e/parcelSettings.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

async function open(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async (h) => {
    const S = await import('/src/data/store.js')
    S.session.role = 'admin'
    location.hash = h
  }, hash)
  return { page, errors }
}

// ช่องที่อยู่หลัง label (label ของ ManageRetail ไม่ผูกด้วย for)
const field = (page, labelText) => page.locator('div:has(> label.label)').filter({ has: page.locator(`label.label:text-is("${labelText}")`) }).first().locator('input').first()
const itemNamed = (page, name) => page.evaluate(async (n) => (await import('/src/data/store.js')).db.retailItems.find((x) => x.name === n) ?? null, name)

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('กรอกน้ำหนักอย่างเดียวบันทึกไม่ได้ · ครบแล้วบันทึกเป็นฟิลด์สินค้า · แก้แล้วฟอร์มแสดงค่าเดิม', async () => {
  const { page, errors } = await open('#/admin/settings/retail')
  try {
    await page.getByText('สินค้า (POS / สินค้าสำเร็จ)').first().waitFor({ state: 'visible', timeout: 60000 })
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click()
    await page.getByRole('heading', { name: /สินค้า/ }).first().waitFor({ state: 'visible' }).catch(() => {})
    await page.locator('label.label', { hasText: /^ชื่อ/ }).first().locator('xpath=following-sibling::input').fill('พัสดุทดสอบ')
    await field(page, 'ราคา (บาท)').fill('120')
    await field(page, 'น้ำหนัก (กรัม)').fill('800')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).last().click()
    await page.getByText(/ให้ครบ หรือเว้นว่างทั้งหมด/).waitFor({ state: 'visible' })
    assert.equal(await itemNamed(page, 'พัสดุทดสอบ'), null)

    await field(page, 'กว้าง (ซม.)').fill('20')
    await field(page, 'ยาว (ซม.)').fill('20')
    await field(page, 'สูง (ซม.)').fill('10')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).last().click()
    await page.waitForFunction(async () => !!(await import('/src/data/store.js')).db.retailItems.find((x) => x.name === 'พัสดุทดสอบ'))
    const saved = await itemNamed(page, 'พัสดุทดสอบ')
    assert.equal(saved.weightG, 800)
    assert.deepEqual(saved.dimsCm, { w: 20, l: 20, h: 10 })

    await page.getByRole('button', { name: /พัสดุทดสอบ/ }).first().click()
    assert.equal(await field(page, 'น้ำหนัก (กรัม)').inputValue(), '800')
    assert.equal(await field(page, 'กว้าง (ซม.)').inputValue(), '20')
    assert.equal(await field(page, 'สูง (ซม.)').inputValue(), '10')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ไม่กรอกน้ำหนักและขนาดบันทึกได้ และเก็บเป็น null', async () => {
  const { page, errors } = await open('#/admin/settings/retail')
  try {
    await page.getByText('สินค้า (POS / สินค้าสำเร็จ)').first().waitFor({ state: 'visible', timeout: 60000 })
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click()
    await page.locator('label.label', { hasText: /^ชื่อ/ }).first().locator('xpath=following-sibling::input').fill('ไม่มีพัสดุ')
    await field(page, 'ราคา (บาท)').fill('50')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).last().click()
    await page.waitForFunction(async () => !!(await import('/src/data/store.js')).db.retailItems.find((x) => x.name === 'ไม่มีพัสดุ'))
    const saved = await itemNamed(page, 'ไม่มีพัสดุ')
    assert.equal(saved.weightG, null)
    assert.equal(saved.dimsCm, null)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าตั้งค่าร้าน: มีส่วนค่าส่งพัสดุ · เพิ่มขั้นแล้วบันทึกได้ (เรียงถูก) · ขั้นน้ำหนักซ้ำและราคาลดลงบันทึกไม่ได้ · มีตัวอย่างค่าส่ง', async () => {
  const { page, errors } = await open('#/admin/settings/shop')
  try {
    await page.getByText('ค่าส่งพัสดุไปรษณีย์').first().waitFor({ state: 'visible', timeout: 60000 })
    assert.ok(await page.getByText(/^ตัวอย่าง: /).count() >= 1)
    await page.getByRole('button', { name: 'เพิ่มขั้น' }).click()
    await page.getByRole('button', { name: 'เพิ่มขั้น' }).click()
    const weights = page.getByLabel('น้ำหนักสูงสุดของขั้น (กรัม)')
    const prices = page.getByLabel('ราคาของขั้น (บาท)')
    await weights.nth(0).fill('1000'); await prices.nth(0).fill('60')
    await weights.nth(1).fill('1000'); await prices.nth(1).fill('70')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.getByText('น้ำหนักของขั้นซ้ำกัน').waitFor({ state: 'visible' })
    await weights.nth(1).fill('500'); await prices.nth(1).fill('40')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.waitForFunction(async () => (await import('/src/data/store.js')).db.shop.parcel?.rates?.length === 2)
    const rates = await page.evaluate(async () => (await import('/src/data/store.js')).db.shop.parcel.rates)
    assert.deepEqual(rates, [{ upToG: 500, price: 40 }, { upToG: 1000, price: 60 }])
    await weights.nth(1).fill('2000'); await prices.nth(1).fill('30')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.getByText('ราคาต้องไม่ลดลงเมื่อน้ำหนักมากขึ้น').waitFor({ state: 'visible' })
    assert.deepEqual(await page.evaluate(async () => (await import('/src/data/store.js')).db.shop.parcel.rates.map((r) => r.price)), [40, 60])
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ช่องขนาดสินค้าและราคาขั้นรับทศนิยมได้ (ไม่ถูกตัดจุดทิ้ง) · น้ำหนักที่เป็นทศนิยมถูกปฏิเสธ', async () => {
  const { page, errors } = await open('#/admin/settings/retail')
  try {
    await page.getByText('สินค้า (POS / สินค้าสำเร็จ)').first().waitFor({ state: 'visible', timeout: 60000 })
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click()
    await page.locator('label.label', { hasText: /^ชื่อ/ }).first().locator('xpath=following-sibling::input').fill('ทศนิยมทดสอบ')
    await field(page, 'ราคา (บาท)').fill('50')
    await field(page, 'น้ำหนัก (กรัม)').fill('800.5')
    await field(page, 'กว้าง (ซม.)').fill('12.5')
    await field(page, 'ยาว (ซม.)').fill('20')
    await field(page, 'สูง (ซม.)').fill('10')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).last().click()
    await page.getByText(/น้ำหนักต้องเป็นจำนวนเต็มกรัม/).waitFor({ state: 'visible' })
    assert.equal(await itemNamed(page, 'ทศนิยมทดสอบ'), null)
    await field(page, 'น้ำหนัก (กรัม)').fill('800')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).last().click()
    await page.waitForFunction(async () => !!(await import('/src/data/store.js')).db.retailItems.find((x) => x.name === 'ทศนิยมทดสอบ'))
    assert.deepEqual((await itemNamed(page, 'ทศนิยมทดสอบ')).dimsCm, { w: 12.5, l: 20, h: 10 })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ตารางอัตราค่าส่ง: ราคาทศนิยม 32.5 ถูกบันทึกเป็น 32.5 (ไม่ใช่ 325)', async () => {
  const { page, errors } = await open('#/admin/settings/shop')
  try {
    await page.getByText('ค่าส่งพัสดุไปรษณีย์').first().waitFor({ state: 'visible', timeout: 60000 })
    await page.getByRole('button', { name: 'เพิ่มขั้น' }).click()
    await page.getByLabel('น้ำหนักสูงสุดของขั้น (กรัม)').first().fill('1000')
    await page.getByLabel('ราคาของขั้น (บาท)').first().fill('32.5')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.waitForFunction(async () => (await import('/src/data/store.js')).db.shop.parcel?.rates?.length === 1)
    assert.equal(await page.evaluate(async () => (await import('/src/data/store.js')).db.shop.parcel.rates[0].price), 32.5)
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
