// ตรวจการเข้าถึงได้ (accessibility) ด้วย axe-core บนหน้าหลัก: ป้ายกำกับ ปุ่ม ลิงก์ คอนทราสต์ โครงสร้างหัวข้อ (WCAG 2.0/2.1 A และ AA)
// ผ่านเมื่อ: ไม่มีข้อบกพร่องระดับ critical หรือ serious · ข้อระดับ moderate/minor แสดงเป็นข้อสังเกต
// ตัวควบคุม: หน้า HTML ที่มีรูปไม่มี alt และปุ่มไม่มีชื่อ ต้องถูก axe ตรวจพบ (พิสูจน์ว่าเครื่องมือทำงาน)
// รัน: node e2e/a11y.e2e.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const PAGES = ['/', '/menu', '/account/login', '/account/register', '/admin/login', '/admin/pos', '/admin/orders', '/admin/settings/customers']
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const BLOCKING = new Set(['critical', 'serious'])

const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

async function scan(page) {
  await page.addScriptTag({ content: AXE })
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: (v.nodes[0]?.target || []).join(' ').slice(0, 120) }))
  }, TAGS)
}

const fails = []
let total = 0
try {
  for (const path of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(`${base}/#${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.waitForTimeout(600)
    const vs = await scan(page)
    const blocking = vs.filter((v) => BLOCKING.has(v.impact))
    total += vs.length
    if (blocking.length) {
      fails.push(path)
      console.log(`FAIL ${path}`)
      for (const v of blocking) console.log(`   [${v.impact}] ${v.id}: ${v.help} (${v.nodes} จุด) ${v.sample}`)
    } else console.log(`PASS ${path}${vs.length ? ` (ข้อสังเกต ${vs.length} ข้อ: ${vs.map((v) => v.id).join(', ')})` : ''}`)
    await page.close()
  }

  // ตัวควบคุม
  const c = await browser.newPage()
  await c.setContent('<html lang="th"><head><title>x</title></head><body><main><img src="a.png"><button></button></main></body></html>')
  const cv = await scan(c)
  await c.close()
  const caught = cv.some((v) => v.id === 'image-alt') && cv.some((v) => v.id === 'button-name')
  console.log(caught ? 'PASS ตัวควบคุม (ตรวจพบรูปไม่มี alt และปุ่มไม่มีชื่อ)' : 'FAIL ตัวควบคุม: axe ไม่พบข้อบกพร่องที่ตั้งใจให้มี')
  if (!caught) fails.push('control')
} finally {
  await browser.close()
  await server.close()
}
console.log(`\nหน้า ${PAGES.length} · ไม่ผ่าน ${fails.length} · ข้อสังเกตรวม ${total} (moderate/minor)`)
process.exitCode = fails.length ? 1 : 0
