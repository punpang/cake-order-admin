// ทดสอบการตั้งค่าการพิมพ์บนเว็บ: หน้าตั้งค่า 3 แท็บ · ความกว้างสลิปต่อเบราว์เซอร์ · จำนวนชุด (ค่าร้าน) · แผ่นทดสอบบนกล่องพิมพ์ · ใบกำกับ A4 ไม่ว่าง
// window.print ถูกดักไว้ (ไม่พิมพ์จริง) แล้วอ่านสถานะ DOM ตอนที่ระบบสั่งพิมพ์
// รัน: node e2e/printing.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
const failures = []
const expect = (ok, msg) => { if (!ok) failures.push(msg) }

async function settle(hash) {
  await page.evaluate((h) => { location.hash = h }, hash)
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForTimeout(700)
}

// ตัวดัก window.print: จดสถานะของ body, แผ่นทดสอบ, ใบกำกับ A4 และแอป ณ ตอนที่สั่งพิมพ์
async function installPrintProbe() {
  await page.evaluate(() => {
    window.__prints = []
    window.print = () => {
      const cs = (el) => (el ? getComputedStyle(el) : null)
      const sheet = document.querySelector('.print-test-sheet')
      const root = document.querySelector('.a4-print-root')
      const app = document.querySelector('#app')
      window.__prints.push({
        body: document.body.className,
        sheetClass: sheet?.className || '',
        sheetDisplay: cs(sheet)?.display,
        sheetVisibility: cs(sheet)?.visibility,
        rootDisplay: cs(root)?.display,
        rootVisibility: cs(root)?.visibility,
        rootHeight: root?.getBoundingClientRect().height || 0,
        rootText: root?.innerText || '',
        appDisplay: cs(app)?.display,
      })
    }
  })
}
const clickText = (text, inDialog = false) => page.evaluate(([t, dlg]) => {
  const scope = dlg ? document.querySelector('[data-dialog]') : document
  const b = [...scope.querySelectorAll('button')].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === t)
  if (!b) throw new Error('ไม่พบปุ่ม ' + t)
  b.click()
}, [text, inDialog])
const prints = () => page.evaluate(() => window.__prints || [])
const resetPrintState = () => page.evaluate(() => {
  document.body.classList.remove('print-test', 'print-a4')
  window.__prints = []
})

await page.goto(`${base}/#/admin/no-access`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
await page.evaluate(() => {
  localStorage.removeItem('punpang.print.v2')
  localStorage.removeItem('punpang.device.v1')
})
await installPrintProbe()

// ---------- 1) หน้าตั้งค่าการพิมพ์ (เว็บ) ----------
await settle('/admin/settings/printing')
const tabNames = await page.getByRole('tab').allInnerTexts()
expect(JSON.stringify(tabNames) === JSON.stringify(['ใบเสร็จ POS', 'ใบเสร็จออเดอร์', 'ใบกำกับภาษี']), `แท็บหน้าตั้งค่าการพิมพ์ไม่ตรง: ${tabNames.join(' | ')}`)
await page.getByRole('button', { name: '58 มม.', exact: true }).click()
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('punpang.print.v2') || '{}'))
expect(stored.webWidth?.posReceipt === 58, 'ความกว้างสลิปบนเว็บของใบเสร็จ POS ไม่ถูกเก็บในเครื่อง')
expect(stored.webWidth?.orderReceipt === 'auto', 'ความกว้างของใบเสร็จออเดอร์ไม่ควรเปลี่ยนตามส่วนอื่น')
await page.getByRole('button', { name: '2 ชุด', exact: true }).click()
const copies = await page.evaluate(async () => (await import('/src/data/store.js')).db.printing.copies.posReceipt)
expect(copies === 2, `จำนวนชุดของใบเสร็จ POS ควรเป็น 2 (ได้ ${copies})`)

// ---------- 2) แผ่นทดสอบบนกล่องพิมพ์ (ใบเสร็จ POS = 58 มม.) ----------
await resetPrintState()
await page.emulateMedia({ media: 'print' })
await clickText('พิมพ์ใบทดสอบ')
await page.waitForTimeout(400)
let got = await prints()
expect(got.length === 1, `ควรเรียก window.print 1 ครั้ง แต่ได้ ${got.length}`)
if (got[0]) {
  expect(got[0].body.includes('print-test'), 'ตอนสั่งพิมพ์ต้องมี class print-test ที่ body')
  expect(got[0].sheetClass.includes('paper-58'), `แผ่นทดสอบของใบเสร็จ POS ควรเป็นกระดาษ 58 มม. (ได้ ${got[0].sheetClass})`)
  expect(got[0].sheetDisplay === 'block' && got[0].sheetVisibility === 'visible', 'แผ่นทดสอบต้องแสดงตอนพิมพ์')
  expect(got[0].appDisplay === 'none', 'ตอนพิมพ์แผ่นทดสอบ ส่วนของแอปต้องซ่อน')
}
await page.evaluate(() => document.body.classList.remove('print-test'))
await page.emulateMedia({ media: 'screen' })

// ---------- 3) แผ่นทดสอบใบกำกับ (A4) ----------
await resetPrintState()
await page.getByRole('tab', { name: 'ใบกำกับภาษี' }).click()
await clickText('พิมพ์ใบทดสอบ A4')
await page.waitForTimeout(400)
got = await prints()
expect(got.length === 1 && got[0].sheetClass.includes('sheet-a4'), 'แผ่นทดสอบใบกำกับต้องเป็น A4')
await page.evaluate(() => document.body.classList.add('print-test'))
const pdf = await page.pdf({ format: 'A4', printBackground: true })
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length
expect(pages === 1, `แผ่นทดสอบ A4 ควรได้ 1 หน้า แต่ได้ ${pages}`)
await page.evaluate(() => document.body.classList.remove('print-test'))
await page.emulateMedia({ media: 'screen' })

// ---------- 4) ใบกำกับภาษีบนเว็บ: พิมพ์ A4 ต้องไม่ว่าง ----------
const inv = await page.evaluate(async () => {
  const a = await import('/src/data/acct.js')
  const found = a.taxInvoices().find((i) => i.orderId && !i.voidedBy && i.type !== 'credit')
  return found ? { orderId: found.orderId, no: found.no } : null
})
if (!inv) {
  failures.push('ไม่มีใบกำกับภาษีในข้อมูลจำลองสำหรับทดสอบการพิมพ์ A4')
} else {
  await settle(`/admin/orders/${inv.orderId}`)
  await page.getByRole('button', { name: 'ใบกำกับภาษีเต็มรูป', exact: true }).click()
  await page.getByRole('dialog').getByText(inv.no).first().waitFor({ timeout: 15000 })
  await resetPrintState()
  await page.emulateMedia({ media: 'print' })
  await clickText('พิมพ์', true)
  await page.waitForTimeout(400)
  got = await prints()
  expect(got.length === 1, `พิมพ์ใบกำกับ A4 ควรเรียก window.print 1 ครั้ง แต่ได้ ${got.length}`)
  if (got[0]) {
    expect(got[0].body.includes('print-a4'), 'ตอนพิมพ์ใบกำกับต้องมี class print-a4 ที่ body')
    expect(got[0].rootDisplay === 'block' && got[0].rootVisibility === 'visible' && got[0].rootHeight > 0, `ใบกำกับ A4 ว่าง (display=${got[0].rootDisplay}, visibility=${got[0].rootVisibility}, สูง=${got[0].rootHeight})`)
    expect(got[0].rootText.includes(inv.no), 'เนื้อหาที่พิมพ์ของใบกำกับ A4 ไม่มีเลขที่ใบกำกับ')
    expect(got[0].appDisplay === 'none', 'ตอนพิมพ์ใบกำกับ A4 ส่วนของแอปต้องซ่อน')
  }
  await page.evaluate(() => document.body.classList.remove('print-a4'))
  await page.emulateMedia({ media: 'screen' })
}

// ---------- 5) ภาพใบทดสอบ: 58 มม. = 48 ไบต์ต่อแถว · 80 มม. = 72 ไบต์ต่อแถว · 88 มม. ไม่รองรับ ----------
const raster = await page.evaluate(async () => {
  const { buildTestBytes } = await import('/src/lib/receiptRaster.js')
  const bytesPerRow = async (w) => {
    const b = await buildTestBytes(w, 'ทดสอบ')
    for (let i = 0; i + 5 < b.length; i++) if (b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30 && b[i + 3] === 0) return b[i + 4] + 256 * b[i + 5]
    return -1
  }
  let err88 = ''
  try { await buildTestBytes(88) } catch (e) { err88 = e.message }
  return { b58: await bytesPerRow(58), b80: await bytesPerRow(80), err88 }
})
expect(raster.b58 === 48, `ใบทดสอบ 58 มม. ควรได้ 48 ไบต์ต่อแถว (ได้ ${raster.b58})`)
expect(raster.b80 === 72, `ใบทดสอบ 80 มม. ควรได้ 72 ไบต์ต่อแถว (ได้ ${raster.b80})`)
expect(/ไม่รองรับ/.test(raster.err88), '88 มม. ต้องไม่รองรับ (โยน error)')

// ---------- 6) โหมดแอป (จำลอง Android): หน้าการพิมพ์แสดงแถวเครื่องพิมพ์ · เมนู 'เครื่องพิมพ์/จอ' ใน POS แสดงทั้ง 3 ส่วน ----------
const appCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await appCtx.addInitScript(() => { window.CapacitorCustomPlatform = { name: 'android' } })
const app = await appCtx.newPage()
const appErrors = []
app.on('pageerror', (e) => appErrors.push(e.message))
await app.goto(`${base}/#/admin/no-access`, { waitUntil: 'domcontentloaded' })
await app.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
await app.evaluate(() => { location.hash = '/admin/settings/printing' })
await app.getByText('ใช้เครื่องเดียวกับใบเสร็จขาย').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => failures.push('หน้าการพิมพ์ในแอปไม่แสดงแถวเลือกเครื่องพิมพ์'))
await app.evaluate(() => { location.hash = '/admin/pos' })
await app.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
await app.getByRole('button', { name: 'เครื่องพิมพ์/จอ', exact: true }).click()
await app.getByText('จอแสดงให้ลูกค้า').waitFor({ timeout: 15000 }).catch(() => failures.push('เมนูเครื่องพิมพ์/จอใน POS ไม่แสดงหัวข้อจอลูกค้า'))
expect((await app.getByText('ใบเสร็จขาย POS').count()) > 0 && (await app.getByText('ใบกำกับ / ใบลดหนี้').count()) > 0, 'เมนูเครื่องพิมพ์/จอใน POS ควรแสดงส่วนการพิมพ์ครบ')
expect(appErrors.length === 0, `หน้าในโหมดแอปมีข้อผิดพลาด: ${appErrors.join(' | ')}`)

expect(pageErrors.length === 0, `มีข้อผิดพลาดในหน้า: ${pageErrors.join(' | ')}`)

await browser.close()
await server.close()
if (failures.length) {
  console.log('✗ printing.ui.e2e')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('✓ printing.ui.e2e: หน้าตั้งค่า 3 แท็บ · ความกว้างต่อเครื่อง · แผ่นทดสอบ 58 มม. และ A4 · ใบกำกับ A4 ไม่ว่าง · โหมดแอปแสดงแถวเครื่องพิมพ์')
