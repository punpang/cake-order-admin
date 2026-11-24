// สั่งล่วงหน้า (ฝั่งลูกค้า) บนแอปจริงที่เชื่อม Supabase: เลือกแคมเปญ → ดูราคา → ยืนยัน OTP (ลูกค้าใหม่ต้องยินยอม) → สั่งสินค้า → ออร์เดอร์ของฉัน
// เซิร์ฟเวอร์จำลองตอบ Edge Function 'preorder' ตามรูปแบบของ supabase/functions/preorder/index.ts · ไม่แตะฐานข้อมูลจริง
// ข้อจำกัด: ไม่ทดสอบ Turnstile (ไม่ตั้ง VITE_TURNSTILE_SITE_KEY) และการคิดราคาจริงอยู่ในเทสต์ Deno/SQL
// รัน: node e2e/preorderStore.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

// สถานะที่เทสต์เปลี่ยนระหว่างขั้น (เซิร์ฟเวอร์จำลองอ่านค่าตอนถูกเรียก)
const state = { session: false, orders: [] }
const CAMPAIGN = {
  id: 'pc1', name: 'เค้กคริสต์มาส', orderFrom: '2026-11-01', orderTo: '2026-12-31', pickupFrom: '2026-12-24', pickupTo: '2026-12-26',
  depositPercent: 50, payDueMin: 120, parcelEnabled: true, shipping: { shipFrom: '2026-12-22', shipTo: '2026-12-23' }, deals: [],
  items: [{ retailId: 'rt1', name: 'คัพเค้กวานิลลา', price: 45, dayCap: null }],
}

const preorder = (b) => {
  switch (b.action) {
    case 'campaigns': return { campaigns: [CAMPAIGN] }
    // ส่งพัสดุ: ค่าส่งรวม (ค่าธรรมเนียม + กล่อง + ขนส่ง) เป็นบรรทัดเดียว
    case 'quote': return b.fulfillment === 'delivery' ? { ok: true, total: 175, vat: 0, shippingFee: 85 } : { ok: true, total: 90, vat: 0, shippingFee: 0 }
    case 'otp_request': return { ok: true }
    case 'otp_verify': {
      // ลูกค้าใหม่ต้องยินยอมก่อน (ตามเซิร์ฟเวอร์จริง ตอบ 400 พร้อม needConsent)
      if (b.consent !== true) return { __status: 400, body: { error: 'ต้องยินยอมก่อนสั่งสินค้า', needConsent: true } }
      state.session = true
      return { ok: true, token: 'presess-test-token' }
    }
    case 'create': {
      if (!state.session) return { __status: 401, body: { error: 'กรุณายืนยันเบอร์ใหม่' } }
      const order = { id: b.orderId, code: 'PRE-0001', status: 'awaiting_payment', campaignId: 'pc1', pickupDate: b.pickupDate, total: 90, deposit: { percent: 50, amount: 45 }, payDueAt: at(-2 / 24) }
      state.orders.push(order)
      return { ok: true, already: false, code: 'PRE-0001', orderId: b.orderId, total: 90, deposit: 45, payDueAt: order.payDueAt }
    }
    case 'state': return state.session ? { orders: state.orders } : { __status: 401, body: { error: 'กรุณายืนยันเบอร์ใหม่' } }
    default: return { __status: 400, body: { error: 'ไม่รู้จักคำสั่ง' } }
  }
}

const app = await startApp({ rpc: {}, fn: { preorder } })
const { base, guestPage, close } = app
// ใช้หน้าลูกค้าบริบทใหม่ (ไม่มีการล็อกอินพนักงาน) ตลอดทั้งขั้น
const p = await guestPage()
const { step: s, finish } = stepper(p)

  await s('1. เลือกแคมเปญและดูราคาจากเซิร์ฟเวอร์ (ยอดรวม 90 บาท)', async () => {
    await p.goto(`${base}/#/preorder`, { waitUntil: 'domcontentloaded' })
    await p.getByRole('button', { name: 'เลือกแคมเปญนี้' }).waitFor({ timeout: 30000 })
    await p.getByRole('button', { name: 'เลือกแคมเปญนี้' }).click()
    await p.getByLabel('จำนวน คัพเค้กวานิลลา').fill('2')
    await p.getByRole('button', { name: 'ดูราคา' }).click()
    await p.locator('[data-quote]').waitFor({ timeout: 15000 })
    assert.match(await p.locator('[data-quote]').innerText(), /ยอดรวม 90 บาท/)
  })

  await s('1b. เลือกส่งพัสดุแล้วเห็นช่วงวันจัดส่งของแคมเปญ (แล้วกลับไปรับที่ร้าน)', async () => {
    await p.getByLabel('ส่งพัสดุ').check()
    assert.match(await p.locator('[data-ship]').innerText(), /จัดส่งระหว่าง 2026-12-22 ถึง 2026-12-23/)
    await p.getByRole('button', { name: 'ดูราคา' }).click()
    await p.getByText('ค่าส่ง 85 บาท').waitFor({ timeout: 15000 })
    // ลูกค้าเห็นค่าส่งเป็นบรรทัดเดียว ไม่เห็นรายละเอียดกล่องหรือน้ำหนัก
    const quoteText = await p.locator('[data-quote]').innerText()
    assert.doesNotMatch(quoteText, /กล่อง|กรัม/)
    assert.match(await p.locator('[data-full-payment]').innerText(), /ชำระเต็มจำนวนตอนสั่ง/)
    await p.getByLabel('รับที่ร้าน').check()
    assert.equal(await p.locator('[data-ship]').count(), 0)
    assert.equal(await p.locator('[data-full-payment]').count(), 0)
  })

  await s('2. ยืนยัน OTP: ลูกค้าใหม่ต้องยินยอมก่อนจึงผ่าน', async () => {
    await p.getByLabel('เบอร์โทรศัพท์').fill('0812345678')
    await p.getByRole('button', { name: 'ส่งรหัส OTP' }).click()
    await p.getByLabel('รหัส OTP 6 หลัก').waitFor({ timeout: 15000 })
    await p.getByLabel('รหัส OTP 6 หลัก').fill('123456')
    await p.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    await p.getByLabel('ชื่อผู้สั่ง').waitFor({ timeout: 15000 })
    await p.getByLabel('ชื่อผู้สั่ง').fill('สมชาย ทดสอบ')
    await p.locator('label', { hasText: 'ยินยอมให้ร้านเก็บ' }).locator('input[type=checkbox]').check()
    await p.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    await p.getByText('ยืนยันเบอร์แล้ว').waitFor({ timeout: 15000 })
  })

  await s('3. สั่งสินค้าสำเร็จ แสดงรหัสออร์เดอร์และมัดจำ', async () => {
    await p.getByRole('button', { name: 'ยืนยันสั่งสินค้า' }).click()
    await p.locator('[data-placed]').waitFor({ timeout: 15000 })
    const text = await p.locator('[data-placed]').innerText()
    assert.match(text, /รหัส PRE-0001/)
    assert.match(text, /มัดจำ 45 บาท/)
  })

  await s('4. ออร์เดอร์ของฉันแสดงออร์เดอร์ที่เพิ่งสั่ง (ใช้โทเคนที่เก็บไว้ในเครื่อง)', async () => {
    await p.goto(`${base}/#/preorder/orders`, { waitUntil: 'domcontentloaded' })
    await p.locator('[data-order]').waitFor({ timeout: 15000 })
    const text = await p.locator('[data-order]').innerText()
    assert.match(text, /PRE-0001/)
    assert.match(text, /รอชำระมัดจำ/)
  })

  await s('5. ลูกค้าที่ยังไม่ยืนยันเบอร์เห็นลิงก์ไปยืนยัน (ไม่เห็นออร์เดอร์ของคนอื่น)', async () => {
    const g = await guestPage()
    await g.goto(`${base}/#/preorder/orders`, { waitUntil: 'domcontentloaded' })
    await g.getByRole('link', { name: 'ไปยืนยันเบอร์' }).waitFor({ timeout: 15000 })
    assert.equal(await g.locator('[data-order]').count(), 0)
  })
const bad = finish()
await close()
process.exitCode = bad ? 1 : 0
