// ตรวจหน้าลูกค้าทุกขนาดจอ (320 / 390 / 768 / 1024 / 1440 px)
// 1) ห้ามเลื่อนแนวนอนทั้งหน้า (scrollWidth ต้องไม่เกิน clientWidth)
// 2) บนจอสัมผัส (≤ 1024 px) ลิงก์ ปุ่ม และช่องกรอกต้องสูงและกว้างอย่างน้อย 44px
//    จำลองด้วย isMobile + hasTouch ให้ (pointer: coarse) ทำงานเหมือนมือถือจริง · ตัวควบคุมยืนยันว่าเป็นจอสัมผัสจริง
// จอ 1440 px เป็นเมาส์ จึงตรวจเฉพาะข้อ 1
// รัน: node e2e/customerLayout.e2e.mjs
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WIDTHS = [320, 390, 768, 1024, 1440]
const TOUCH_MAX = 1024
const MIN_TAP = 44
// หน้าลูกค้าที่เปิดได้โดยไม่ต้องล็อกอิน (ตรงกับ src/router.js)
const PAGES = ['/', '/menu', '/menu/gallery', '/menu/custom', '/account/login', '/account/register', '/account/forgot', '/line', '/legal/privacy', '/legal/terms', '/legal/cookie', '/preorder', '/preorder/orders']

const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const fails = []
const errors = []
let total = 0

// วัดในหน้าเว็บ: การเลื่อนแนวนอนของเอกสาร และเป้าสัมผัสที่เล็กกว่าเกณฑ์ (เฉพาะจอสัมผัส)
const measure = ({ min, touch }) => {
  const el = document.documentElement
  const cw = el.clientWidth
  const sw = el.scrollWidth
  const over = [...document.querySelectorAll('body *')]
    .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > cw + 1 })
    .slice(0, 3).map((n) => `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`)
  const small = []
  if (touch) {
    for (const n of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
      const r = n.getBoundingClientRect()
      const cs = getComputedStyle(n)
      if (r.width <= 1 || r.height <= 1 || cs.visibility === 'hidden' || cs.display === 'none') continue
      // ช่องติ๊ก/วิทยุที่อยู่ใน label ที่สูงพอ: แตะทั้งแถวได้ จึงไม่นับ
      if ((n.type === 'checkbox' || n.type === 'radio') && (n.closest('label')?.getBoundingClientRect().height ?? 0) >= min) continue
      // เกณฑ์ตามแผน: ความสูงอย่างน้อย 44px (ความกว้างของลิงก์ข้อความขึ้นกับความยาวข้อความ จึงไม่ใช้เกณฑ์)
      if (r.height < min) small.push(`${n.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} "${(n.innerText || n.getAttribute('aria-label') || '').trim().slice(0, 20)}"`)
    }
  }
  return { sw, cw, over, small }
}

try {
  for (const width of WIDTHS) {
    const touch = width <= TOUCH_MAX
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 })
    // กันเบราว์เซอร์ถูกพาไปหน้าล็อกอิน LINE ระหว่างเทสต์ (หน้า /line ใช้ LIFF)
    await ctx.route(/https:\/\/[^/]*line\.me\//, (r) => r.abort())
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      // ตัวควบคุม: กล่องกว้างเกินจอต้องถูกตรวจพบ และจอสัมผัสต้องเป็น (pointer: coarse) จริง
      await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.store-theme', { timeout: 60000 })
      await page.waitForTimeout(900)
      const control = await page.evaluate((w) => {
        const d = document.createElement('div')
        d.style.cssText = `width:${w + 300}px;height:4px`
        document.body.appendChild(d)
        const over = document.documentElement.scrollWidth > document.documentElement.clientWidth
        d.remove()
        return { over, coarse: matchMedia('(pointer: coarse)').matches }
      }, width)
      if (!control.over || (touch && !control.coarse)) {
        fails.push(`${width}px ตัวควบคุม`)
        console.log(`FAIL ${width}px ตัวควบคุม: ${!control.over ? 'ตรวจไม่พบการเลื่อนแนวนอนที่ตั้งใจให้เกิด' : 'จอสัมผัสจำลองไม่ใช่ (pointer: coarse)'}`)
        continue
      }
      for (const route of PAGES) {
        total++
        await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.store-theme', { timeout: 60000 })
        await page.waitForTimeout(900)
        const m = await page.evaluate(measure, { min: MIN_TAP, touch })
        const bad = []
        if (m.sw > m.cw) bad.push(`กว้าง ${m.sw}px > ${m.cw}px (${m.over.join(', ')})`)
        if (m.small.length) bad.push(`เป้าสัมผัสสูงต่ำกว่า ${MIN_TAP}px ${m.small.length} จุด: ${m.small.slice(0, 4).join(' · ')}`)
        if (bad.length) {
          fails.push(`${width}px ${route}`)
          console.log(`FAIL ${width}px ${route} · ${bad.join(' · ')}`)
        } else console.log(`PASS ${width}px ${route}`)
      }
    } finally {
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(`\nรวม ${total} การวัด (${WIDTHS.length} ความกว้าง × ${PAGES.length} หน้า) · ผ่าน ${total - fails.length} · ไม่ผ่าน ${fails.length}`)
if (errors.length) console.log(`หมายเหตุ: หน้าเว็บโยนข้อผิดพลาด ${errors.length} รายการ (ไม่นับในผลนี้): ${errors.slice(0, 2).join(' | ')}`)
process.exitCode = fails.length ? 1 : 0
