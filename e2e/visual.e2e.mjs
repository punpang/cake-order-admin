// เทียบภาพหน้าหลักกับภาพอ้างอิง (visual regression) เพื่อกัน layout พังโดยไม่รู้ตัว
// ทำให้ผลนิ่ง: เวลาคงที่ (page.clock) · ปิดแอนิเมชัน/การเปลี่ยนสี · ข้อมูลจำลองกำหนดค่าเริ่มต้นได้ · ความกว้าง 1280 px ความหนาแน่นพิกเซล 1
// ผ่านเมื่อ: ขนาดภาพเท่ากัน และพิกเซลที่ต่างกัน (ต่างเกิน 16 ใน 255 ต่อช่องสี) ไม่เกิน 0.5% ของทั้งภาพ
// ตัวควบคุม: เทียบหน้าหนึ่งกับภาพอ้างอิงของอีกหน้า ต้องถูกตรวจว่าต่าง (พิสูจน์ว่าการเทียบใช้ได้)
// ปรับภาพอ้างอิงเมื่อเปลี่ยน UI ตั้งใจ: UPDATE_SNAPSHOTS=1 node e2e/visual.e2e.mjs แล้ว commit ไฟล์ใน e2e/visual/baselines
// รัน: node e2e/visual.e2e.mjs
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIR = join(ROOT, 'e2e', 'visual', 'baselines')
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1'
const PAGES = [
  { name: 'storefront-home', hash: '/' },
  { name: 'storefront-menu', hash: '/menu' },
  { name: 'account-login', hash: '/account/login' },
  { name: 'pos', hash: '/admin/pos' },
  { name: 'orders', hash: '/admin/orders' },
]
const MAX_DIFF_RATIO = 0.005
const CHANNEL_TOL = 16
const FIXED = new Date('2026-11-18T10:00:00+07:00')

const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

// จับภาพหน้า (ค่าเริ่มต้นคงที่ทุกครั้ง)
async function capture(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  await page.clock.setFixedTime(FIXED)
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await page.waitForTimeout(500)
  const buf = await page.screenshot({ fullPage: false, animations: 'disabled' })
  await page.close()
  return PNG.sync.read(buf)
}

// เปรียบเทียบพิกเซล: คืนสัดส่วนของพิกเซลที่ต่างเกินเกณฑ์ (หรือ 1 ถ้าขนาดไม่เท่ากัน)
function diffRatio(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 1
  let bad = 0
  const n = a.width * a.height
  for (let i = 0; i < n * 4; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]))
    if (d > CHANNEL_TOL) bad++
  }
  return bad / n
}

const fails = []
const captured = {}
try {
  for (const p of PAGES) {
    const file = join(DIR, `${p.name}.png`)
    const img = await capture(p.hash)
    captured[p.name] = img
    if (UPDATE || !existsSync(file)) {
      writeFileSync(file, PNG.sync.write(img))
      console.log(`${existsSync(file) && !UPDATE ? '' : 'เขียน'}ภาพอ้างอิง ${p.name}`)
      continue
    }
    const base64 = PNG.sync.read(readFileSync(file))
    const r = diffRatio(img, base64)
    if (r > MAX_DIFF_RATIO) { fails.push(p.name); console.log(`FAIL ${p.name} ต่างจากภาพอ้างอิง ${(r * 100).toFixed(2)}%`) }
    else console.log(`PASS ${p.name} (ต่าง ${(r * 100).toFixed(3)}%)`)
  }
  // ตัวควบคุม: หน้าแรกเทียบกับภาพอ้างอิงของเมนู ต้องต่างมาก
  if (!UPDATE) {
    const ref = PNG.sync.read(readFileSync(join(DIR, 'storefront-menu.png')))
    const r = diffRatio(captured['storefront-home'], ref)
    if (r <= 0.05) { fails.push('control'); console.log(`FAIL ตัวควบคุม: หน้าแรกเทียบเมนูแล้วต่างแค่ ${(r * 100).toFixed(2)}%`) }
    else console.log(`PASS ตัวควบคุม (หน้าแรกต่างจากเมนู ${(r * 100).toFixed(1)}%)`)
  }
} finally {
  await browser.close()
  await server.close()
}
if (UPDATE) console.log('อัปเดตภาพอ้างอิงแล้ว')
process.exitCode = fails.length ? 1 : 0
