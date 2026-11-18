// ทดสอบว่าข้อความที่ลูกค้าพิมพ์ (ชื่อ แชท หมายเหตุสินค้า) ไม่ถูกรันเป็นโค้ดในหน้าหลังบ้าน
// วิธี: ใส่ payload ที่ควรทำงานถ้าไม่ escape ลงในข้อมูล แล้วเปิดหน้าที่แสดงข้อมูลนั้น
//   • ต้องไม่มี window.__xss ถูกตั้งค่า (สคริปต์ไม่ทำงาน) และไม่มีองค์ประกอบ <img src="x"> ที่ถูกสร้างขึ้นจริง
//   • ต้องแสดงข้อความดิบบนหน้าได้ (ยืนยันว่าหน้าแสดงข้อมูลนี้จริง ไม่ใช่ว่าซ่อนไปทั้งหมด)
// ตัวควบคุม: payload เดียวกันที่ถูกใส่ผ่าน innerHTML ต้องทำงาน (พิสูจน์ว่าการตรวจจับใช้ได้)
// รัน: node e2e/xss.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PAYLOAD = '<img src="x" onerror="window.__xss=1"><svg onload="window.__xss=1"></svg>XSSMARK'
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

async function openWith(hash, seed) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/customers`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  // ข้อมูลตั้งต้นส่งเข้าไปในหน้าเป็นพารามิเตอร์ (ฟังก์ชันถูกแปลงเป็นข้อความแล้วรันในหน้า จึงเข้าถึงตัวแปรของไฟล์นี้ไม่ได้)
  await page.evaluate(async ([src, payload]) => {
    const S = (window.__store = await import('/src/data/store.js'))
    const fn = new Function('return ' + src)()
    fn(S, payload)
  }, [seed.toString(), PAYLOAD])
  await page.evaluate((h) => { location.hash = h }, hash)
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForTimeout(900)
  return { page, errors }
}

// ตรวจผลบนหน้า: ไม่มีการรันโค้ด และข้อความดิบแสดงอยู่
async function verdict(page) {
  return page.evaluate(() => ({
    ran: window.__xss === 1,
    injectedImg: !!document.querySelector('img[src="x"]'),
    injectedSvg: !!document.querySelector('svg[onload]'),
    shownRaw: document.body.innerText.includes('XSSMARK'),
  }))
}

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('ชื่อลูกค้าที่มีโค้ดแฝง แสดงในรายชื่อลูกค้าหลังบ้านเป็นข้อความ', async () => {
  const { page, errors } = await openWith('/admin/settings/customers', (S, payload) => {
    S.addCustomer({ name: payload, phone: '0877770001', note: 'ทดสอบ XSS' })
  })
  try {
    assert.ok(await page.evaluate(() => window.__store.db.customers.some((x) => x.phone === '0877770001')), 'ไม่พบลูกค้าที่เพิ่ม')
    await page.getByText('XSSMARK', { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 })
    const v = await verdict(page)
    assert.equal(v.ran, false, 'สคริปต์ในชื่อลูกค้าถูกรัน')
    assert.equal(v.injectedImg || v.injectedSvg, false, 'มีองค์ประกอบ HTML ที่สร้างจากชื่อลูกค้า')
    assert.equal(v.shownRaw, true)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ข้อความแชทของลูกค้าที่มีโค้ดแฝง แสดงในห้องแชทหลังบ้านเป็นข้อความ', async () => {
  const { page, errors } = await openWith('/admin/chat', (S, payload) => {
    const chat = S.db.chats[0]
    chat.messages.push({ id: 'xssmsg', from: 'customer', kind: 'text', text: payload, at: new Date().toISOString(), by: 'ลูกค้า' })
    window.__xssChatId = chat.id
  })
  try {
    const chatId = await page.evaluate(() => window.__xssChatId)
    await page.evaluate((id) => { location.hash = `/admin/chat/${id}` }, chatId)
    await page.waitForTimeout(900)
    await page.getByText('XSSMARK', { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 })
    const v = await verdict(page)
    assert.equal(v.ran, false, 'สคริปต์ในข้อความแชทถูกรัน')
    assert.equal(v.injectedImg || v.injectedSvg, false)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หมายเหตุสินค้าเค้กที่มีโค้ดแฝง แสดงในหน้าออร์เดอร์หลังบ้านเป็นข้อความ', async () => {
  const { page, errors } = await openWith('/admin/orders', (S, payload) => {
    const o = S.db.orders.find((x) => x.channel !== 'pos' && x.items?.length && x.status !== 'draft')
    o.items[0].note = payload
    window.__xssOrderId = o.id
  })
  try {
    const id = await page.evaluate(() => window.__xssOrderId)
    await page.evaluate((h) => { location.hash = h }, `/admin/orders/${id}`)
    await page.waitForTimeout(900)
    await page.getByText('XSSMARK', { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 })
    const v = await verdict(page)
    assert.equal(v.ran, false, 'สคริปต์ในหมายเหตุสินค้าถูกรัน')
    assert.equal(v.injectedImg || v.injectedSvg, false)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('ตัวควบคุม: payload ที่ฉีดด้วย innerHTML ต้องถูกตรวจพบ (พิสูจน์ว่าการตรวจใช้ได้)', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${base}/#/admin/no-access`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.evaluate((p) => { const d = document.createElement('div'); d.innerHTML = p; document.body.appendChild(d) }, PAYLOAD)
    await page.waitForTimeout(600)
    const v = await verdict(page)
    assert.equal(v.injectedImg || v.injectedSvg, true, 'ตัวควบคุมไม่ทำงาน: payload ที่ควรถูกตรวจพบไม่ถูกพบ')
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
