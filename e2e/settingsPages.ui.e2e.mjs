// ทดสอบพฤติกรรมของหน้าตั้งค่าความเสี่ยงสูงที่ยังไม่มีเทสต์ (B10): ราคา/วัตถุดิบ · ตัวเลือก/ชุดสินค้า · การเชื่อมต่อ · คำขอลบข้อมูล · คำขอไม่ให้ใช้รูป
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

t('หน้าการกำหนดราคาและวัตถุดิบ: ราคาที่ไม่ใช่ตัวเลขเป็น 0 · บรรจุภัณฑ์/ราคาวัตถุดิบแปลงเป็นตัวเลข', async () => {
  const { page, errors } = await openPage('/admin/settings/pricing')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const typeGroup = S.db.optionGroups.find((g) => g.key === 'type')
      const typeId = typeGroup.options[0].id
      const priceOf = () => typeGroup.options.find((o) => o.id === typeId).price
      S.saveMainPrices({ types: { [typeId]: '450' } })
      const priced = priceOf()
      S.saveMainPrices({ types: { [typeId]: 'abc' } })
      const junk = priceOf()
      const ing = S.saveIngredient({ name: 'e2e-วัตถุดิบ', packSize: 'abc', packPrice: '12' })
      return { priced, junk, ing: { packSize: ing.packSize, packPrice: ing.packPrice } }
    })
    assert.equal(r.priced, 450)
    assert.equal(r.junk, 0)
    assert.deepEqual(r.ing, { packSize: 0, packPrice: 12 })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าตัวเลือกและชุดสินค้า: ประเภทใหม่ราคาเริ่มที่ 0 · ชุดสินค้าเก็บเฉพาะกลุ่ม/ตัวเลือก และสไตล์แบบ own', async () => {
  const { page, errors } = await openPage('/admin/settings/options')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const typeGroup = S.db.optionGroups.find((g) => g.key === 'type')
      const opt = S.saveOption(typeGroup.id, { name: 'e2e-ประเภทใหม่', price: 999, sizePrices: { x: 5 } })
      const b = S.saveBundle({
        name: 'e2e-ชุด',
        items: [{ groupId: typeGroup.id, optionId: typeGroup.options[0].id, extra: 'ตัดทิ้ง' }],
        discount: {},
        styleMode: { a: 'own', b: 'shared' },
      })
      return {
        price: opt.price,
        sizePrices: opt.sizePrices,
        itemCount: b.items.length,
        extraKept: 'extra' in b.items[0],
        styleMode: b.styleMode,
      }
    })
    assert.equal(r.price, 0)
    assert.deepEqual(r.sizePrices, {})
    assert.equal(r.itemCount, 1)
    assert.equal(r.extraKept, false)
    assert.deepEqual(r.styleMode, { a: 'own' })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('หน้าการเชื่อมต่อ: token และ chat id ผิดรูปแบบถูกปฏิเสธ · ทดสอบส่งเมื่อยังไม่เชื่อมต่อถูกปฏิเสธ · เทมเพลตแจ้งเตือนถูกตัดช่องว่าง', async () => {
  const { page, errors } = await openPage('/admin/settings/integrations')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      S.disconnectIntegration('telegram')
      const badToken = S.connectTelegram({ token: 'not-a-token', chatId: '-1001234567' })
      const badChat = S.connectTelegram({ token: '123456789:AAbcdefghijklmnopqrstuvwxyz0123456789', chatId: 'abc' })
      const testNotConnected = S.sendIntegrationTest('telegram')
      const rule = S.db.notifyRules[0]
      S.saveNotifyRule(rule.event, { channels: [...rule.channels], template: '   ข้อความทดสอบ   ', enabled: false })
      return {
        badToken: badToken.error,
        badChat: badChat.error,
        testNotConnected: testNotConnected.error,
        rule: { template: rule.template, enabled: rule.enabled },
      }
    })
    assert.match(r.badToken, /^รูปแบบ bot token ไม่ถูกต้อง/)
    assert.match(r.badChat, /^chat id ต้องเป็นตัวเลข/)
    assert.equal(r.testNotConnected, 'ยังไม่ได้เชื่อม')
    assert.deepEqual(r.rule, { template: 'ข้อความทดสอบ', enabled: false })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('คำขอลบข้อมูล: ปฏิเสธต้องมีเหตุผล · ตัดสินซ้ำไม่ได้ · อนุมัติซ้ำหลังดำเนินการแล้วไม่ได้', async () => {
  const { page, errors } = await openPage('/admin/settings/deletion-requests')
  try {
    const r = await page.evaluate(async () => {
      const S = window.__store
      S.db.deletionRequests.unshift({ id: 'e2e-dr-1', customerId: S.db.customers[0].id, status: 'pending', customerNote: '', reason: '', createdAt: Date.now(), decidedAt: null, decidedBy: '' })
      const noReason = S.rejectDeletion('e2e-dr-1', '   ')
      const ok = S.rejectDeletion('e2e-dr-1', '  ข้อมูลไม่ครบ  ')
      const again = S.rejectDeletion('e2e-dr-1', 'ซ้ำ')
      const approveAgain = await S.approveDeletion('e2e-dr-1')
      const req = S.db.deletionRequests.find((x) => x.id === 'e2e-dr-1')
      return { noReason: noReason.error, ok: ok.ok, again: again.error, approveAgain: approveAgain.error, status: req.status, reason: req.reason }
    })
    assert.equal(r.noReason, 'ใส่เหตุผลที่ปฏิเสธ')
    assert.equal(r.ok, true)
    assert.equal(r.again, 'คำขอนี้ดำเนินการแล้ว')
    assert.equal(r.approveAgain, 'คำขอนี้ดำเนินการแล้ว')
    assert.equal(r.status, 'rejected')
    assert.equal(r.reason, 'ข้อมูลไม่ครบ')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('คำขอไม่ให้ใช้รูป: ไม่อนุมัติต้องมีเหตุผล · อนุมัติแล้วรูปห้ามใช้ · อนุมัติซ้ำไม่ได้ · เปิดให้ใช้คืนได้เมื่อลูกค้าเปลี่ยนใจ', async () => {
  const { page, errors } = await openPage('/admin/settings/photo-requests')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      const o = S.db.orders[0]
      S.db.photoRequests.unshift({ id: 'e2e-pr-1', orderId: o.id, customerId: o.customerId, status: 'pending', note: '', createdAt: Date.now(), decidedAt: null, decidedBy: null, decisionNote: '' })
      o.photoConsent = { status: 'requested', requestedAt: Date.now(), note: '', history: [] }
      const noReason = S.rejectPhotoOptOut('e2e-pr-1', '')
      const approved = S.approvePhotoOptOut('e2e-pr-1', { notify: false, sms: false })
      const statusAfterApprove = S.photoStatusOf(o)
      const approvedAgain = S.approvePhotoOptOut('e2e-pr-1', {})
      const allow = S.allowPhotosAgain(o.id)
      return {
        noReason: noReason.error,
        approved: approved.ok,
        statusAfterApprove,
        approvedAgain: approvedAgain.error,
        allow: allow.ok,
        statusAfterAllow: S.photoStatusOf(o),
      }
    })
    assert.equal(r.noReason, 'ใส่เหตุผลที่ไม่อนุมัติ')
    assert.equal(r.approved, true)
    assert.equal(r.statusAfterApprove, 'revoked')
    assert.equal(r.approvedAgain, 'คำขอนี้ดำเนินการแล้ว')
    assert.equal(r.allow, true)
    assert.equal(r.statusAfterAllow, 'ok')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

t('พนักงานที่ไม่มีสิทธิ์ manage: เชื่อมต่อช่องทาง · ตัดสินคำขอลบ · ตัดสินคำขอรูป · เปิดใช้รูปคืน ถูกปฏิเสธทั้งหมด', async () => {
  const { page, errors } = await openPage('/admin/settings/photo-requests')
  try {
    const r = await page.evaluate(() => {
      const S = window.__store
      S.db.users.push({ id: 'e2e-sales-pages', name: 'พนักงานทดสอบ', email: 'e2e-sales-pages@example.com', role: 'sales', active: true, perms: ['viewAllOrders', 'createOrder'] })
      S.switchUser('e2e-sales-pages')
      const o = S.db.orders[0]
      S.db.deletionRequests.unshift({ id: 'e2e-dr-2', customerId: S.db.customers[0].id, status: 'pending', customerNote: '', reason: '', createdAt: Date.now(), decidedAt: null, decidedBy: '' })
      S.db.photoRequests.unshift({ id: 'e2e-pr-2', orderId: o.id, customerId: o.customerId, status: 'pending', note: '', createdAt: Date.now(), decidedAt: null, decidedBy: null, decisionNote: '' })
      return {
        canManage: S.can('manage'),
        connect: S.connectTelegram({ token: '123456789:AAbcdefghijklmnopqrstuvwxyz0123456789', chatId: '-1001234567' }).error,
        deletion: S.rejectDeletion('e2e-dr-2', 'เหตุผล').error,
        photoApprove: S.approvePhotoOptOut('e2e-pr-2', {}).error,
        photoReject: S.rejectPhotoOptOut('e2e-pr-2', 'เหตุผล').error,
        allow: S.allowPhotosAgain(o.id).error,
      }
    })
    assert.equal(r.canManage, false)
    assert.equal(r.connect, 'เฉพาะแอดมิน')
    assert.equal(r.deletion, 'เฉพาะแอดมิน')
    assert.equal(r.photoApprove, 'เฉพาะแอดมิน')
    assert.equal(r.photoReject, 'เฉพาะแอดมิน')
    assert.equal(r.allow, 'เฉพาะแอดมิน')
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
