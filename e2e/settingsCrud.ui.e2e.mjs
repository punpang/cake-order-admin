// ทดสอบพฤติกรรมการบันทึกของหน้าตั้งค่าที่เสี่ยงสูง (B10): ลิงก์ย่อ · สิทธิ์การแก้หน้าตั้งค่า · เอกสารกฎหมาย · หน้าร้าน
// เรียกฟังก์ชันของ store ที่หน้าจอเรียกจริง (ไม่พึ่งตำแหน่งปุ่ม) และเปิดหน้าจอจริงเพื่อยืนยันว่าโหลดโดยไม่มีข้อผิดพลาด
// ข้อมูลจำลองในหน่วยความจำ · รัน: npm run test:e2e (ต้องมี Chromium ของ Playwright)
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
// Chromium ใต้ root (เช่น ในคอนเทนเนอร์) ต้องปิด sandbox · บนเครื่องปกติไม่ใส่
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

let fails = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

// เปิดหน้าใหม่ รอให้ข้อมูลจำลองโหลดเสร็จ และนำเข้าโมดูล store ตัวเดียวกับแอป
async function openPage(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors }
}

t('ลิงก์ย่อ: ตรวจรูปแบบรหัสและปลายทาง · กันรหัสซ้ำ/ลิงก์ซ้อน · โฮสต์ภายนอกต้องอยู่ในรายการ · แก้ไขคงยอดคลิก · ลบได้', async () => {
  const { page, errors } = await openPage('/admin/settings/links')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const out = {}
      S.saveLinkSettings({ policy: {}, allowlist: [] })
      out.internal = S.saveShortLink({ code: 'e2e-menu', target: '/menu', active: true, note: 'ทดสอบ' })
      out.dup = S.saveShortLink({ code: 'e2e-menu', target: '/menu' })
      out.badShape = S.saveShortLink({ code: 'ab', target: '/menu' })
      out.selfChain = S.saveShortLink({ code: 'e2e-chain', target: '/s/e2e-menu' })
      out.externalBlocked = S.saveShortLink({ code: 'e2e-ext', target: 'https://shop.example.org/x' })
      out.httpBlocked = S.saveShortLink({ code: 'e2e-http', target: 'http://shop.example.org/x' })
      S.saveLinkSettings({ policy: {}, allowlist: ['shop.example.org'] })
      out.externalOk = S.saveShortLink({ code: 'e2e-ext', target: 'https://shop.example.org/x' })
      const link = S.db.shortLinks.find((x) => x.code === 'e2e-menu')
      link.clicks = 7
      out.editKeepsCode = S.saveShortLink({ id: link.id, code: 'e2e-menu', target: '/display', active: true })
      out.afterEdit = { target: link.target, clicks: link.clicks, kind: link.kind }
      S.removeShortLink(link.id)
      out.removed = !S.db.shortLinks.some((x) => x.code === 'e2e-menu')
      return out
    })
    assert.equal(r.internal.ok, true)
    assert.equal(r.dup.error, 'รหัสนี้ถูกใช้แล้ว')
    assert.equal(r.badShape.error, 'รหัสใช้ได้เฉพาะ a-z 0-9 และ - (3–10 ตัว)')
    assert.equal(r.selfChain.error, 'ห้ามชี้ไปลิงก์ย่ออีกอัน')
    assert.match(r.externalBlocked.error, /shop\.example\.org.*ยังไม่อยู่ในรายการที่อนุญาต/)
    assert.equal(r.httpBlocked.error, 'ลิงก์ภายนอกต้องเป็น https เท่านั้น')
    assert.equal(r.externalOk.ok, true)
    assert.equal(r.editKeepsCode.ok, true)
    assert.deepEqual(r.afterEdit, { target: '/display', clicks: 7, kind: 'internal' })
    assert.equal(r.removed, true)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('พนักงานที่ไม่มีสิทธิ์ manage บันทึกลิงก์ · เอกสารกฎหมาย · ข้อมูลติดต่อไม่ได้ แม้เรียกจากโค้ด', async () => {
  const { page, errors } = await openPage('/admin/settings/legal')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      S.db.users.push({ id: 'e2e-sales-cfg', name: 'พนักงานทดสอบ', email: 'e2e-sales-cfg@example.com', role: 'sales', active: true, perms: ['viewAllOrders', 'createOrder'] })
      S.switchUser('e2e-sales-cfg')
      return {
        canManage: S.can('manage'),
        link: S.saveShortLink({ code: 'e2e-denied', target: '/menu' }),
        legal: S.saveLegal('terms', { title: 'x', text: 'ข้อความใหม่' }),
        contact: S.saveLegalContact({ controller: 'x' }),
      }
    })
    assert.equal(r.canManage, false)
    assert.equal(r.link.error, 'เฉพาะแอดมิน')
    assert.equal(r.legal.error, 'เฉพาะแอดมิน')
    assert.equal(r.contact.error, 'เฉพาะแอดมิน')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('เอกสารกฎหมาย: ข้อความว่างบันทึกไม่ได้ · ข้อความเดิมไม่เพิ่มเวอร์ชัน · ข้อความใหม่เพิ่มเวอร์ชันหนึ่งครั้ง · ไม่เพิ่มเวอร์ชันเมื่อ bump=false', async () => {
  const { page, errors } = await openPage('/admin/settings/legal')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const d = S.db.legal.docs.terms
      // ตั้งข้อความเริ่มต้นที่ไม่ว่างโดยไม่เพิ่มเวอร์ชัน แล้วอ่านเวอร์ชันฐาน
      S.saveLegal('terms', { title: d.title, text: 'ข้อความเริ่มต้นทดสอบ', bump: false })
      const base = d.text
      const v0 = d.version
      const same = S.saveLegal('terms', { title: d.title, text: base })
      const v1 = d.version
      const empty = S.saveLegal('terms', { title: d.title, text: '   ' })
      const v2 = d.version
      const changed = S.saveLegal('terms', { title: d.title, text: base + ' (ทดสอบ)' })
      const v3 = d.version
      const noBump = S.saveLegal('terms', { title: d.title, text: base + ' (ทดสอบ 2)', bump: false })
      return { v0, same, v1, empty, v2, changed, v3, noBump, v4: d.version }
    })
    assert.equal(r.same.ok, true)
    assert.equal(r.v1, r.v0, 'ข้อความเดิมไม่ควรเพิ่มเวอร์ชัน')
    assert.equal(r.empty.error, 'ข้อความต้องไม่ว่าง')
    assert.equal(r.v2, r.v0, 'ข้อความว่างไม่ควรเปลี่ยนเวอร์ชัน')
    assert.equal(r.changed.ok, true)
    assert.equal(r.v3, r.v0 + 1, 'ข้อความใหม่ควรเพิ่มเวอร์ชันหนึ่งครั้ง')
    assert.equal(r.noBump.ok, true)
    assert.equal(r.v4, r.v0 + 1, 'bump=false ไม่ควรเพิ่มเวอร์ชัน')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าร้าน: ลิงก์แผนที่/เฟซบุ๊กรับเฉพาะ http(s) · เบอร์เก็บเฉพาะตัวเลขไม่เกิน 10 หลัก · ข้อความถูกตัดช่องว่าง', async () => {
  const { page, errors } = await openPage('/admin/settings/storefront')
  try {
    const s = await page.evaluate(() => {
      const S = window.__store
      S.saveStorefront({ ...S.db.storefront, mapUrl: 'javascript:alert(1)', facebookUrl: 'data:text/html,hi', phone: '08-1234 5678 9900', heroTitle: '  หัว  ' })
      const bad = { mapUrl: S.db.storefront.mapUrl, facebookUrl: S.db.storefront.facebookUrl, phone: S.db.storefront.phone, heroTitle: S.db.storefront.heroTitle }
      S.saveStorefront({ ...S.db.storefront, mapUrl: 'https://maps.example.com/shop', facebookUrl: 'http://fb.example.com/shop' })
      return { bad, good: { mapUrl: S.db.storefront.mapUrl, facebookUrl: S.db.storefront.facebookUrl } }
    })
    assert.deepEqual(s.bad, { mapUrl: '', facebookUrl: '', phone: '0812345678', heroTitle: 'หัว' })
    assert.equal(s.good.mapUrl, 'https://maps.example.com/shop')
    assert.equal(s.good.facebookUrl, 'http://fb.example.com/shop')
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
