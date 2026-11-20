// ตัวช่วย e2e โหมดเชื่อม Supabase: เริ่มเซิร์ฟเวอร์จำลอง + Vite + เบราว์เซอร์ แล้วล็อกอินพนักงานผ่านหน้าจริง
// ใช้ร่วมกับ e2e/supabaseMock.mjs · ไม่แตะฐานข้อมูลจริง
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { startSupabaseMock } from './supabaseMock.mjs'
import { ALL_PERMS } from '../src/lib/constants.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400e3).toISOString()
export const kv = (id, v) => ({ collection: 'config', id, data: { v }, updated_at: at(10), created_at: at(10) })
export const STAFF = { user_id: 'u-staff', name: 'พนักงานทดสอบ', role: 'owner', perms: ALL_PERMS, active: true, email: 'staff@test.local' }

// tables = ข้อมูลตั้งต้น (เพิ่มเติมจากพนักงาน + ค่าตั้งร้าน) · shop = ค่าตั้งร้านที่ทับค่าเริ่มต้นของแอป
export async function startApp({ tables = {}, shop = {}, scheduled = { server: true } } = {}) {
  const mock = await startSupabaseMock({
    punpang_staff: [STAFF],
    punpang_kv: [kv('shop', {}), kv('scheduled', scheduled)],
    punpang_acct_state: [{ id: 1, closed_through: null }],
    ...tables,
  })
  for (const [k, v] of Object.entries({ VITE_USE_SUPABASE: '1', VITE_SUPABASE_URL: mock.url, VITE_SUPABASE_ANON_KEY: 'test-anon-key' })) process.env[k] = v
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(process.env.DEBUG ? e.stack : e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

  // ค่าตั้งร้านเริ่มต้นของแอป + ค่าที่เทสต์กำหนด (ไม่ให้ค่าที่ไม่ได้ตั้งเป็น undefined บนหน้าจอ)
  await page.goto(`${base}/#/admin/login`, { waitUntil: 'domcontentloaded' })
  const defShop = await page.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/data/store.js')).db.shop)))
  mock.db.punpang_kv.find((x) => x.id === 'shop').data.v = { ...defShop, ...shop }
  await page.getByLabel('อีเมล').fill(STAFF.email)
  await page.getByLabel('รหัสผ่าน').fill('test-password')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await page.waitForFunction(() => !location.hash.includes('/admin/login'), null, { timeout: 30000 })
  await page.waitForTimeout(1500)

  const go = async (hash) => {
    await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
    const leave = page.getByRole('button', { name: 'ออกโดยไม่บันทึก' })
    if (await leave.isVisible().catch(() => false)) await leave.click()
    await page.waitForTimeout(800)
  }
  // ข้อผิดพลาดเครือข่ายที่ตั้งใจ (Realtime ปฏิเสธ · 4xx ที่เซิร์ฟเวอร์จำลองตอบตามจริง) ไม่นับ
  const pageErrors = () => errors.filter((e) => !/WebSocket connection|Failed to load resource/.test(e))
  const close = async () => { await browser.close(); await server.close(); await mock.close() }
  return { page, mock, base, go, errors, pageErrors, close }
}

// รันทีละข้อ เก็บผล · ภาพหน้าจอเมื่อไม่ผ่าน (SHOT_DIR)
export function stepper(page) {
  const results = []
  const step = async (name, fn) => {
    try { await fn(); results.push([true, name]) } catch (e) {
      results.push([false, name, String(e.message).split('\n')[0]])
      await page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/sb-fail-${results.length}.png` }).catch(() => {})
    }
  }
  const finish = () => {
    for (const [ok, name, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${why}`}`)
    const bad = results.filter((r) => !r[0]).length
    console.log(`\nรวม ${results.length} ข้อ · ผ่าน ${results.length - bad} · ไม่ผ่าน ${bad}`)
    return bad
  }
  return { results, step, finish }
}
