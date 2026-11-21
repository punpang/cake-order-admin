// ทดสอบพฤติกรรมของหน้าตั้งค่าความเสี่ยงสูงที่ยังไม่มีเทสต์พฤติกรรม (B10 รอบที่ 2):
// สะสมแต้ม/คูปอง · โปรโมชัน POS · คลังสินค้าหน้าร้าน · การเก็บข้อมูลอัตโนมัติ · โหมดทดสอบ · คิวรอตรวจออร์เดอร์
// เรียกฟังก์ชันของ store ที่หน้าจอเรียกจริง และเปิดหน้าจอจริงเพื่อยืนยันว่าโหลดโดยไม่มีข้อผิดพลาด
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

t('หน้าสะสมแต้มและคูปอง: ของแลกคูปองลดเปอร์เซ็นต์เกิน 100 ถูกปฏิเสธ · นาทีใช้คูปองที่ร้านถูกตัดให้อยู่ 1–120 · คืนคะแนนต้องใส่เหตุผล', async () => {
  const { page, errors } = await openPage('/admin/settings/loyalty')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const reward = S.saveReward({ kind: 'coupon', mode: 'spend', name: 'e2e-ของแลก', minSpend: 500, pct: 150, cap: 100, points: 10 })
      const high = S.saveLoyaltySettings({ ...S.db.loyalty, activationMin: 500 })
      const topAt = S.db.loyalty.activationMin
      S.saveLoyaltySettings({ ...S.db.loyalty, activationMin: 0 })
      const lowAt = S.db.loyalty.activationMin
      S.db.coupons.unshift({ id: 'e2e-cp-1', customerId: S.db.customers[0].id, name: 'e2e-คูปอง', points: 50, status: 'active', source: 'points', rewardId: '', createdAt: Date.now() })
      const noReason = S.refundCoupon('e2e-cp-1', '   ')
      return { reward: reward.error, topAt, lowAt, high: high?.error ?? null, noReason: noReason.error }
    })
    assert.match(r.reward, /^ลดกี่ % ต้องมากกว่า 0 และไม่เกิน 100/)
    assert.equal(r.topAt, 120)
    assert.equal(r.lowAt, 1)
    assert.equal(r.high, null)
    assert.equal(r.noReason, 'ใส่เหตุผลที่คืนคะแนน')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าโปรโมชัน POS: ส่วนลดเกิน 100% หรือไม่เลือกสินค้าถูกปฏิเสธ · บันเดิ้ลราคาไม่ต่ำกว่าปกติถูกปฏิเสธ · ตัวคูณคะแนนต้องเกิน 1 · ขั้นส่วนลดซ้ำยอดถูกปฏิเสธ · ลบโปรได้', async () => {
  const { page, errors } = await openPage('/admin/settings/promos')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const item = S.db.retailItems.find((x) => x.price > 0)
      const pct = S.savePosDiscount({ name: 'e2e-ลด', type: 'percent', value: 150, scope: 'all' })
      const noItems = S.savePosDiscount({ name: 'e2e-ลด', type: 'percent', value: 10, scope: 'items', itemIds: [] })
      const ok = S.savePosDiscount({ name: 'e2e-ลด', type: 'percent', value: 10, scope: 'all' })
      const id = ok.item?.id
      const existsBefore = S.db.posDiscounts.some((x) => x.id === id)
      S.removePromo('discount', id)
      const existsAfter = S.db.posDiscounts.some((x) => x.id === id)
      const bundle = S.savePosBundle({ name: 'e2e-ชุด', items: [{ itemId: item.id, qty: 1 }, { itemId: item.id, qty: 1 }], price: item.price * 2 })
      const point = S.savePointPromo({ name: 'e2e-แต้ม', multiplier: 1, scope: 'all' })
      const deal = S.saveDeal({ kind: 'spend_off', name: 'e2e-ขั้น', tiers: [{ min: 500, type: 'amount', value: 50 }, { min: 500, type: 'amount', value: 80 }] })
      return { pct: pct.error, noItems: noItems.error, existsBefore, existsAfter, bundle: bundle.error, point: point.error, deal: deal.error }
    })
    assert.equal(r.pct, 'เปอร์เซ็นต์ต้องอยู่ระหว่าง 1–100')
    assert.equal(r.noItems, 'เลือกสินค้าอย่างน้อย 1 รายการ')
    assert.equal(r.existsBefore, true)
    assert.equal(r.existsAfter, false)
    assert.match(r.bundle, /^ราคาชุดต้องต่ำกว่าราคาปกติรวม/)
    assert.equal(r.point, 'ตัวคูณต้องมากกว่า 1 (เช่น 2 = คะแนนสองเท่า)')
    assert.equal(r.deal, 'ยอดของแต่ละขั้นซ้ำกัน')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าคลังสินค้าหน้าร้าน: ราคาที่ไม่ใช่ตัวเลขเป็น 0 · สต็อกว่างคือไม่จำกัด · สต็อกติดลบไม่ได้ · ปรับสต็อกไม่ต่ำกว่า 0 · ย้ายลำดับได้', async () => {
  const { page, errors } = await openPage('/admin/settings/retail')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const a = S.saveRetailItem({ name: 'e2e-สินค้า-ก', price: 'abc', stock: '' })
      const b = S.saveRetailItem({ name: 'e2e-สินค้า-ข', price: 50, stock: -3 })
      const stockA = a.stock
      S.addStock(b, -10)
      const afterDrop = b.stock
      S.addStock(b, 4)
      const afterAdd = b.stock
      const list = ['x', 'y', 'z']
      S.moveItem(list, 0, 1)
      const afterMove = [...list]
      S.moveItemTo(list, 2, 0)
      const afterTo = [...list]
      return { price: a.price, stockA, afterDrop, afterAdd, afterMove, afterTo }
    })
    assert.equal(r.price, 0)
    assert.equal(r.stockA, null)
    assert.equal(r.afterDrop, 0)
    assert.equal(r.afterAdd, 4)
    assert.deepEqual(r.afterMove, ['y', 'x', 'z'])
    assert.deepEqual(r.afterTo, ['z', 'y', 'x'])
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าการเก็บข้อมูลอัตโนมัติ: จำนวนวันต่ำกว่าขั้นต่ำบันทึกไม่ได้ · บันทึกค่าที่ถูกต้องได้ · ผู้ที่ไม่ใช่แอดมินบันทึกไม่ได้', async () => {
  const { page, errors } = await openPage('/admin/settings/retention')
  try {
    const r = await page.evaluate(async () => {
      const S = window.__store
      const RC = await import('/src/lib/retention.js')
      const payload = Object.fromEntries(RC.RETENTION_CATS.map((c) => [c.key, { ...c.def }]))
      const first = RC.RETENTION_CATS[0].key
      const bad = S.saveRetentionSettings({ ...payload, [first]: { enabled: true, days: 0 } })
      const good = S.saveRetentionSettings(payload)
      const saved = S.db.retention[first]
      S.db.users.push({ id: 'e2e-sales-ret', name: 'พนักงานทดสอบ', email: 'e2e-sales-ret@example.com', role: 'sales', active: true, perms: ['viewAllOrders', 'createOrder'] })
      S.switchUser('e2e-sales-ret')
      const denied = S.saveRetentionSettings(payload)
      return { bad: bad.error, good: good.ok, saved, denied: denied.error }
    })
    assert.match(r.bad, /ต่ำสุด \d+ วัน/)
    assert.equal(r.good, true)
    assert.equal(r.saved.enabled, true)
    assert.equal(r.denied, 'เฉพาะแอดมิน')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าโหมดทดสอบ: เปิดหน้าได้โดยไม่มีข้อผิดพลาด · ยังไม่เชื่อมฐานข้อมูลจริงจะเปิดโหมดทดสอบไม่ได้ · เลขเอกสารในโหมดทดสอบมีคำนำหน้า TEST-', async () => {
  const { page, errors } = await openPage('/admin/settings/test')
  try {
    const r = await page.evaluate(async () => {
      const TM = await import('/src/lib/testMode.js')
      TM.writeTestMode(true)
      const onWhenDisconnected = TM.testModeOn(false)
      const withPrefix = TM.docCode('ABC-1', true)
      const withoutPrefix = TM.docCode('ABC-1', false)
      TM.writeTestMode(false)
      return { onWhenDisconnected, withPrefix, withoutPrefix, text: document.body.innerText }
    })
    assert.equal(r.onWhenDisconnected, false)
    assert.equal(r.withPrefix, 'TEST-ABC-1')
    assert.equal(r.withoutPrefix, 'ABC-1')
    assert.match(r.text, /โหมดทดสอบ/)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าคิวรอตรวจออร์เดอร์: เปิดหน้าได้โดยไม่มีข้อผิดพลาด · แสดงหัวข้อคิว', async () => {
  const { page, errors } = await openPage('/admin/settings/sync-review')
  try {
    const text = await page.evaluate(() => document.body.innerText)
    assert.match(text, /คิวรอตรวจออร์เดอร์/)
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
