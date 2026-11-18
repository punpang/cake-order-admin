// ทดสอบทุกหน้าของแอป (ทุก route ใน src/router.js ที่ไม่ต้องการพารามิเตอร์ + ตัวอย่างหน้าที่มีรหัส) ในเบราว์เซอร์จริง
// ผ่านเมื่อ: หน้าโหลดจบ (ไม่ค้าง "กำลังเตรียมข้อมูล") · ไม่มี pageerror · ไม่มี console.error
// รัน: node e2e/routes.smoke.e2e.mjs
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

// หน้าแบบคงที่ทั้งหมดของแอป (ตรงกับ src/router.js) · หน้าลูกค้า/สาธารณะก็เปิดได้โดยไม่ล็อกอิน
const STATIC = [
  '/', '/account', '/account/consent', '/account/forgot', '/account/login', '/account/register',
  '/admin', '/admin/accounting', '/admin/chat', '/admin/dashboard', '/admin/login', '/admin/manee-test',
  '/admin/materials', '/admin/no-access', '/admin/orders', '/admin/orders/new', '/admin/payments',
  '/admin/pos', '/admin/pos/bills', '/admin/production', '/admin/qr', '/admin/settings',
  '/admin/settings/birthdays', '/admin/settings/bot', '/admin/settings/bundles', '/admin/settings/campaigns',
  '/admin/settings/customers', '/admin/settings/deletion-requests', '/admin/settings/files', '/admin/settings/gallery',
  '/admin/settings/ingredients', '/admin/settings/integrations', '/admin/settings/legal', '/admin/settings/line-history',
  '/admin/settings/links', '/admin/settings/loyalty', '/admin/settings/lucky', '/admin/settings/options',
  '/admin/settings/photo-requests', '/admin/settings/pricing', '/admin/settings/products', '/admin/settings/profit',
  '/admin/settings/promos', '/admin/settings/retail', '/admin/settings/retention', '/admin/settings/shop',
  '/admin/settings/sms', '/admin/settings/storefront', '/admin/settings/test', '/admin/settings/users',
  '/display', '/legal/privacy', '/legal/terms', '/legal/cookie', '/line', '/member', '/menu', '/menu/custom', '/menu/gallery',
  '/manage', '/pos', '/chat', '/orders',
]

// ตัวอย่างหน้าที่มีรหัสในลิงก์ — รหัสดึงจากข้อมูลตัวอย่างตอนรัน (ข้ามถ้าไม่มีข้อมูล)
async function dynamicRoutes(page) {
  return page.evaluate(() => {
    const S = window.__store
    const out = []
    const first = (list) => (Array.isArray(list) && list.length ? list[0] : null)
    const o = first(S.db.orders)
    if (o) { out.push(`/admin/orders/${o.id}`); if (o.customerId) out.push(`/account/orders/${o.id}`) }
    const ch = first(S.db.chats)
    if (ch) out.push(`/admin/chat/${ch.id}`)
    const b = first(S.db.bundles)
    if (b) out.push(`/admin/settings/bundles/${b.id}`)
    const opt = first(S.db.options)
    if (opt) out.push(`/admin/settings/options/${opt.id}`)
    return out
  })
}

async function checkPage(route) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // ข้อยกเว้นเฉพาะการเชื่อมต่อไปยังบริการภายนอก (LINE/LIFF) ที่เครื่องทดสอบอาจเข้าไม่ได้ · ไม่ใช่ข้อผิดพลาดของแอป
    if (route === '/line' && (m.text().includes('ERR_TUNNEL_CONNECTION_FAILED') || m.text().includes('LiffError') || m.text().includes('LIFF'))) return
    errors.push(`console: ${m.text()}`)
  })
  try {
    await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
    await page.waitForTimeout(300)
    return errors
  } finally {
    await page.close()
  }
}

const results = []
const seed = { dynamic: [] }
// รอบแรก: เปิดหน้าแอดมินหนึ่งครั้งเพื่อดึงรหัสตัวอย่างสำหรับหน้าที่มี :id
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${base}/#/admin/settings/customers`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  seed.dynamic = await dynamicRoutes(page)
  await page.close()
}

const routes = [...STATIC, ...seed.dynamic]
for (const route of routes) {
  const errors = await checkPage(route)
  results.push([route, errors])
  console.log(errors.length ? `FAIL ${route}\n  ${errors.slice(0, 3).join('\n  ')}` : `PASS ${route}`)
}

await browser.close()
await server.close()
const fails = results.filter(([, e]) => e.length).length
console.log(`\nรวม ${routes.length} หน้า · ผ่าน ${routes.length - fails} · ไม่ผ่าน ${fails}`)
process.exitCode = fails ? 1 : 0
