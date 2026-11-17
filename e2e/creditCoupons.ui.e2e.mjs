// ทดสอบหน้าจอจริงในเบราว์เซอร์ (Playwright + Chromium) กับเซิร์ฟเวอร์ dev ของ Vite และข้อมูลจำลองในหน่วยความจำ
// ครอบคลุม 2 ข้อที่ค้างจากเทสต์คูปองคืนเงิน: (1) พนักงานขายไม่เห็นปุ่มแปลงคะแนนเป็นคูปอง (2) บัญชีลูกค้าแสดงคูปองคืนเงินที่ไม่มีวันหมดอายุ
// ตั้งค่าสถานะผ่านโมดูล store เดียวกับที่แอปใช้ (import('/src/data/store.js') ในหน้าเว็บ) · รัน: npm run test:e2e
// ต้องมี Chromium ของ Playwright (ตามตัวแปร PLAYWRIGHT_BROWSERS_PATH หรือค่าเริ่มต้นของ Playwright)
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

// เปิดหน้าใหม่ รอให้ข้อมูลจำลองโหลดเสร็จ (ข้อความ "กำลังเตรียมข้อมูล" หายไป) และเก็บข้อผิดพลาดที่หน้าเว็บโยนออกมา
async function openPage(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  return { page, errors }
}

t('พนักงานขายเปิดแก้ลูกค้าได้แต่ไม่เห็นปุ่มแปลงคะแนนเป็นคูปอง (แอดมินเห็น)', async () => {
  const { page, errors } = await openPage('/admin/settings/customers')
  try {
    await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
    const cust = await page.evaluate(async () => {
      const S = window.__store
      const c = (() => { const all = window.__store.db.customers; return all.find((x) => !x.deleted && x.active !== false && all.filter((o) => o.name.includes(x.name)).length === 1) })()
      if (!c) return null
      const r = S.adjustPoints(c.id, 200, 'ทดสอบหน้าจอ')
      if (r.error) return { error: r.error }
      return { id: c.id, name: c.name }
    })
    assert.ok(cust && !cust.error, `เตรียมลูกค้าไม่ได้: ${cust?.error || 'ไม่มีลูกค้า'}`)

    // ตัวควบคุม: ในฐานะแอดมิน ปุ่มแปลงคะแนนต้องแสดง
    await page.locator('button.card').filter({ hasText: cust.name }).first().click()
    await page.getByText('คะแนนคงเหลือ', { exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'แปลงเป็นคูปอง', exact: true }).waitFor({ state: 'visible' })

    // สลับเป็นผู้ใช้ที่เปิดหน้าลูกค้าได้ (manage) แต่ไม่มีสิทธิ์ปรับคะแนน (adjustPoints) · โมดัลยังเปิดอยู่
    // หมายเหตุ: พนักงานขายตามบทบาทเดิมไม่มี manage จึงเปิดหน้านี้ไม่ได้เลย ผู้ใช้ทดสอบนี้คือกรณีที่ปุ่มต้องถูกซ่อนจริง
    await page.evaluate(() => {
      const S = window.__store
      S.db.users.push({ id: 'e2e-manager', name: 'ผู้จัดการทดสอบ', email: 'e2e-manager@example.com', role: 'sales', active: true, perms: ['manage', 'viewAllOrders', 'useLoyalty'] })
      S.switchUser('e2e-manager')
    })
    assert.equal(await page.evaluate(() => window.__store.can('adjustPoints')), false)
    assert.equal(await page.evaluate(() => window.__store.can('manage')), true)
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'แปลงเป็นคูปอง'), null, { timeout: 5000 })
    assert.equal(await page.getByText('คะแนนคงเหลือ', { exact: true }).isVisible(), true, 'ส่วนคะแนนหายไปด้วย (ควรยังแสดงให้ผู้ใช้เห็นยอดคะแนน)')

    // แม้เรียกจากโค้ด พนักงานขายก็แปลงไม่ได้
    const denied = await page.evaluate(async (id) => (await window.__store.convertPointsRemote(id)).error, cust.id)
    assert.equal(denied, 'ไม่มีสิทธิ์แปลงคะแนน')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('บัญชีลูกค้าแสดงคูปองคืนเงินโดยไม่มีวันที่หมดอายุ (คูปองแบบมีวันหมดอายุแสดงวันหมดอายุ)', async () => {
  const { page, errors } = await openPage('/admin/settings/customers')
  try {
    await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
    const info = await page.evaluate(() => {
      const S = window.__store
      const c = (() => { const all = window.__store.db.customers; return all.find((x) => !x.deleted && x.active !== false && all.filter((o) => o.name.includes(x.name)).length === 1) })()
      if (!c) return null
      // ลูกค้าตัวอย่างยังไม่ได้ยอมรับเอกสาร → บันทึกการยอมรับให้ครบ (เหมือนที่หน้ายินยอมบันทึก) เพื่อไม่ให้ถูกพาไปหน้ายินยอม
      for (const k of S.needsConsent(c.id)) S.db.consents.push({ id: 'e2e-cs-' + k + c.id, customerId: c.id, kind: k, version: S.db.legal.docs[k].version, detail: null, at: new Date().toISOString(), via: 'e2e' })
      if (S.needsConsent(c.id).length) return null
      S.db.coupons.unshift(
        { id: 'e2e-credit', customerId: c.id, type: 'discount', mode: 'credit', name: 'คูปองคืนเงินทดสอบ', amount: 75, balance: 75, holds: {}, status: 'pending', expiresAt: null, activatedUntil: null, source: 'refund', createdAt: new Date().toISOString() },
        { id: 'e2e-fixed', customerId: c.id, type: 'discount', mode: 'fixed', name: 'คูปองลดทดสอบ', amount: 50, minSpend: 0, status: 'pending', expiresAt: '2099-12-31', activatedUntil: null, source: 'redeem', createdAt: new Date().toISOString() },
      )
      S.customerSession.customerId = c.id
      return { name: c.name }
    })
    assert.ok(info, 'ไม่มีลูกค้าสำหรับทดสอบ')
    // ตั้งค่าเซสชันลูกค้าก่อนเปิดหน้าบัญชี (ไม่งั้นการ์ดป้องกันหน้าจะส่งกลับไปหน้าล็อกอิน)
    await page.evaluate(() => { window.location.hash = '#/account' })
    // คูปองอยู่ในแท็บ "คะแนน" ของหน้าบัญชี (แท็บย่อย "คูปอง")
    await page.getByRole('button', { name: 'คะแนน', exact: true }).click()
    await page.getByRole('button', { name: 'คูปอง', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'คูปอง', exact: true }).click()

    const cardOf = (name) => page.locator('.card').filter({ hasText: name }).first()
    await cardOf('คูปองคืนเงินทดสอบ').waitFor({ state: 'visible' })
    const credit = await cardOf('คูปองคืนเงินทดสอบ').innerText()
    assert.match(credit, /ยอดคงเหลือ/, 'คูปองคืนเงินไม่แสดงยอดคงเหลือ')
    assert.doesNotMatch(credit, /หมดอายุ/, 'คูปองคืนเงินแสดงวันหมดอายุทั้งที่ไม่มี')
    // ป้ายต้นทางของคูปองที่ออกจากการคืนเงินต้องเป็น "คืนเงิน" (ไม่ใช่ "แลกคะแนน")
    assert.match(credit, /·\s*คืนเงิน/, 'ป้ายต้นทางของคูปองคืนเงินไม่ถูกต้อง')

    // ตัวควบคุม: คูปองแบบมีวันหมดอายุต้องแสดงคำว่าหมดอายุ และคูปองแลกคะแนนยังแสดง "แลกคะแนน"
    const fixed = await cardOf('คูปองลดทดสอบ').innerText()
    assert.match(fixed, /หมดอายุ/, 'คูปองที่มีวันหมดอายุไม่แสดงวันหมดอายุ')
    assert.match(fixed, /·\s*แลกคะแนน/, 'ป้ายต้นทางของคูปองแลกคะแนนเปลี่ยนไป')
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
