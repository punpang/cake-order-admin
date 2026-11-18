// ทดสอบเส้นทางหลักของผู้ใช้จริงในเบราว์เซอร์ (Playwright + Chromium) กับเซิร์ฟเวอร์ dev ของ Vite และข้อมูลจำลองในหน่วยความจำ
// 3 เส้นทาง:
//   (1) POS: ขายเงินสด → คืนเงินเต็มจำนวนจากหน้าบิล (ตรวจยอดและประวัติในข้อมูลจริง)
//   (2) ลูกค้า: สมัครด้วยเบอร์ + OTP (ผิดก่อนแล้วถูก) → ตั้ง PIN → ออกจากระบบ → เข้าสู่ระบบด้วย PIN (ผิดก่อนแล้วถูก)
//   (3) ลูกค้า: เข้าบัญชีเบอร์ที่มีออร์เดอร์รอชำระ → เปิดการชำระเงิน → แนบสลิป → ร้านได้รับเป็น "รอตรวจสอบ"
// หมายเหตุ: หน้าเว็บลูกค้าไม่มีตะกร้า การสั่งทำผ่านแชท/ใบเสนอ เส้นทาง "ชำระ" ของลูกค้าคือหน้าออร์เดอร์ในบัญชี จึงทดสอบส่วนนั้น
// รัน: npm run test:e2e (หรือ node e2e/flows.ui.e2e.mjs)
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

// สลิปจำลอง: PNG 2x2 ที่ถูกต้อง (เขียนไฟล์จริงเพื่อแนบผ่าน input type=file)
function makePng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const slipPath = join(mkdtempSync(join(tmpdir(), 'slip-')), 'slip.png')
writeFileSync(slipPath, makePng())

const cases = []
const t = (name, fn) => cases.push([name, fn])

// เปิดหน้าใหม่ (ข้อมูลจำลองใหม่ทุกครั้ง) รอให้โหลดเสร็จ และเก็บข้อผิดพลาดที่หน้าเว็บโยนออกมา
async function openPage(hash, { admin = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors }
}
const storeOf = (page, fn, arg) => page.evaluate(fn, arg)

t('POS: ขายเงินสดหนึ่งชิ้น แล้วคืนเงินเต็มจำนวนจากหน้าบิล', async () => {
  const { page, errors } = await openPage('/admin/pos')
  try {
    const before = await storeOf(page, () => window.__store.db.orders.filter((o) => o.channel === 'pos').length)
    await page.getByRole('button', { name: /คัพเค้กวานิลลา/ }).first().click()
    await page.getByRole('button', { name: 'ชำระเงิน', exact: true }).first().click()
    await page.getByRole('button', { name: 'เงินสด', exact: true }).first().click()
    await page.getByRole('button', { name: 'พอดี', exact: true }).first().click()
    await page.getByRole('button', { name: 'ยืนยันรับเงิน', exact: true }).first().click()
    await page.waitForFunction((n) => window.__store.db.orders.filter((o) => o.channel === 'pos').length === n + 1, before, { timeout: 10000 })

    const sale = await storeOf(page, () => {
      const o = window.__store.db.orders.filter((x) => x.channel === 'pos').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
      return { code: o.code, total: o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0), names: o.items.map((i) => i.name), paid: o.payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0) }
    })
    assert.ok(sale.names.some((n) => n.includes('คัพเค้กวานิลลา')), `ไม่มีสินค้าที่ขายในบิล: ${sale.names}`)
    assert.equal(sale.paid, sale.total, 'ยอดที่รับชำระไม่เท่ายอดบิล')

    // คืนเงินเต็มจำนวนจากหน้าบิล
    await page.goto(`${base}/#/admin/pos/bills`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.locator('#pb-q').fill(sale.code)
    await page.getByText(sale.code, { exact: false }).first().click()
    await page.getByRole('button', { name: 'คืนเงิน', exact: true }).first().click()
    await page.getByRole('button', { name: 'คืนเต็มจำนวน', exact: true }).first().click()
    await page.locator('#rf-reason').fill('ลูกค้าเปลี่ยนใจ (ทดสอบ e2e)')
    await page.getByRole('button', { name: 'ยืนยันคืนเงิน', exact: true }).click()
    await page.waitForFunction((code) => (window.__store.db.orders.find((o) => o.code === code)?.returns || []).length > 0, sale.code, { timeout: 10000 })

    const refund = await storeOf(page, (code) => {
      const o = window.__store.db.orders.find((x) => x.code === code)
      return { amount: o.returns.reduce((s, r) => s + Number(r.amount || 0), 0), reason: o.returns.map((r) => r.reason || '').join('|') }
    }, sale.code)
    assert.equal(refund.amount, sale.total, 'ยอดคืนไม่เท่ายอดบิล')
    assert.match(refund.reason, /ลูกค้าเปลี่ยนใจ/)
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally {
    await page.close()
  }
})

t('ลูกค้า: สมัครด้วยเบอร์ + OTP (รหัสผิดก่อน) → ตั้ง PIN → ออกจากระบบ → เข้าสู่ระบบด้วย PIN (ผิดก่อน)', async () => {
  const PHONE = '0899990001'
  const { page, errors } = await openPage('/account/register')
  try {
    await page.locator('input[type=tel]').first().fill(PHONE)
    await page.getByRole('button', { name: 'ขอรหัสยืนยัน (OTP)' }).click()
    await page.locator('#otp-code').waitFor({ state: 'visible' })
    const code = await storeOf(page, () => window.__store.db.otps.at(-1).code)

    // รหัสผิด → ข้อความและยังอยู่ขั้นที่ 2
    const wrong = code === '000000' ? '111111' : '000000'
    await page.locator('#otp-code').fill(wrong)
    await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    await page.getByText(/รหัสไม่ถูกต้อง \(เหลือ \d+ ครั้ง\)/).waitFor({ state: 'visible' })

    // รหัสถูก → ขั้นที่ 3: ชื่อ (เบอร์ใหม่), ตั้ง PIN, ยอมรับเงื่อนไข
    await page.locator('#otp-code').fill(code)
    await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    await page.locator('input[autocomplete="name"]').waitFor({ state: 'visible' })
    await page.locator('input[autocomplete="name"]').fill('ลูกค้า e2e ใหม่')
    await page.locator('input[type=password]').nth(0).fill('246810')
    await page.locator('input[type=password]').nth(1).fill('246810')
    await page.locator('input[type=checkbox]').check()
    await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click()
    await page.waitForURL(/#\/account$/, { timeout: 10000 })

    assert.equal(await storeOf(page, () => window.__store.db.customerAccounts.length), 1, 'ยังไม่มีบัญชีลูกค้าเกิดขึ้น')

    // ออกจากระบบ แล้วเข้าสู่ระบบด้วย PIN ผิดก่อน
    await page.getByRole('button', { name: 'ออกจากระบบ' }).first().click()
    await page.goto(`${base}/#/account/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.locator('input[type=tel]').first().fill(PHONE)
    await page.locator('input[type=password]').first().fill('135790')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByText('เบอร์โทรหรือ PIN ไม่ถูกต้อง (เหลือ 4 ครั้ง)').waitFor({ state: 'visible' })

    // PIN ถูก → เข้าบัญชีได้
    await page.locator('input[type=password]').first().fill('246810')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.waitForURL(/#\/account$/, { timeout: 10000 })
    await page.getByRole('button', { name: 'ออกจากระบบ' }).first().waitFor({ state: 'visible' })
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally {
    await page.close()
  }
})

t('ลูกค้า: เข้าบัญชีที่มีออร์เดอร์รอชำระ → แนบสลิปแจ้งชำระ → ร้านได้รับเป็นรอตรวจสอบ', async () => {
  const PHONE = '0891112233'
  const { page, errors } = await openPage('/account/register')
  try {
    // เตรียมลูกค้าและออร์เดอร์รอชำระ (คัดลอกโครงสร้างสินค้าจากออร์เดอร์ตัวอย่างที่มีอยู่)
    const seeded = await storeOf(page, (phone) => {
      const S = window.__store
      const tpl = S.db.orders.find((o) => o.customerId && o.channel !== 'pos' && o.status === 'awaiting_payment')
      const c = S.addCustomer({ name: 'ลูกค้าทดสอบชำระเงิน', phone, note: 'e2e' })
      const d = JSON.parse(JSON.stringify(tpl))
      const r = S.createOrder({ customerId: c.id, pickupAt: '2026-12-20T10:00', fulfillment: 'pickup', items: d.items, vat: d.vat, promoOn: false, quoteItems: true, shipPromo: null, birthday: null }, false)
      return r.error ? { error: r.error } : { id: r.id || r.order?.id }
    }, PHONE)
    assert.ok(!seeded.error, `สร้างออร์เดอร์ตัวอย่างไม่ได้: ${seeded.error}`)
    const orderId = seeded.id

    // เข้าสู่ระบบด้วยเบอร์นี้ (ลูกค้าเดิม ไม่ต้องกรอกชื่อ)
    await page.locator('input[type=tel]').first().fill(PHONE)
    await page.getByRole('button', { name: 'ขอรหัสยืนยัน (OTP)' }).click()
    await page.locator('#otp-code').waitFor({ state: 'visible' })
    await page.locator('#otp-code').fill(await storeOf(page, () => window.__store.db.otps.at(-1).code))
    await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    await page.locator('input[type=password]').nth(0).waitFor({ state: 'visible' })
    await page.locator('input[type=password]').nth(0).fill('246810')
    await page.locator('input[type=password]').nth(1).fill('246810')
    await page.locator('input[type=checkbox]').check()
    await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click()
    await page.waitForURL(/#\/account$/, { timeout: 10000 })

    // หน้าออร์เดอร์ → การชำระเงิน
    await page.goto(`${base}/#/account/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.getByRole('button', { name: 'ยอมรับทั้งหมด' }).click({ timeout: 2000 }).catch(() => {})
    await page.getByRole('button', { name: 'ชำระเงิน', exact: true }).first().click()
    await page.locator('input[type=file]').setInputFiles(slipPath)
    await page.getByRole('button', { name: 'ส่งสลิปแจ้งชำระ' }).click()

    await page.waitForFunction((id) => (window.__store.db.orders.find((o) => o.id === id)?.payments || []).some((p) => p.customerSubmitted), orderId, { timeout: 15000 })
    const r = await storeOf(page, (id) => {
      const o = window.__store.db.orders.find((x) => x.id === id)
      const p = o.payments.find((x) => x.customerSubmitted)
      return { status: o.status, pStatus: p?.status, slip: !!p?.slip, amount: p?.amount, total: o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0) }
    }, orderId)
    assert.equal(r.status, 'payment_reported', `สถานะออร์เดอร์ควรเป็นรอตรวจสอบ ได้ ${r.status}`)
    assert.equal(r.pStatus, 'reported')
    assert.equal(r.slip, true, 'ไม่มีสลิปแนบในรายการชำระ')
    assert.ok(r.amount > 0 && r.amount <= r.total, `ยอดแจ้งชำระไม่ถูกต้อง ${r.amount}`)
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally {
    await page.close()
  }
})

let fails = 0
for (const [name, fn] of cases) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    fails++
    console.log(`FAIL ${name}\n  ${String(e?.message || e).split('\n').slice(0, 6).join('\n  ')}`)
  }
}
await browser.close()
await server.close()
console.log(`\nรวม ${cases.length} เส้นทาง · ผ่าน ${cases.length - fails} · ไม่ผ่าน ${fails}`)
process.exitCode = fails ? 1 : 0
