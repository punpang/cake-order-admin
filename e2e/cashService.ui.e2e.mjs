// ทดสอบบริการเกี่ยวกับเงิน (ซ่อนเงิน/ดึงเงิน/ซ่อนของ) ในเบราว์เซอร์ (Playwright + Chromium) กับ dev server ของ Vite และข้อมูลจำลอง
// ครอบคลุม: (1) ตั้งค่าบริการในหน้าตั้งค่าร้านแล้วบันทึกมีผลจริง (2) ออร์เดอร์ที่มีซ่อนเงินแสดงเงินพัก/รายการค่าบริการ
// (3) แก้เงินพักจากหน้ารายละเอียดออร์เดอร์ได้ และยอดเงินพักใหม่ถูกบันทึก · รัน: node e2e/cashService.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
// Chromium ใต้ root (เช่น ในคอนเทนเนอร์) ต้องปิด sandbox · บนเครื่องปกติไม่ใส่
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

let fails = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

// เปิดหน้าใหม่ รอให้ข้อมูลจำลองโหลดเสร็จ และเก็บข้อผิดพลาดที่หน้าเว็บโยนออกมา
async function openPage(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors }
}

const ev = (page, fn, arg) => page.evaluate(fn, arg)

t('หน้าตั้งค่าร้าน: เปิดบริการซ่อนเงินและตั้งค่าบริการ/เพดานธนบัตร → บันทึกแล้วมีผลจริง', async () => {
  const { page, errors } = await openPage('/admin/settings/shop')
  try {
    const maxNotes = page.getByLabel('จำนวนธนบัตรสูงสุดต่อครั้ง (0 = ไม่จำกัด)')
    await maxNotes.waitFor({ state: 'visible', timeout: 20000 })
    await maxNotes.fill('5')
    await page.getByRole('switch', { name: 'เปิดให้บริการซ่อนเงิน' }).click()
    const fee = page.getByLabel('ค่าบริการซ่อนเงิน (บาท)')
    await fee.fill('50')
    await fee.press('Tab')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.waitForFunction(() => window.__store?.db.shop.cashService?.services.hide.show === true, null, { timeout: 5000 }).catch(async (e) => {
      const msg = await page.locator('[role=alert], .text-rose-700').allInnerTexts()
      throw new Error(`${e.message} · ข้อความบนหน้า: ${msg.join(' | ') || '(ไม่มี)'}`)
    })
    const saved = await ev(page, () => window.__store.db.shop.cashService)
    assert.equal(saved.maxNotes, 5)
    assert.equal(saved.services.hide.show, true)
    assert.equal(saved.services.hide.fee, 50)
    assert.equal(saved.services.pull.show, false, 'บริการที่ไม่ได้เปิดต้องยังปิดอยู่')
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.close() }
})

t('ออร์เดอร์ซ่อนเงิน: แสดงรายการค่าบริการและเงินพัก (ไม่ใช่รายได้) · แก้เงินพักเพิ่มธนบัตรแล้วบันทึกได้', async () => {
  const { page, errors } = await openPage('/admin/orders')
  try {
    // เตรียมออร์เดอร์: คัดลอกสินค้าจากออร์เดอร์ตัวอย่าง แล้วสร้างพร้อมซ่อนเงิน 1,000 บาท (ค่าบริการจากการตั้งค่า)
    const seeded = await ev(page, () => {
      const S = window.__store
      const tpl = S.db.orders.find((o) => o.customerId && o.channel !== 'pos' && o.status === 'awaiting_payment')
      if (!tpl) return { error: 'ไม่มีออร์เดอร์ตัวอย่าง' }
      S.saveShopSettings({ ...JSON.parse(JSON.stringify(S.db.shop)), cashService: { maxNotes: 5, services: { hide: { fee: 50, show: true }, pull: { fee: 40, show: false }, stash: { fee: 30, show: false } } } })
      const d = JSON.parse(JSON.stringify(tpl))
      const r = S.createOrder({ customerId: d.customerId, pickupAt: '2030-03-10T10:00', fulfillment: 'pickup', items: d.items, vat: d.vat, promoOn: false, quoteItems: false, shipPromo: null, birthday: null, cashService: { kind: 'hide', notes: { 1000: 1 } } }, false)
      if (r.error) return { error: r.error }
      return { id: r.id, hold: r.holdMoney?.amount, svc: r.items.find((i) => i.kind === 'service')?.unitPrice }
    })
    assert.ok(!seeded.error, `สร้างออร์เดอร์ไม่ได้: ${seeded.error}`)
    assert.equal(seeded.hold, 1000, 'เงินพักต้องคิดจากธนบัตร')
    assert.equal(seeded.svc, 50, 'ค่าบริการต้องมาจากการตั้งค่า')

    await page.goto(`${base}/#/admin/orders/${seeded.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.getByText('เงินพักของลูกค้า (ไม่ใช่รายได้)').waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'แก้เงินพัก' }).click()
    await page.getByRole('button', { name: 'เพิ่มธนบัตร 100 บาท' }).click()
    await page.getByText('เงินพักใหม่').waitFor({ state: 'visible' })
    await page.getByLabel('เหตุผล *').fill('ลูกค้าเพิ่มเงินพัก')
    await page.getByRole('button', { name: 'บันทึกเงินพัก', exact: true }).click()
    await page.waitForFunction((id) => window.__store.db.orders.find((o) => o.id === id)?.holdMoney?.amount === 1100, seeded.id, { timeout: 5000 })
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
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
