// ทดสอบหน้าแรกร้าน (/#/) ตามแผนแก้ไข: แถบคุกกี้เตี้ยและไม่บังปุ่มหลัก · ปุ่มยอมรับ/ปฏิเสธขนาดเท่ากัน ·
// หัวข้อ hero ไม่เหลือคำเดียวบรรทัดสุดท้าย · ไม่แสดงที่อยู่ตัวอย่าง
// ถ่ายภาพไว้ที่ HOME_SHOTS (ถ้าตั้งค่า) เพื่อเทียบก่อน/หลัง · รัน: node e2e/storeHome.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.HOME_SHOTS || ''
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const cases = []
const t = (name, fn) => cases.push([name, fn])
let fails = 0
const W = { width: 1280, height: 800 }
const M = { width: 390, height: 844 }

async function openHome(viewport) {
  const mobile = viewport.width < 500
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
  return { page, errors }
}
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }) } }
const banner = (page) => page.locator('section[aria-label="การตั้งค่าคุกกี้"]')

t('[1280] แถบคุกกี้เตี้ย และไม่บังปุ่มหลักของ hero', async () => {
  const { page, errors } = await openHome(W)
  try {
    await banner(page).waitFor()
    await shot(page, 'home-1280-cookie')
    const b = await banner(page).boundingBox()
    assert.ok(b.height <= 80, `แถบคุกกี้สูง ${Math.round(b.height)}px (เป้า ≤ 80px)`)
    const hero = await page.locator('h1').boundingBox()
    assert.ok(hero.y + hero.height <= b.y, 'แถบคุกกี้ต้องไม่ทับหัวข้อ hero')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('[1280/390] ปุ่มยอมรับและปฏิเสธขนาดเท่ากัน', async () => {
  for (const vp of [W, M]) {
    const { page, errors } = await openHome(vp)
    try {
      await banner(page).waitFor()
      const acc = await page.getByRole('button', { name: 'ยอมรับทั้งหมด', exact: true }).boundingBox()
      const rej = await page.getByRole('button', { name: 'ปฏิเสธ', exact: true }).boundingBox()
      assert.ok(acc && rej, 'ต้องมีปุ่มยอมรับและปฏิเสธ')
      assert.ok(Math.abs(acc.width - rej.width) <= 1, `กว้างไม่เท่า ${Math.round(acc.width)} vs ${Math.round(rej.width)} (${vp.width}px)`)
      assert.ok(Math.abs(acc.height - rej.height) <= 1, `สูงไม่เท่า ${Math.round(acc.height)} vs ${Math.round(rej.height)} (${vp.width}px)`)
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  }
})

t('[1280] หัวข้อ hero ไม่เหลือบรรทัดสุดท้ายที่สั้นเกินไป', async () => {
  const { page, errors } = await openHome(W)
  try {
    const lines = await page.evaluate(() => {
      const h = document.querySelector('h1')
      const r = document.createRange(); r.selectNodeContents(h)
      const rects = [...r.getClientRects()].filter((x) => x.width > 0)
      const byTop = new Map()
      for (const x of rects) { const k = Math.round(x.top); byTop.set(k, (byTop.get(k) || 0) + x.width) }
      return [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => Math.round(w))
    })
    if (lines.length > 1) {
      const last = lines[lines.length - 1]
      const first = lines[0]
      assert.ok(last >= first * 0.35, `บรรทัดสุดท้ายสั้นเกินไป (${last}px เทียบกับ ${first}px)`)
    }
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('[1280] ไม่แสดงที่อยู่ตัวอย่าง "ที่อยู่ร้าน (ตัวอย่าง)" ในหน้าแรก', async () => {
  const { page, errors } = await openHome(W)
  try {
    const text = await page.evaluate(() => document.body.innerText)
    assert.ok(!text.includes('ที่อยู่ร้าน (ตัวอย่าง)'), 'ยังแสดงที่อยู่ตัวอย่างบนหน้า')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('[1280] ไม่มีหัวข้อ "ติดต่อ" ว่างเมื่อยังไม่มีข้อมูลติดต่อจริง และแสดงเมื่อมีเบอร์', async () => {
  const { page, errors } = await openHome(W)
  try {
    const footerHasContact = () => page.evaluate(() => [...document.querySelectorAll('footer div, footer p, footer *')].some((e) => e.childElementCount === 0 && e.textContent.trim() === 'ติดต่อ'))
    assert.equal(await footerHasContact(), false, 'หัวข้อ "ติดต่อ" ว่างยังแสดงอยู่')
    await page.evaluate(async () => { const S = await import('/src/data/store.js'); S.db.storefront.phone = '0812345678' })
    await page.waitForTimeout(300)
    assert.equal(await footerHasContact(), true, 'ต้องแสดงหัวข้อ "ติดต่อ" เมื่อมีเบอร์')
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
