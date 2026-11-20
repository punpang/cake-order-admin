// ทดสอบหน้าจอจริง (Playwright + Chromium) ของการสร้างคูปองจากคะแนนบนหน้าสมาชิก โหมดจำลอง (ไม่มีเซิร์ฟเวอร์)
// ครอบคลุม: กรอก/กดมูลค่า 20 บาท → คะแนนถูกหัก → คูปองขึ้นในแท็บคูปองพร้อมป้ายที่มา · มูลค่า 15 บาทกดไม่ได้
// รัน: node e2e/pointsCoupon.ui.e2e.mjs
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

async function openPage(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  return { page, errors }
}

t('ลูกค้าสร้างคูปอง 20 บาทจากคะแนน: คะแนนถูกหัก และคูปองขึ้นในแท็บคูปอง', async () => {
  const { page, errors } = await openPage('/admin/settings/customers')
  try {
    await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
    const ok = await page.evaluate(() => {
      const S = window.__store
      const all = S.db.customers
      const c = all.find((x) => !x.deleted && x.active !== false && all.filter((o) => o.name.includes(x.name)).length === 1)
      if (!c) return false
      for (const k of S.needsConsent(c.id)) S.db.consents.push({ id: 'e2e-pc-' + k + c.id, customerId: c.id, kind: k, version: S.db.legal.docs[k].version, detail: null, at: new Date().toISOString(), via: 'e2e' })
      if (S.needsConsent(c.id).length) return false
      S.db.loyalty.pointValue = 1
      c.ledger = [{ id: 'e2e-pc-lot', at: new Date().toISOString(), delta: 200, reason: 'ทดสอบ', orderId: null, remaining: 200 }]
      S.customerSession.customerId = c.id
      return true
    })
    assert.ok(ok, 'ไม่มีลูกค้าสำหรับทดสอบ')
    await page.evaluate(() => { window.location.hash = '#/account' })
    await page.getByRole('button', { name: 'คะแนน', exact: true }).click()
    await page.getByRole('button', { name: 'แลกของ', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'แลกของ', exact: true }).click()

    const card = page.locator('.card').filter({ hasText: 'สร้างคูปองจากคะแนน' }).first()
    await card.waitFor({ state: 'visible' })
    await card.getByRole('button', { name: '20 บาท', exact: true }).click()
    await card.getByRole('button', { name: /^สร้างคูปอง/ }).click()
    await page.getByText('ใช้ได้ภายใน 15 วัน').waitFor({ state: 'visible', timeout: 10000 })

    const left = await page.evaluate(() => {
      const S = window.__store
      const c = S.db.customers.find((x) => x.ledger && x.ledger.some((e) => e.id === 'e2e-pc-lot'))
      return S.customerPoints(c)
    })
    assert.equal(left, 180, 'คะแนนไม่ถูกหักตามมูลค่า')

    await page.getByRole('button', { name: 'คูปอง', exact: true }).click()
    const coupon = page.locator('.card').filter({ hasText: 'คูปองจากคะแนน 20 บาท' }).first()
    await coupon.waitFor({ state: 'visible' })
    assert.match(await coupon.innerText(), /สร้างเองจากคะแนน/, 'ป้ายที่มาของคูปองไม่ถูกต้อง')

    // มูลค่า 15 บาทไม่ลงตัว (ขั้นต่ำ 10 ทวีคูณ 10): ปุ่มกดไม่ได้และแสดงเหตุผล
    await page.getByRole('button', { name: 'แลกของ', exact: true }).click()
    const card2 = page.locator('.card').filter({ hasText: 'สร้างคูปองจากคะแนน' }).first()
    await card2.getByLabel('มูลค่าคูปอง (บาท)').fill('15')
    await card2.getByText('มูลค่าต้องเป็นทวีคูณของ 10 บาท').waitFor({ state: 'visible' })
    assert.equal(await card2.getByRole('button', { name: /^สร้างคูปอง/ }).isDisabled(), true)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

for (const [name, fn] of cases) {
  try { await fn(); console.log('PASS', name) } catch (e) { fails++; console.log('FAIL', name, '—', String(e.message).split('\n')[0]) }
}
await browser.close()
await server.close()
console.log(fails ? `\nไม่ผ่าน ${fails} ข้อ` : `\nผ่านทั้งหมด ${cases.length} ข้อ`)
process.exitCode = fails ? 1 : 0
