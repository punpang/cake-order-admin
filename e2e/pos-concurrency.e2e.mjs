// ทดสอบการกดซ้ำ/แข่งกันบนหน้า POS ด้วยการดับเบิลคลิกจริงในเบราว์เซอร์
//   (1) ดับเบิลคลิก "ยืนยันรับเงิน" → เกิดบิลเพียงหนึ่งใบ (ไม่ซ้ำ)
//   (2) ดับเบิลคลิกสินค้าที่เหลือ 1 ชิ้น → ตะกร้ามีไม่เกิน 1 ชิ้น (ไม่ขายเกินสต็อก)
// ขอบเขต: โหมดข้อมูลจำลองเป็นหนึ่งแท็บ ไม่แชร์ข้อมูลข้ามเครื่อง การแข่งขันข้ามเครื่องจริงอยู่ที่ฐานข้อมูล (ดู supabase/tests)
// ตัวควบคุม: ตรวจว่าการดับเบิลคลิกเกิดขึ้นจริง (ปุ่มยังอยู่ก่อนกด) เพื่อไม่ให้ผ่านเพราะไม่ได้กด
// รัน: node e2e/pos-concurrency.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/pos`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  await page.getByRole('button', { name: 'ไม่มี', exact: true }).first().click() // ขายแบบไม่มีสมาชิก (ต้องเลือกก่อนเพิ่มสินค้า)
  return { page, errors }
}
const posCount = (page) => page.evaluate(() => window.__store.db.orders.filter((o) => o.channel === 'pos').length)

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('ดับเบิลคลิกยืนยันรับเงิน → เกิดบิลเพียงหนึ่งใบ', async () => {
  const { page, errors } = await open()
  try {
    const before = await posCount(page)
    await page.getByRole('button', { name: /คัพเค้กวานิลลา/ }).first().click()
    await page.getByRole('button', { name: 'ชำระเงิน', exact: true }).first().click()
    await page.getByRole('button', { name: 'เงินสด', exact: true }).first().click()
    await page.getByRole('button', { name: 'พอดี', exact: true }).first().click()
    const confirm = page.getByRole('button', { name: 'ยืนยันรับเงิน', exact: true }).first()
    await confirm.waitFor({ state: 'visible' })
    await confirm.dblclick()
    await page.waitForTimeout(1200)
    assert.equal(await posCount(page), before + 1, 'ดับเบิลคลิกแล้วเกิดบิลซ้ำ')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ดับเบิลคลิกสินค้าที่เหลือ 1 ชิ้น → ตะกร้าไม่เกิน 1 ชิ้น (ไม่ขายเกินสต็อก)', async () => {
  const { page, errors } = await open()
  try {
    await page.evaluate(() => { const r = window.__store.db.retailItems.find((x) => x.id === 'rt3'); r.stock = 1 })
    const card = page.getByRole('button', { name: /คัพเค้กวานิลลา/ }).first()
    await card.waitFor({ state: 'visible' })
    assert.ok(await card.isEnabled(), 'ก่อนกด การ์ดสินค้าควรกดได้')
    await card.dblclick()
    await page.waitForTimeout(500)
    const inCart = await page.getByText(/ตะกร้า \d+ ชิ้น/).first().innerText()
    assert.match(inCart, /ตะกร้า 1 ชิ้น/, `ตะกร้าควรมี 1 ชิ้น ได้ "${inCart}"`)
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
