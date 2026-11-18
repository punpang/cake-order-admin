// e2e ฟีเจอร์ใหม่: (1) สรุปยอดประจำวันเข้าทีมหลังปิดกะ (2) พร้อมรับส่ง Facebook ด้วย (3) จำกัดออเดอร์ต่อวัน
// รันในเบราว์เซอร์จริง (โหมดเดโม) · ข้อมูลจำลองในหน่วยความจำ ไม่แตะฐานข้อมูลจริง
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })

async function openPage(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors }
}

const cases = []
const t = (name, fn) => cases.push([name, fn])
const ev = (page, fn, arg) => page.evaluate(fn, arg)

t('สรุปยอดประจำวัน: ปิดกะแล้วเข้าทีม (Telegram) พร้อมยอด ไม่มีตัวแปรค้าง', async () => {
  const { page, errors } = await openPage('/admin/pos')
  try {
    const r = await ev(page, () => {
      const S = window.__store
      if (!S.currentShift()) S.openShift(500)
      S.db.integrations.telegram.enabled = true
      S.db.outbox.splice(0) // เริ่มจากคิวว่าง (ข้อมูลเดิมอาจค้างจากการเปิดหน้าก่อนหน้า)
      S.closeShift(500, 'e2e')
      const row = S.db.outbox.slice(0, 5).find((x) => x.event === 'team_daily_summary') // ข้อความใหม่อยู่บนสุด
      return row ? { channel: row.channel, text: row.text, to: row.to } : null
    })
    assert.ok(r, 'ไม่มีข้อความ team_daily_summary ในคิวส่ง')
    assert.equal(r.channel, 'telegram')
    assert.equal(r.to, 'กลุ่มทีม')
    assert.match(r.text, /สรุปยอดประจำวัน/)
    assert.match(r.text, /บิล \d+ ใบ/)
    assert.doesNotMatch(r.text, /\{[ก-๙A-Za-z]+\}/, `มีตัวแปรที่ไม่ได้แทนค่า: ${r.text}`)
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.context().close() }
})

t('สรุปยอดประจำวัน: ปิดโทรเลขอยู่ → ไม่มีข้อความเข้าทีม', async () => {
  const { page, errors } = await openPage('/admin/pos')
  try {
    const sent = await ev(page, () => {
      const S = window.__store
      if (!S.currentShift()) S.openShift(500)
      S.db.integrations.telegram.enabled = false
      S.db.outbox.splice(0) // เริ่มจากคิวว่าง (ข้อมูลเดิมอาจค้างจากการเปิดหน้าก่อนหน้า)
      S.closeShift(500, 'e2e-off')
      return S.db.outbox.slice(0, 5).some((x) => x.event === 'team_daily_summary')
    })
    assert.equal(sent, false)
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.context().close() }
})

t('พร้อมรับ: กฎเริ่มต้นส่งถึง Facebook ด้วย (ตามช่องทางที่ลูกค้ามี)', async () => {
  const { page, errors } = await openPage('/admin/settings/notify')
  try {
    const chans = await ev(page, () => window.__store.db.notifyRules.find((x) => x.event === 'prepared')?.channels || [])
    assert.ok(chans.includes('facebook'), `prepared ไม่มี facebook: ${chans}`)
    assert.ok(chans.includes('web') && chans.includes('sms'), `ช่องทางเดิมหาย: ${chans}`)
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.context().close() }
})

t('จำกัดออเดอร์ต่อวัน: ครบแล้วสร้างวันเดิมไม่ได้ · วันอื่นยังได้ · 0 = ไม่จำกัด', async () => {
  const { page, errors } = await openPage('/admin/orders')
  try {
    const r = await ev(page, () => {
      const S = window.__store
      const tpl = S.db.orders.find((o) => o.customerId && o.channel !== 'pos' && o.items?.length)
      const c = S.addCustomer({ name: 'ลูกค้าทดสอบความจุ', phone: '0877770001', note: 'e2e' })
      const mk = (pickupAt) => {
        const d = JSON.parse(JSON.stringify(tpl))
        return S.createOrder({ customerId: c.id, pickupAt, fulfillment: 'pickup', items: d.items, vat: d.vat, promoOn: false, quoteItems: true, shipPromo: null, birthday: null }, false)
      }
      S.db.shop.dailyOrderCap = 1
      const a = mk('2027-01-10T10:00')
      const b = mk('2027-01-10T15:00')
      const other = mk('2027-01-11T10:00')
      S.db.shop.dailyOrderCap = 0
      const free = mk('2027-01-10T16:00')
      return {
        firstOk: !a.error, secondErr: b.error || '', otherOk: !other.error, unlimitedOk: !free.error,
      }
    })
    assert.equal(r.firstOk, true, 'ออเดอร์แรกของวันควรสร้างได้')
    assert.match(r.secondErr, /เต็มแล้ว/, 'ออเดอร์ที่ 2 ของวันที่ครบแล้วควรถูกปฏิเสธ')
    assert.equal(r.otherOk, true, 'วันอื่นต้องยังรับได้')
    assert.equal(r.unlimitedOk, true, 'เมื่อ 0 = ไม่จำกัด ต้องรับได้ทุกออเดอร์')
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.context().close() }
})

t('หน้าตั้งค่าร้าน: ตั้งจำนวนออเดอร์ต่อวันได้ · ค่าไม่ถูกต้องถูกปฏิเสธ · บันทึกแล้วมีผลจริง', async () => {
  const { page, errors } = await openPage('/admin/settings/shop')
  try {
    const input = page.getByLabel('จำนวนออเดอร์สูงสุดต่อวัน')
    await input.waitFor({ state: 'visible', timeout: 20000 })
    // ค่าเกินช่วง (ช่องตัวเลขจำนวนเต็มตัดจุดทิ้งเอง จึงใช้ค่ามากกว่า 9999) → ข้อความผิดพลาด และไม่บันทึก
    await input.fill('99999')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.getByText('จำนวนออเดอร์สูงสุดต่อวันต้องเป็นจำนวนเต็ม 0–9999').waitFor({ timeout: 5000 })
    assert.equal(await ev(page, () => window.__store.db.shop.dailyOrderCap), 0, 'ค่าไม่ถูกต้องต้องไม่ถูกบันทึก')
    // ค่าที่ถูกต้อง → บันทึกและมีผลกับ store
    await input.fill('7')
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
    await page.waitForFunction(() => window.__store.db.shop.dailyOrderCap === 7, null, { timeout: 5000 })
    assert.deepEqual(errors, [], `หน้าเว็บโยนข้อผิดพลาด: ${errors.join(' | ')}`)
  } finally { await page.context().close() }
})

let fails = 0
for (const [name, fn] of cases) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    fails++
    console.log(`FAIL ${name}\n  ${String(e?.message || e).split('\n').slice(0, 6).join('\n  ')}`)
  }
}
await browser.close()
await server.close()
console.log(`\nรวม ${cases.length} กรณี · ผ่าน ${cases.length - fails} · ไม่ผ่าน ${fails}`)
process.exitCode = fails ? 1 : 0
