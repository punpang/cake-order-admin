// ทดสอบความกว้างมือถือ 375px: ทุกหน้า (route แบบคงที่) ต้องไม่มีการเลื่อนแนวนอน
// วิธีตรวจ: scrollWidth ของเอกสารต้องไม่เกิน clientWidth (ขนาดหน้าจอที่มองเห็น) · หน้าที่ต้องล็อกอินจะถูกส่งไปหน้าล็อกอิน ซึ่งก็ตรวจด้วย
// รัน: node e2e/responsive.e2e.mjs
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { STATIC } from './_routes.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const fails = []
try {
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  // ตัวควบคุม: ใส่กล่องกว้าง 600px เข้าไปจริง ต้องถูกตรวจพบ ไม่เช่นนั้นการตรวจทั้งหมดไม่มีความหมาย
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'e2e-wide'; d.style.width = '600px'; d.style.height = '10px'; document.body.appendChild(d) })
  const control = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  await page.evaluate(() => document.getElementById('e2e-wide')?.remove())
  if (!control) { console.log('FAIL ตัวควบคุม: การตรวจไม่พบการเลื่อนแนวนอนที่ตั้งใจให้เกิด'); process.exitCode = 1; await browser.close(); await server.close(); process.exit() }
  console.log('PASS ตัวควบคุม (ตรวจพบกล่องกว้าง 600px)')
  for (const route of STATIC) {
    await page.evaluate((r) => { location.hash = r }, route)
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.waitForTimeout(250)
    const m = await page.evaluate(() => {
      const el = document.documentElement
      // ตัวการที่ทำให้กว้างเกิน (ช่วยหาจุดแก้): องค์ประกอบที่ขวาเกินจอ 375px
      const over = [...document.querySelectorAll('body *')]
        .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > el.clientWidth + 1 })
        .slice(0, 3).map((n) => `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`)
      return { sw: el.scrollWidth, cw: el.clientWidth, over }
    })
    if (m.sw > m.cw) { fails.push(route); console.log(`FAIL ${route} กว้าง ${m.sw}px > ${m.cw}px · ${m.over.join(', ')}`) }
    else console.log(`PASS ${route}`)
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(`\nรวม ${STATIC.length} หน้า (375px) · ผ่าน ${STATIC.length - fails.length} · ไม่ผ่าน ${fails.length}`)
if (errors.length) console.log(`หมายเหตุ: หน้าเว็บโยนข้อผิดพลาด ${errors.length} รายการ (ไม่นับในผลนี้): ${errors.slice(0, 2).join(' | ')}`)
process.exitCode = fails.length ? 1 : 0
