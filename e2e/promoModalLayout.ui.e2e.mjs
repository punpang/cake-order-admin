// ทดสอบการจัดวางของฟอร์มส่วนลด POS (หน้า /admin/settings/promos) ที่จอ 1280×900 และมือถือ 390×844
// ตรวจ: เดือนในวันที่ไม่ถูกบีบ · วันในสัปดาห์กว้างเท่ากัน · ช่องเวลามีป้ายชั่วโมง/นาที ·
// ช่องขั้นต่ำใช้ placeholder ที่บอกความหมาย · ปุ่มลบอยู่ซ้ายสุดแยกจากปุ่มยืนยัน
// ถ่ายภาพหน้าจอไว้ที่ PROMO_SHOTS (ค่าเริ่มต้นใน scratchpad) เพื่อเทียบก่อน/หลัง
// รัน: node e2e/promoModalLayout.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.PROMO_SHOTS || ''
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

const cases = []
const t = (name, fn) => cases.push([name, fn])
let fails = 0

async function openPromos(viewport, tag) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/promos`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors, tag }
}

const box = async (page, sel) => {
  const el = page.locator(sel).first()
  const b = await el.boundingBox()
  assert.ok(b, `ไม่พบ ${sel}`)
  return b
}

for (const [label, viewport] of [['1280', { width: 1280, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  t(`[${label}] ฟอร์มส่วนลด: เดือนไม่ถูกบีบ วันในสัปดาห์เท่ากัน ป้ายเวลาและขั้นต่ำถูกต้อง`, async () => {
    const { page, errors } = await openPromos(viewport, label)
    try {
      await page.getByRole('button', { name: /^เพิ่ม/ }).first().click()
      await page.locator('[aria-label="วันเริ่ม เดือน"]').waitFor()
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/promo-modal-${label}.png` }) }
      const month = await box(page, '[aria-label="วันเริ่ม เดือน"]')
      assert.ok(month.width >= 72, `ช่องเดือนแคบเกินไป ${month.width}px`)
      const chips = await page.locator('button.chip', { hasText: /^(อา|จ|อ|พ|พฤ|ศ|ส)\.$/ }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
      assert.equal(chips.length, 7, 'วันในสัปดาห์ต้องมี 7 ปุ่ม')
      assert.ok(Math.max(...chips) - Math.min(...chips) <= 1, `วันในสัปดาห์กว้างไม่เท่ากัน ${chips.map(Math.round).join(',')}`)
      assert.equal(await page.locator('[aria-label="เวลาเริ่ม ชั่วโมง"] option').first().textContent(), 'ชั่วโมง')
      assert.equal(await page.locator('[aria-label="เวลาเริ่ม นาที"] option').first().textContent(), 'นาที')
      const minPh = await page.locator('input[placeholder="ไม่มีขั้นต่ำ"]').count()
      assert.equal(minPh, 1, 'ช่องยอดขั้นต่ำต้องใช้ placeholder "ไม่มีขั้นต่ำ"')
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

t('ปุ่มลบอยู่ซ้ายสุด แยกจากปุ่มยกเลิก/บันทึก (ส่วนลดที่มีอยู่แล้ว)', async () => {
  const { page, errors } = await openPromos({ width: 1280, height: 900 }, 'del')
  try {
    await page.evaluate(() => window.__store.savePosDiscount({ name: 'e2e-ลดทดสอบ', type: 'percent', value: 10, scope: 'all' }))
    await page.getByRole('button', { name: /e2e-ลดทดสอบ/ }).first().click()
    await page.getByRole('button', { name: 'ลบ', exact: true }).waitFor()
    const del = await box(page, 'button:has-text("ลบ"):visible')
    const cancel = await box(page, 'button:has-text("ยกเลิก"):visible')
    const save = await box(page, 'button:has-text("บันทึก"):visible')
    assert.ok(del.x < cancel.x && cancel.x < save.x, 'ลำดับปุ่มต้องเป็น ลบ · ยกเลิก · บันทึก')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('เลือกหมวด: มีหัวข้อบอกว่าเป็นตัวเลือกหมวด', async () => {
  const { page, errors } = await openPromos({ width: 1280, height: 900 }, 'cat')
  try {
    await page.getByRole('button', { name: /^เพิ่ม/ }).first().click()
    await page.getByRole('button', { name: 'ทั้งหมวด', exact: true }).click()
    assert.ok(await page.locator('text=เลือกหมวดที่ใช้').first().isVisible(), 'ต้องมีหัวข้อ "เลือกหมวดที่ใช้"')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
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
