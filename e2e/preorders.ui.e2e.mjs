// ทดสอบหน้าตั้งแคมเปญสั่งล่วงหน้าด้วยเบราว์เซอร์จริง
//   (1) บังคับกรอกเวลาจ่ายมัดจำ · (2) สร้างแคมเปญแล้วขึ้นรายการ · (3) เปิด/ปิดรับสั่ง
//   (4) ไม่มีแนวนอนล้นที่ 375px · (5) พนักงานขายไม่มีสิทธิ์เข้าหน้า
// รัน: node e2e/preorders.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

async function open(width = 1280, role = 'admin') {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  // ตั้งบทบาทและสินค้าทดสอบ แล้วเปิดหน้าใหม่ผ่าน hash (ไม่ reload เพราะ reload จะรีเซ็ตบทบาท)
  await page.evaluate(async (r) => {
    const S = await import('/src/data/store.js')
    S.session.role = r
    const item = S.db.retailItems.find((x) => x.id === 'rt3')
    if (item) Object.assign(item, { active: true, openPrice: false, modifierIds: [] })
  }, role)
  await page.evaluate(() => { location.hash = '#/admin/settings/preorders' })
  await page.waitForFunction(() => document.body.innerText.includes('สั่งล่วงหน้า') || document.body.innerText.includes('ไม่มีสิทธิ์'), null, { timeout: 60000 })
  return { page, errors }
}

async function campaignCount(page) {
  return page.evaluate(async () => (await import('/src/data/store.js')).db.preorderCampaigns.length)
}

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('บังคับกรอกเวลาจ่ายมัดจำ และไม่สร้างแคมเปญเมื่อว่าง', async () => {
  const { page, errors } = await open()
  try {
    await page.getByRole('heading', { name: 'สั่งล่วงหน้า (Preorder)' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
    await page.getByLabel('ชื่อแคมเปญ').fill('ทดสอบ')
    await page.getByLabel('เริ่มรับสั่ง').fill('2000-01-01')
    await page.getByLabel('สิ้นสุดรับสั่ง').fill('2099-12-31')
    await page.getByLabel('เริ่มวันรับสินค้า').fill('2099-12-24')
    await page.getByLabel('สิ้นสุดวันรับสินค้า').fill('2099-12-26')
    await page.getByRole('button', { name: 'บันทึก' }).click()
    await page.getByText('ต้องกำหนดเวลาจ่ายมัดจำ').waitFor({ state: 'visible' })
    assert.equal(await campaignCount(page), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('สร้างแคมเปญ → ขึ้นรายการ → เปิดรับสั่ง → ปิดรับ', async () => {
  const { page, errors } = await open()
  try {
    await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
    await page.getByLabel('ชื่อแคมเปญ').fill('คริสต์มาส')
    await page.getByLabel('เริ่มรับสั่ง').fill('2000-01-01')
    await page.getByLabel('สิ้นสุดรับสั่ง').fill('2099-12-31')
    await page.getByLabel('เริ่มวันรับสินค้า').fill('2099-12-24')
    await page.getByLabel('สิ้นสุดวันรับสินค้า').fill('2099-12-26')
    await page.getByLabel('จ่ายมัดจำภายใน (ชม.)').fill('2')
    const first = await page.evaluate(async () => (await import('/src/data/store.js')).db.retailItems.find((x) => x.active && !x.openPrice)?.name)
    assert.ok(first, 'ต้องมีสินค้าที่ใช้ได้ในข้อมูลจำลอง')
    await page.getByLabel(`เลือก ${first}`).check()
    await page.getByRole('button', { name: 'บันทึก' }).click()
    const card = page.locator('[data-campaign]').filter({ hasText: 'คริสต์มาส' })
    await card.waitFor({ state: 'visible' })
    await card.getByText('ร่าง', { exact: true }).waitFor({ state: 'visible' })
    await card.getByRole('button', { name: 'เปิดรับสั่ง' }).click()
    await card.getByRole('button', { name: 'ปิดรับ' }).waitFor({ state: 'visible' })
    await card.getByRole('button', { name: 'ปิดรับ' }).click()
    await card.getByRole('button', { name: 'เปิดรับสั่ง' }).waitFor({ state: 'visible' })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ไม่มีแนวนอนล้นที่ 375px', async () => {
  const { page, errors } = await open(375)
  try {
    await page.getByRole('heading', { name: 'สั่งล่วงหน้า (Preorder)' }).waitFor({ state: 'visible' })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 1, `ล้น ${overflow}px`)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('พนักงานขายเข้าหน้าไม่ได้', async () => {
  const { page, errors } = await open(1280, 'sales')
  try {
    await page.getByText(/ไม่มีสิทธิ์/).first().waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).count(), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('2B: ตั้งขั้นส่วนลดตามยอดแล้วบันทึกได้ · เปิดส่งพัสดุกับสินค้าที่ไม่มีน้ำหนักบันทึกไม่ได้', async () => {
  const { page, errors } = await open()
  try {
    await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
    await page.getByLabel('ชื่อแคมเปญ').fill('ส่วนลดตามยอด')
    await page.getByLabel('เริ่มรับสั่ง').fill('2000-01-01')
    await page.getByLabel('สิ้นสุดรับสั่ง').fill('2099-12-31')
    await page.getByLabel('เริ่มวันรับสินค้า').fill('2099-12-24')
    await page.getByLabel('สิ้นสุดวันรับสินค้า').fill('2099-12-26')
    await page.getByLabel('จ่ายมัดจำภายใน (ชม.)').fill('2')
    const first = await page.evaluate(async () => (await import('/src/data/store.js')).db.retailItems.find((x) => x.active && !x.openPrice && !(x.modifierIds || []).length)?.name)
    await page.getByLabel(`เลือก ${first}`).check()
    await page.getByRole('button', { name: '+ เพิ่มขั้นส่วนลด' }).click()
    await page.getByLabel('ยอดซื้อขั้นต่ำของขั้นส่วนลด').fill('500')
    await page.getByLabel('ค่าส่วนลดของขั้น').fill('50')
    await page.getByRole('button', { name: 'บันทึก' }).click()
    await page.locator('[data-campaign]').filter({ hasText: 'ส่วนลดตามยอด' }).waitFor({ state: 'visible' })
    const deals = await page.evaluate(async () => (await import('/src/data/store.js')).db.preorderCampaigns.find((c) => c.name === 'ส่วนลดตามยอด')?.deals)
    assert.deepEqual(deals?.[0]?.tiers, [{ min: 500, type: 'amount', value: 50 }])
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('2B: เปิดส่งพัสดุกับสินค้าที่ไม่มีน้ำหนักบันทึกไม่ได้', async () => {
  const { page, errors } = await open()
  try {
    await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
    await page.getByLabel('ชื่อแคมเปญ').fill('พัสดุ')
    await page.getByLabel('เริ่มรับสั่ง').fill('2000-01-01')
    await page.getByLabel('สิ้นสุดรับสั่ง').fill('2099-12-31')
    await page.getByLabel('เริ่มวันรับสินค้า').fill('2099-12-24')
    await page.getByLabel('สิ้นสุดวันรับสินค้า').fill('2099-12-26')
    await page.getByLabel('จ่ายมัดจำภายใน (ชม.)').fill('2')
    const first = await page.evaluate(async () => (await import('/src/data/store.js')).db.retailItems.find((x) => x.active && !x.openPrice && !(x.modifierIds || []).length)?.name)
    await page.getByLabel(`เลือก ${first}`).check()
    await page.getByRole('switch', { name: /ส่งพัสดุไปรษณีย์/ }).click()
    await page.getByLabel('เริ่มวันจัดส่งพัสดุ').fill('2099-12-22')
    await page.getByLabel('สิ้นสุดวันจัดส่งพัสดุ').fill('2099-12-23')
    await page.getByRole('button', { name: 'บันทึก' }).click()
    await page.getByText(/ไม่มีน้ำหนักหรือขนาด/).waitFor({ state: 'visible' })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('shipping: เปิดส่งพัสดุต้องระบุช่วงวันจัดส่ง แล้วบันทึกและเก็บค่าที่แคมเปญ', async () => {
  const { page, errors } = await open()
  try {
    await page.evaluate(async () => {
      const S = await import('/src/data/store.js')
      const it = S.db.retailItems.find((x) => x.active && !x.openPrice && !(x.modifierIds || []).length)
      Object.assign(it, { weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } })
    })
    await page.getByRole('button', { name: '+ สร้างแคมเปญ' }).click()
    await page.getByLabel('ชื่อแคมเปญ').fill('จัดส่งพัสดุ')
    await page.getByLabel('เริ่มรับสั่ง').fill('2000-01-01')
    await page.getByLabel('สิ้นสุดรับสั่ง').fill('2099-12-31')
    await page.getByLabel('เริ่มวันรับสินค้า').fill('2099-12-24')
    await page.getByLabel('สิ้นสุดวันรับสินค้า').fill('2099-12-26')
    await page.getByLabel('จ่ายมัดจำภายใน (ชม.)').fill('2')
    const first = await page.evaluate(async () => (await import('/src/data/store.js')).db.retailItems.find((x) => x.active && !x.openPrice && !(x.modifierIds || []).length)?.name)
    await page.getByLabel(`เลือก ${first}`).check()
    await page.getByRole('switch', { name: /ส่งพัสดุไปรษณีย์/ }).click()
    await page.getByRole('button', { name: 'บันทึก' }).click()
    await page.getByText('ช่วงวันจัดส่งพัสดุต้องเป็นวันที่ที่ถูกต้อง').waitFor({ state: 'visible' })
    await page.getByLabel('เริ่มวันจัดส่งพัสดุ').fill('2099-12-22')
    await page.getByLabel('สิ้นสุดวันจัดส่งพัสดุ').fill('2099-12-23')
    // ช่วงจัดส่ง (22–23) อยู่นอกช่วงรับ (24–26) → มีคำเตือน แต่บันทึกได้
    await page.locator('[data-ship-warn]').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'บันทึก' }).click()
    await page.locator('[data-campaign]').filter({ hasText: 'จัดส่งพัสดุ' }).waitFor({ state: 'visible' })
    const sh = await page.evaluate(async () => (await import('/src/data/store.js')).db.preorderCampaigns.find((c) => c.name === 'จัดส่งพัสดุ')?.shipTo)
    assert.equal(sh, '2099-12-23')
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
