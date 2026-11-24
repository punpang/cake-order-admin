// แอปร้านออกแบบสำหรับแนวนอนที่ 1280×800 (ขนาดจอ POS ขั้นต่ำ)
//   (1) หน้า POS: ไม่มีแถบเลื่อนแนวนอน · ปุ่ม "ชำระเงิน" อยู่ในจอโดยไม่ต้องเลื่อนทั้งหน้า
//   (2) หน้าหลังบ้านหลัก: ไม่มีแถบเลื่อนแนวนอนที่ 1280×800
// รัน: node e2e/pos-landscape.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const VIEW = { width: 1280, height: 800 }

async function open(hash) {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
  return { page, errors }
}
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const cases = []
const t = (name, fn) => cases.push([name, fn])

t('POS 1280×800: ไม่มีแถบเลื่อนแนวนอน และปุ่มชำระเงินอยู่ในจอ', async () => {
  const { page, errors } = await open('/admin/pos')
  try {
    await page.getByRole('button', { name: 'ลูกค้าทั่วไป', exact: true }).first().click()
    await page.getByRole('button', { name: /คัพเค้กวานิลลา/ }).first().click()
    const pay = page.getByRole('button', { name: 'ชำระเงิน', exact: true }).first()
    await pay.waitFor({ state: 'visible' })
    const box = await pay.boundingBox()
    assert.ok(box && box.y >= 0 && box.y + box.height <= VIEW.height, `ปุ่มชำระเงินอยู่นอกจอ: ${JSON.stringify(box)}`)
    assert.ok(box.x >= 0 && box.x + box.width <= VIEW.width, `ปุ่มชำระเงินล้นความกว้างจอ: ${JSON.stringify(box)}`)
    assert.ok((await overflowX(page)) <= 0, 'หน้า POS มีแถบเลื่อนแนวนอน')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

for (const [path, label] of [['/admin/dashboard', 'ภาพรวม'], ['/admin/settings/retail', 'สินค้า (หน้าจัดการ)'], ['/admin/orders', 'ออร์เดอร์']]) {
  t(`${label} (${path}) 1280×800: ไม่มีแถบเลื่อนแนวนอน`, async () => {
    const { page, errors } = await open(path)
    try {
      assert.ok((await overflowX(page)) <= 0, `${path} มีแถบเลื่อนแนวนอน ${await overflowX(page)}px`)
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

let fails = 0
for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}\n  ${String(e?.message || e).split('\n').slice(0, 4).join('\n  ')}`) }
}
await browser.close()
await server.close()
console.log(`\nรวม ${cases.length} กรณี · ผ่าน ${cases.length - fails} · ไม่ผ่าน ${fails}`)
process.exitCode = fails ? 1 : 0
