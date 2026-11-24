// ทดสอบการจัดวางและป้ายของหน้า POS (/admin/pos) ตามรายการ 19 ข้อที่ตกลงกัน
// ตรวจ: การ์ดลูกค้าอยู่บนสุดแต่สินค้ายังกดได้ · ป้าย "ลูกค้าทั่วไป"/"บัตร" · สินค้าหมดมีคำอธิบาย ·
// หมวดเรียงชื่อ · ตะกร้ามือถือไม่บังหัวจอ · โปรที่ใกล้ถึงยุบได้ · QR ไม่ทับแท็บและไม่ล้น ·
// ยืนยันยกเลิกบิลเด่น · เหตุผลคืนเงินอยู่เหนือรายการ · ปุ่มคืนเงิน ≥ 44px · ปิดกะมีคำแนะนำ · จุดกระดิ่งมีคำอธิบาย
// ถ่ายภาพไว้ที่ POS_SHOTS (ถ้าตั้งค่า) เพื่อเทียบก่อน/หลัง · รัน: node e2e/posLayout.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.POS_SHOTS || ''
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const W = { width: 1280, height: 800 }
const M = { width: 390, height: 844 }
const cases = []
const t = (name, fn) => cases.push([name, fn])
let fails = 0

async function openPos(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/pos`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForTimeout(300)
  return { page, errors }
}
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }) } }
// คลิกปุ่มที่มองเห็นและกดได้ตามข้อความ (exact = ข้อความเท่ากันทุกตัว)
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
const rectOf = (page, sel) => page.locator(sel).first().boundingBox()
const textRect = (page, text) => page.evaluate((text) => {
  const el = [...document.querySelectorAll('div,span,p,label,b,dt,dd,h1,h2,h3,button')].find((x) => x.offsetParent && x.childElementCount === 0 && x.textContent.trim() === text)
  if (!el) return null
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom }
}, text)

// 1) การ์ดลูกค้าอยู่บนสุด สินค้ายังเห็น · กดก่อนเลือกลูกค้าต้องมีข้อความบอก (ข้อ 1, 2)
t('[1280] การ์ดลูกค้าอยู่เหนือสินค้า · กดสินค้าก่อนเลือกลูกค้าได้ข้อความ', async () => {
  const { page, errors } = await openPos(W)
  try {
    await shot(page, 'pos-1-gate-1280')
    const gate = await rectOf(page, '[aria-label="เลือกลูกค้า"]')
    const card = await rectOf(page, 'button:has-text("฿")')
    assert.ok(gate && card, 'ต้องมีการ์ดลูกค้าและสินค้า')
    assert.ok(gate.y + gate.height <= card.y + 1, 'การ์ดลูกค้าต้องอยู่เหนือสินค้า')
    await addFirstProduct(page)
    await page.waitForTimeout(200)
    assert.equal(await page.getByText('เลือกลูกค้าหรือกด').isVisible(), true, 'กดสินค้าก่อนเลือกลูกค้าต้องมีข้อความบอก ไม่เงียบ')
    assert.match(await page.locator('aside').first().innerText(), /ตะกร้า\s*0\b/, 'ยังไม่เพิ่มลงตะกร้าก่อนเลือกลูกค้า')
    await clickBtn(page, 'ลูกค้าทั่วไป', true)
    await addFirstProduct(page)
    await page.waitForTimeout(200)
    assert.match(await page.locator('aside').first().innerText(), /ตะกร้า\s*1\b/, 'เลือกลูกค้าแล้วกดสินค้าได้')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 2) ป้ายลูกค้าทั่วไป (ข้อ 4) และไม่มีปุ่ม "ไม่มี" แล้ว
t('[390] ปุ่มเลือกลูกค้าทั่วไปชื่อ "ลูกค้าทั่วไป" (ไม่ใช่ "ไม่มี")', async () => {
  const { page, errors } = await openPos(M)
  try {
    assert.equal(await page.getByRole('button', { name: 'ลูกค้าทั่วไป', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'ไม่มี', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 3) สินค้าหมดมีคำอธิบาย (ข้อ 2)
t('[1280] สินค้าหมดแสดง "หมดแล้ว" และปุ่มกดไม่ได้', async () => {
  const { page, errors } = await openPos(W)
  try {
    const sold = page.locator('button:has-text("หมดแล้ว")').first()
    assert.ok(await sold.count(), 'ต้องมีสินค้าหมดในข้อมูลทดสอบ')
    assert.equal(await sold.isDisabled(), true)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 4) หมวดเรียงตามชื่อเมื่อไม่ได้กดเรียงขายดี (ข้อ 3)
t('[1280] สินค้าในหมวดเดียวกันเรียงตามชื่อ (ค่าเริ่มต้น)', async () => {
  const { page, errors } = await openPos(W)
  try {
    const chips = page.locator('button.chip')
    await chips.nth(1).click() // หมวดแรกหลัง "ทั้งหมด"
    await page.waitForTimeout(200)
    const names = await page.locator('button:has-text("฿")').evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent.trim() || '').filter((n) => n && !n.startsWith('ตะกร้า')))
    assert.ok(names.length >= 2, 'ต้องมีสินค้ามากกว่า 1 รายการในหมวด')
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'th'))
    assert.deepEqual(names, sorted, 'ชื่อสินค้าต้องเรียงตามตัวอักษร')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 5) ตะกร้ามือถือไม่บังหัวจอ และเปิดจากแถบล่าง (ข้อ 6, 8)
t('[390] ตะกร้าแบบ bottom sheet ไม่ทับส่วนหัว', async () => {
  const { page, errors } = await openPos(M)
  try {
    await clickBtn(page, 'ลูกค้าทั่วไป', true)
    await addFirstProduct(page)
    await page.waitForTimeout(200)
    await clickBtn(page, 'ตะกร้า')
    await page.waitForTimeout(300)
    await shot(page, 'pos-6-sheet-390')
    const head = await rectOf(page, '.head-safe')
    const sheet = await page.locator('aside').first().boundingBox()
    assert.ok(sheet && head, 'ต้องมีตะกร้าและส่วนหัว')
    assert.ok(sheet.y >= head.y + head.height - 1, `ตะกร้าเริ่มที่ ${sheet.y} แต่หัวจอสูงถึง ${head.y + head.height}`)
    assert.ok(sheet.y + sheet.height <= M.height + 1, 'ตะกร้าต้องไม่ล้นจอด้านล่าง')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 6) โปรที่ใกล้ถึงยุบได้ (ข้อ 9): ถ้ามีโปรใกล้ถึง ต้องมีแถบสรุปที่กดได้
t('[1280] กล่องโปรที่ใกล้ถึงมีปุ่มยุบ/ขยาย', async () => {
  const { page, errors } = await openPos(W)
  try {
    await clickBtn(page, 'ลูกค้าทั่วไป', true)
    await addFirstProduct(page)
    await page.waitForTimeout(300)
    const sum = page.locator('details summary:has-text("โปรที่ใกล้ถึง")')
    if (await sum.count()) {
      const det = page.locator('details:has(summary:has-text("โปรที่ใกล้ถึง"))')
      assert.equal(await det.evaluate((d) => d.open), true, 'เปิดไว้ตั้งต้น')
      await sum.click()
      assert.equal(await det.evaluate((d) => d.open), false, 'แตะแล้วต้องซ่อน')
    }
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 7) หน้าชำระ: แท็บ "บัตร" (ข้อ 5) และ QR ไม่ทับแท็บ (ข้อ 11) · สถานะบรรทัดเดียว (ข้อ 12)
t('[1280] แท็บชำระ "บัตร" และ QR รอลูกค้าไม่ทับแท็บ', async () => {
  const { page, errors } = await openPos(W)
  try {
    await clickBtn(page, 'ลูกค้าทั่วไป', true)
    await addFirstProduct(page)
    await clickBtn(page, 'ชำระเงิน', true)
    await page.waitForTimeout(400)
    assert.equal(await page.getByRole('button', { name: 'บัตร', exact: true }).count(), 1, 'ต้องมีแท็บ "บัตร"')
    assert.equal(await page.getByRole('button', { name: 'อื่น ๆ', exact: true }).count(), 0)
    await clickBtn(page, 'สร้าง QR')
    await page.waitForTimeout(800)
    await shot(page, 'pos-11-qr-1280')
    const tab = await rectOf(page, 'button:has-text("เงินสด")')
    const amount = await textRect(page, 'ยอดโอน')
    assert.ok(tab && amount, 'ต้องมีแท็บเงินสดและป้ายยอดโอน')
    assert.ok(amount.top >= tab.y + tab.height - 1, `ป้ายยอดโอนทับแท็บ (top ${amount.top} < ${tab.y + tab.height})`)
    const pill = await page.locator('text=รอลูกค้าโอน').first().evaluate((e) => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 20 }))
    assert.ok(pill.h <= pill.lh * 1.6, `สถานะ "รอลูกค้าโอน" ขึ้นหลายบรรทัด (สูง ${pill.h}px)`)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 8) มือถือ: ปุ่มยกเลิก QR ต้องอยู่เหนือแถบล่างของหน้าชำระ (ข้อ 7)
t('[390] ปุ่มในหน้า QR ไม่ถูกแถบล่างทับ', async () => {
  const { page, errors } = await openPos(M)
  try {
    await clickBtn(page, 'ลูกค้าทั่วไป', true)
    await addFirstProduct(page)
    await clickBtn(page, 'ตะกร้า')
    await page.waitForTimeout(200)
    await clickBtn(page, 'ชำระเงิน', true)
    await page.waitForTimeout(300)
    await clickBtn(page, 'สร้าง QR')
    await page.waitForTimeout(800)
    await shot(page, 'pos-7-qr-390')
    const cancelQr = await rectOf(page, 'button:has-text("ยกเลิก QR")')
    const footerCancel = page.getByRole('button', { name: 'ยกเลิก', exact: true }).last()
    const fb = await footerCancel.boundingBox()
    assert.ok(cancelQr && fb, 'ต้องมีปุ่มยกเลิก QR และปุ่มยกเลิกท้ายหน้า')
    assert.ok(cancelQr.y + cancelQr.height <= fb.y + 1, 'ปุ่มยกเลิก QR ถูกแถบล่างทับ')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 9) ยกเลิกบิล: ปุ่มยืนยันเด่นกว่า และปุ่มรองชื่อ "ไม่ยกเลิก" (ข้อ 13, 14)
t('[1280] กล่องยกเลิกบิล: ปุ่มยืนยันกว้างกว่าและปุ่มรองชื่อ "ไม่ยกเลิก"', async () => {
  const { page, errors } = await openPos(W)
  try {
    await clickBtn(page, 'บิล')
    await page.waitForTimeout(300)
    await page.locator('button[aria-label="ยกเลิกบิล"]').first().click()
    await page.waitForTimeout(300)
    await shot(page, 'pos-13-void-1280')
    const keep = await page.getByRole('button', { name: 'ไม่ยกเลิก', exact: true }).boundingBox()
    const ok = await page.getByRole('button', { name: 'ยืนยันยกเลิกบิล', exact: true }).boundingBox()
    assert.ok(keep && ok, 'ต้องมีปุ่มไม่ยกเลิกและยืนยันยกเลิกบิล')
    assert.ok(ok.width > keep.width, 'ปุ่มยืนยันต้องกว้างกว่าปุ่มรอง')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 10) คืนเงิน: เหตุผลอยู่เหนือรายการสินค้า (ข้อ 16) และปุ่ม +/− ≥ 44px (ข้อ 15)
t('[390] คืนเงิน: ช่องเหตุผลอยู่เหนือรายการสินค้า และปุ่ม +/− ≥ 44px', async () => {
  const { page, errors } = await openPos(M)
  try {
    await clickBtn(page, 'บิล')
    await page.waitForTimeout(300)
    await page.locator('button:text-is("คืนเงิน")').first().click()
    await page.waitForTimeout(300)
    await shot(page, 'pos-15-refund-390')
    const reason = await rectOf(page, '#rf-reason')
    const items = await textRect(page, 'สินค้าที่คืน (ไม่บังคับ)')
    assert.ok(reason && items, 'ต้องมีช่องเหตุผลและหัวข้อสินค้าที่คืน')
    assert.ok(reason.y < items.y, 'ช่องเหตุผลต้องอยู่เหนือสินค้าที่คืน')
    const plus = await rectOf(page, 'button[aria-label^="เพิ่มจำนวนคืน"]')
    assert.ok(plus && plus.width >= 44 && plus.height >= 44, `ปุ่ม + ขนาด ${plus?.width}×${plus?.height}`)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 11) ปิดกะ: ช่องไม่มี placeholder "0" และมีคำแนะนำจนกว่าจะกรอก (ข้อ 17, 18)
t('[1280] สรุปกะ: placeholder ไม่ใช่ "0" และมีคำแนะนำก่อนกรอก', async () => {
  const { page, errors } = await openPos(W)
  try {
    await clickBtn(page, 'สรุปกะ', true)
    await page.waitForTimeout(300)
    await shot(page, 'pos-18-shift-1280')
    assert.equal(await page.locator('input[placeholder="ระบุยอด"]').count(), 1)
    assert.equal(await page.locator('input[placeholder="0"]').count(), 0)
    assert.equal(await page.getByText('กรอกเงินสดที่นับได้ก่อน').isVisible(), true)
    await page.locator('input[placeholder="ระบุยอด"]').fill('100')
    await page.waitForTimeout(200)
    assert.equal(await page.getByText('กรอกเงินสดที่นับได้ก่อน').count(), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 13) เงินสดรับครบ: เหลือปุ่มเดียว "ยืนยันรับเงิน" (ข้อ 10) และปิดบิลได้จริง
t('[1280] เงินสดรับครบ → ไม่มีปุ่มบันทึกซ้ำ ยืนยันรับเงินปิดบิลได้', async () => {
  const { page, errors } = await openPos(W)
  try {
    await clickBtn(page, 'ลูกค้าทั่วไป', true)
    await addFirstProduct(page)
    await clickBtn(page, 'ชำระเงิน', true)
    await page.waitForTimeout(300)
    await clickBtn(page, 'เงินสด', true)
    await page.waitForTimeout(300)
    // ปุ่ม "พอดี" = ยอดเงินสดเท่ากับยอดที่ต้องชำระ
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && x.textContent.trim() === "พอดี" && !x.disabled)
      if (!b) throw new Error("ไม่พบปุ่ม พอดี")
      b.click()
    })
    await page.waitForTimeout(300)
    assert.equal(await page.getByRole('button', { name: 'บันทึกยอดเงินสดนี้', exact: true }).count(), 0, 'ไม่ควรมีปุ่มบันทึกซ้ำเมื่อรับครบ')
    assert.equal(await page.getByText('รับครบแล้ว').isVisible(), true)
    await shot(page, 'pos-10-cash-1280')
    await clickBtn(page, 'ยืนยันรับเงิน', true)
    await page.waitForTimeout(800)
    assert.equal(await page.getByText('ชำระครบแล้ว').first().isVisible(), true, 'ต้องขึ้นใบเสร็จ "ชำระครบแล้ว"')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 12) จุดกระดิ่งมีคำอธิบาย (ข้อ 19)
t('[1280] แผงแจ้งเตือนมีคำอธิบายจุดสี', async () => {
  const { page, errors } = await openPos(W)
  try {
    await page.locator('button[aria-label^="แจ้งเตือน"]').first().click()
    await page.waitForTimeout(300)
    assert.equal(await page.getByText('จุดสี = ยังไม่อ่าน').isVisible(), true)
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
