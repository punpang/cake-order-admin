// ทดสอบหน้าบัญชีลูกค้า (#/account): อักษรในวงกลมข้ามคำนำหน้า · ไม่มีเบอร์ซ้ำในหัวบัญชี ·
// รางวัลตัวอย่างไม่แสดงให้ลูกค้า · ปุ่มแลกที่คะแนนไม่พอบอกจำนวนที่ขาด · ไม่มีคำทักทายซ้ำในการ์ดคะแนน ·
// แท็บย่อยของคะแนนระบุแท็บที่เปิดอยู่ด้วย aria-current · รัน: node e2e/accountPolish.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const req = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
const { chromium } = req('playwright')
const { createServer } = await import(req.resolve('vite'))

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const cases = []
const t = (name, fn) => cases.push([name, fn])
let fails = 0

async function openAccount(viewport, { name = null, points = 10 } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  const ok = await page.evaluate(async ({ name, points }) => {
    const S = await import('/src/data/store.js')
    const all = S.db.customers
    const c = all.find((x) => !x.deleted && x.active !== false && all.filter((o) => o.name.includes(x.name)).length === 1)
    if (!c) return false
    for (const k of S.needsConsent(c.id)) S.db.consents.push({ id: 'e2e-ap-' + k + c.id, customerId: c.id, kind: k, version: S.db.legal.docs[k].version, detail: null, at: new Date().toISOString(), via: 'e2e' })
    if (S.needsConsent(c.id).length) return false
    if (name) c.name = name
    c.ledger = [{ id: 'e2e-ap-lot', at: new Date().toISOString(), delta: points, reason: 'ทดสอบ', orderId: null, remaining: points }]
    S.db.loyalty.pointValue = 1
    S.customerSession.customerId = c.id
    return true
  }, { name, points })
  assert.ok(ok, 'ไม่มีลูกค้าสำหรับทดสอบ')
  await page.evaluate(() => { window.location.hash = '#/account' })
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 })
  return { page, errors }
}

for (const [label, viewport] of [['1280', { width: 1280, height: 800 }], ['390', { width: 390, height: 844 }]]) {
  t(`[${label}] วงกลมชื่อข้ามคำนำหน้า: "คุณมะลิ" ได้ "ม"`, async () => {
    const { page, errors } = await openAccount(viewport, { name: 'คุณมะลิ ใจดี' })
    try {
      const initial = await page.locator('span.h-14.w-14').first().innerText()
      assert.equal(initial.trim(), 'ม')
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

t('[1280] หัวบัญชีไม่แสดงเบอร์ซ้ำ (เบอร์ยังอยู่ในการ์ดสมาชิก)', async () => {
  const { page, errors } = await openAccount({ width: 1280, height: 800 })
  try {
    const header = page.locator('section.card').first()
    const headerText = await header.innerText()
    assert.ok(!/\d{3}-\d{3}-\d{4}/.test(headerText), 'หัวบัญชียังแสดงเบอร์')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('[1280] แลกของ: ไม่มีรางวัลตัวอย่าง และแสดงจำนวนที่ขาดเมื่อคะแนนไม่พอ', async () => {
  const { page, errors } = await openAccount({ width: 1280, height: 800 }, { points: 10 })
  try {
    await page.getByRole('button', { name: 'คะแนน', exact: true }).click()
    await page.getByRole('button', { name: 'แลกของ', exact: true }).waitFor({ timeout: 10000 })
    const body = await page.locator('body').innerText()
    const sampleNames = await page.evaluate(async () => {
      const S = await import('/src/data/store.js')
      return S.db.rewards.filter((x) => /\(ตัวอย่าง\)/.test(x.name)).map((x) => x.name)
    })
    for (const n of sampleNames) assert.equal(await page.locator('.card', { hasText: n }).count(), 0, `ยังแสดงรางวัลตัวอย่าง: ${n}`)
    const expected = await page.evaluate(async () => {
      const S = await import('/src/data/store.js')
      const r = S.db.rewards.find((x) => x.active !== false && !/\(ตัวอย่าง\)/.test(x.name) && x.points > 10)
      return r ? { name: r.name, short: r.points - 10 } : null
    })
    assert.ok(expected, 'ไม่มีรางวัลสำหรับทดสอบ')
    assert.ok(body.includes(`ขาดอีก ${expected.short.toLocaleString('en-US')} คะแนน`), `ไม่เห็นข้อความขาดอีก ${expected.short}`)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('[1280] การ์ดคะแนนไม่มีคำทักทายซ้ำ และแท็บย่อยระบุสถานะได้', async () => {
  const { page, errors } = await openAccount({ width: 1280, height: 800 })
  try {
    await page.getByRole('button', { name: 'คะแนน', exact: true }).click()
    const card = page.locator('section.bg-linear-to-br').first()
    await card.waitFor({ timeout: 10000 })
    assert.ok(!(await card.innerText()).includes('สวัสดี'), 'การ์ดคะแนนยังมีคำทักทาย')
    const tabs = page.locator('[aria-label="เมนูคะแนน"] button')
    assert.equal(await tabs.count(), 4, 'แท็บย่อยต้องมี 4 แท็บ')
    assert.equal(await page.getByRole('button', { name: 'แลกของ', exact: true }).getAttribute('aria-current'), 'true')
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
