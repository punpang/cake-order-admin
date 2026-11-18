// ทดสอบสิทธิ์ตามบทบาทในเบราว์เซอร์: บทบาทที่ไม่มีสิทธิ์ต้องถูกปฏิเสธจริงบนหน้า ไม่ใช่แค่ซ่อนเมนู
// ใช้ผู้ใช้ตัวอย่างของแต่ละบทบาท (พนักงานขาย/คนทำเค้ก/คนส่งของ) แล้วเปิดทุกหน้าหลังบ้านที่มีในรายการ
// กติกาที่คาดหวัง:
//   • หน้าที่ประกาศสิทธิ์ใน router.js (meta.perms): เปิดได้เมื่อมีสิทธิ์อย่างน้อยหนึ่งข้อ ไม่เช่นนั้นไปหน้า "ไม่มีสิทธิ์" (/admin/no-access)
//   • หน้าตั้งค่า /admin/settings/*: ต้องแสดง "ไม่มีสิทธิ์เข้าหน้านี้" เมื่อไม่มีสิทธิ์ของหน้านั้นตาม SETTINGS_PAGES (ค่าเริ่มต้น manage)
// รัน: node e2e/roles.e2e.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { STATIC } from './_routes.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// สิทธิ์ของหน้าที่ประกาศใน router.js (เฉพาะเส้นทางที่ไม่มีพารามิเตอร์ และประกาศ perms ไว้บนบรรทัดเดียวกัน)
const ROUTE_PERMS = new Map()
for (const line of readFileSync(ROOT + 'src/router.js', 'utf8').split('\n')) {
  const p = line.match(/path: '([^']+)'/)
  const m = line.match(/perms: \[([^\]]*)\]/)
  if (p && m && !p[1].includes(':')) ROUTE_PERMS.set(p[1], [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
}
const ROLE_USERS = { sales: 'u2', baker: 'u3', driver: 'u4' }
const DENIED = 'ไม่มีสิทธิ์เข้าหน้านี้'

const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

// โหลดข้อมูลจำลองหนึ่งครั้ง แล้วเปลี่ยนผู้ใช้ตามบทบาท (สถานะคงอยู่ในหน้าเดียวกัน)
await page.goto(`${base}/#/admin/no-access`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })

// รอให้หน้าที่เปิดแสดงผลจริง (ไม่ใช่ข้อความของหน้าก่อนหน้า) ก่อนอ่านผล
async function settle(route) {
  await page.evaluate((h) => { location.hash = h }, route)
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForTimeout(900)
  return page.evaluate(() => ({ hash: location.hash.replace(/^#/, ''), denied: document.body.innerText.includes('ไม่มีสิทธิ์เข้าหน้านี้') }))
}

// ทุกหน้าหลังบ้านในรายการ (ไม่รวมหน้าเข้าสู่ระบบและหน้าไม่มีสิทธิ์เอง) · ปลายทาง redirect ใช้ตามที่แอปไปจริง
const ADMIN = STATIC.filter((r) => r.startsWith('/admin') && !['/admin/login', '/admin/no-access'].includes(r))
const failures = []
let checked = 0
// สิทธิ์ที่หน้าตั้งค่าต้องมี (ตรงกับที่ ManageShell ใช้ตัดสิน: SETTINGS_PAGES.perm ถ้าไม่ระบุ = manage)
const settingsPermOf = (landed) => page.evaluate(async (path) => {
  const { SETTINGS_PAGES } = await import('/src/lib/settingsPages.js')
  const hit = SETTINGS_PAGES.find((x) => x.to === path)
  return hit ? (hit.perm || 'manage') : 'manage'
}, landed)

for (const [role, uid] of Object.entries(ROLE_USERS)) {
  const ok = await page.evaluate((id) => window.__store.switchUser(id), uid)
  assert.ok(ok, `ไม่พบผู้ใช้ตัวอย่างของบทบาท ${role}`)
  const ownPerms = await page.evaluate(() => window.__store.db.users.find((u) => u.id === window.__store.session.userId)?.perms || [])
  for (const route of ADMIN) {
    const got = await settle(route)
    checked++
    if (route.startsWith('/admin/settings')) {
      const perm = await settingsPermOf(got.hash)
      const expectDenied = !ownPerms.includes(perm)
      if (got.denied !== expectDenied) failures.push(`${role} ${route}: ${expectDenied ? 'ควรแสดงว่าไม่มีสิทธิ์' : 'ไม่ควรแสดงว่าไม่มีสิทธิ์'} (ต้องการ ${perm}) แต่แสดง ${got.denied ? 'ไม่มีสิทธิ์' : 'หน้าปกติ'}`)
      continue
    }
    const perms = ROUTE_PERMS.get(route)
    if (!perms) continue
    const allowed = perms.some((p) => ownPerms.includes(p))
    const expectedLanding = allowed ? route : '/admin/no-access'
    if (got.hash !== expectedLanding) failures.push(`${role} ${route}: ควรไป ${expectedLanding} แต่ไป ${got.hash}`)
  }
}

// ตัวควบคุม: ผู้ใช้ที่ไม่มีสิทธิ์เลย ต้องถูกส่งไปหน้าไม่มีสิทธิ์จากทุกหน้าที่มีสิทธิ์กำกับ (ไม่เช่นนั้นการตรวจข้างบนไม่มีความหมาย)
await page.evaluate(() => { window.__store.db.users.push({ id: 'e2e-none', name: 'ไม่มีสิทธิ์', role: 'driver', active: true, perms: [] }) })
await page.evaluate(() => window.__store.switchUser('e2e-none'))
const ctrlFails = []
for (const route of ADMIN.filter((r) => ROUTE_PERMS.has(r))) {
  const got = await settle(route)
  if (got.hash !== '/admin/no-access') ctrlFails.push(`${route} -> ${got.hash}`)
}
if (ctrlFails.length) failures.push(`ตัวควบคุม: ผู้ใช้ไม่มีสิทธิ์ยังเข้าได้ ${ctrlFails.join(', ')}`)
else console.log('PASS ตัวควบคุม: ผู้ใช้ไม่มีสิทธิ์ถูกปฏิเสธทุกหน้าที่มีสิทธิ์กำกับ')

// ข้อสังเกต (ไม่นับเป็นความล้มเหลว): ฝ่ายขายเปิดหน้าภาพรวม (route อนุญาต) แล้วเห็นอะไร
await page.evaluate((id) => window.__store.switchUser(id), 'u2')
const dash = await settle('/admin/dashboard')
console.log(`ข้อสังเกต: พนักงานขายเปิด /admin/dashboard → ${dash.hash} ${dash.denied ? '(แสดง "ไม่มีสิทธิ์")' : '(แสดงหน้าปกติ)'}`)

await browser.close()
await server.close()
console.log(`ตรวจ ${checked} การเปิดหน้า · ความล้มเหลว ${failures.length}`)
for (const f of failures) console.log('FAIL ' + f)
if (pageErrors.length) console.log(`หมายเหตุ: หน้าเว็บโยนข้อผิดพลาด ${pageErrors.length} รายการ: ${pageErrors.slice(0, 2).join(' | ')}`)
process.exitCode = failures.length || pageErrors.length ? 1 : 0
