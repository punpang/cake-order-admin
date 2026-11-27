// ระดับสมาชิก (เฟส 1) บนแอปจริงที่เชื่อม Supabase: แท็บระดับ (รายงาน) · ป้ายระดับที่ POS (หน้าชำระเงิน) · การ์ดระดับในบัญชีลูกค้า
// เซิร์ฟเวอร์จำลองในเครื่อง (RPC/Edge Function ตอบตามรูปแบบของ migration 20261122110200 และ customer-auth) · ไม่แตะฐานข้อมูลจริง
// ข้อจำกัด: ค่าที่ตอบเป็นตัวอย่างจำลอง การคำนวณระดับจริงทดสอบใน supabase/tests/member_levels.test.sql
// รัน: node e2e/memberTiers.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

// สถานะที่เทสต์เปลี่ยนระหว่างขั้น (RPC/Edge Function อ่านค่าตอนถูกเรียก)
const state = { mode: 'live', card: null }
const LIVE_CARD = { enabled: true, mode: 'live', levelNo: 2, levelName: 'LV2', mult: 3, status: 'active', golden: false, renewAt: '2026-11-01', activeUntil: '2027-11-01', downgradeAt: '2027-11-01' }
const REPORT = {
  days: 30,
  levels: [
    { levelNo: 1, levelName: 'LV1', members: 3, base: 12000, extraPoints: 0, costPct: 0, fullCostPct: 0.5 },
    { levelNo: 2, levelName: 'LV2', members: 2, base: 5000, extraPoints: 20, costPct: 0.4, fullCostPct: 1.2 },
  ],
  total: { members: 5, base: 17000, extraPoints: 20, costPct: 0.12, fullCostPct: 0.8 },
}
const CUSTOMER = { id: 'c1', name: 'สมชาย ทดสอบ', phone: '0812345678', note: '', data: { memberCode: 'M001', points: [] }, updated_at: at(1), created_at: at(30) }
// ลูกค้ายอมรับเอกสารเวอร์ชันตั้งต้นของแอป (db.legal.docs) แล้ว · ไม่งั้นแอปพาไปหน้ายอมรับเอกสารก่อน
const CONSENTS = ['privacy', 'terms'].map((kind, i) => ({ id: `cs${i}`, customerId: CUSTOMER.id, kind, version: 2, detail: null, at: at(5), via: 'register' }))

const rpc = {
  punpang_member_staff_card: () => (state.card ? { ...state.card, mode: state.mode } : { enabled: false }),
  punpang_member_report: () => REPORT,
  punpang_member_quote: () => ({ applied: false, mult: 1 }),
}
// Edge Function customer-auth: ตอบบัญชีลูกค้าที่ล็อกอินอยู่ (เฉพาะ action session) · ระดับส่งให้ลูกค้าเฉพาะโหมดใช้จริง (เหมือนเซิร์ฟเวอร์จริง)
const customerBundle = () => ({
  ok: true,
  customer: CUSTOMER,
  orders: [],
  coupons: [],
  consents: CONSENTS,
  reviews: [],
  deletionRequests: [],
  tier: state.mode === 'live' && state.card ? { ...state.card, mode: undefined } : { enabled: false },
  shop: { payment: null },
})
const fn = { 'customer-auth': (b) => (b.action === 'session' ? customerBundle() : { ok: true }) }

const app = await startApp({
  tables: {
    punpang_customers: [CUSTOMER],
    punpang_items: [{ id: 'rt1', kind: 'retail', name: 'คัพเค้กวานิลลา', price: 45, active: true, data: { stock: 50, category: 'คัพเค้ก' } }],
  },
  rpc,
  fn,
})
const { page, go, pageErrors, guestPage, close } = app
const { step, finish } = stepper(page)

try {
  await step('1. แท็บระดับ: แสดงขั้น LV1–LV4 และรายงานรวม (ส่วนเพิ่ม/สูตรเต็ม)', async () => {
    await go('/admin/settings/loyalty')
    await page.getByRole('button', { name: 'ระดับ', exact: true }).first().click()
    await page.getByRole('button', { name: 'ทดลอง', exact: true }).first().waitFor({ timeout: 15000 })
    const text = await page.locator('body').innerText()
    assert.ok(text.includes('LV1') && text.includes('LV4'), 'ต้องเห็นชื่อขั้นตั้งต้น LV1–LV4')
    await page.getByText('ส่วนเพิ่ม 0.12%').waitFor({ timeout: 15000 })
    assert.ok((await page.locator('body').innerText()).includes('สูตรเต็ม 0.8%'), 'ต้องเห็นต้นทุนสูตรเต็มของแถวรวม')
  })

  await step('2. POS (ใช้จริง): เลือกสมาชิก → หน้าชำระเงินแสดงป้ายระดับและตัวคูณ', async () => {
    state.mode = 'live'
    state.card = LIVE_CARD
    await openPaymentWithMember()
    const badge = page.getByLabel('ระดับสมาชิก', { exact: true })
    await badge.getByText('LV2', { exact: true }).waitFor({ timeout: 15000 })
    const txt = await badge.innerText()
    assert.ok(txt.includes('x3'), 'ต้องแสดงตัวคูณ x3')
    assert.ok(!txt.includes('โหมดทดลอง'), 'โหมดใช้จริงต้องไม่มีป้ายโหมดทดลอง')
  })

  await step('3. POS (ทดลอง): ป้ายแสดงว่าแต้มยังไม่คูณ', async () => {
    state.mode = 'shadow'
    await openPaymentWithMember()
    await page.getByText('โหมดทดลอง · แต้มยังไม่คูณ', { exact: true }).waitFor({ timeout: 15000 })
  })

  await step('4. POS (ปิด/ไม่มีสิทธิ์): ไม่แสดงป้ายระดับ', async () => {
    state.card = null
    await openPaymentWithMember()
    await page.waitForTimeout(800) // ให้การ์ดสมาชิกตอบกลับก่อนตรวจว่าไม่มีป้าย
    assert.equal(await page.getByLabel('ระดับสมาชิก', { exact: true }).count(), 0, 'ต้องไม่มีป้ายระดับเมื่อเซิร์ฟเวอร์ไม่เปิดให้เห็น')
  })

  await step('5. บัญชีลูกค้า (ใช้จริง): การ์ดระดับแสดงขั้นและตัวคูณ', async () => {
    state.mode = 'live'
    state.card = LIVE_CARD
    const p = await openCustomerRewards()
    await p.getByLabel('ระดับสมาชิก', { exact: true }).getByText('LV2 · แต้มคูณ 3 เท่า', { exact: true }).waitFor({ timeout: 15000 })
    assert.ok((await p.getByLabel('ระดับสมาชิก', { exact: true }).innerText()).includes('ใช้สิทธิ์ถึง'), 'ต้องมีบรรทัดวันใช้สิทธิ์')
    await p.context().close()
  })

  await step('6. บัญชีลูกค้า (ทดลอง/ปิด): ไม่เห็นการ์ดระดับ', async () => {
    for (const [mode, card] of [['shadow', LIVE_CARD], ['live', null]]) {
      state.mode = mode
      state.card = card
      const p = await openCustomerRewards()
      assert.equal(await p.getByText('แต้มคูณ').count(), 0, `โหมด ${mode}: ลูกค้าต้องไม่เห็นระดับ`)
      assert.equal(await p.getByLabel('ระดับสมาชิก', { exact: true }).count(), 0, `โหมด ${mode}: ต้องไม่มีการ์ดระดับ`)
      await p.context().close()
    }
  })

  await step('7. ไม่มีข้อผิดพลาดของหน้าเว็บตลอดชุดทดสอบ', async () => {
    assert.deepEqual(pageErrors(), [])
  })
} finally {
  const bad = finish()
  await close()
  if (bad) process.exitCode = 1
}

// เริ่มขายใหม่ (ออกจากหน้าไปก่อน และล้างบิลค้างของแท็บนี้) → เปิดกะถ้ายังไม่เปิด → กรอกเบอร์สมาชิกแล้วกดเลือกผลค้นหา
// → หยิบสินค้า 1 ชิ้น → กดชำระเงิน · ป้ายระดับของพนักงานอยู่ในหน้าชำระเงิน (ข้อมูลลูกค้าและรายการชำระ)
async function openPaymentWithMember() {
  await go('/admin/settings/loyalty')
  await page.evaluate(() => sessionStorage.removeItem('pos-draft-v1'))
  await go('/admin/pos')
  const gate = page.getByLabel('เบอร์สมาชิก', { exact: true })
  const openShift = page.getByRole('button', { name: 'เปิดกะ', exact: true })
  await gate.or(openShift).first().waitFor({ timeout: 15000 })
  if (await openShift.isVisible()) { await openShift.click(); await gate.waitFor({ timeout: 15000 }) } // ยังไม่มีกะของวัน → เปิดกะด้วยค่าตั้งต้น
  await gate.fill(CUSTOMER.phone)
  await page.getByRole('button', { name: new RegExp(CUSTOMER.name) }).first().click() // พิมพ์เบอร์แล้วต้องกดเลือกผลค้นหาเอง (ไม่เลือกอัตโนมัติ)
  await gate.waitFor({ state: 'detached', timeout: 15000 }) // ช่องเบอร์หายเมื่อเลือกลูกค้าแล้ว
  await page.getByRole('button', { name: 'เปลี่ยนสมาชิก', exact: true }).waitFor({ timeout: 15000 })
  // ป้ายที่หน้าขาย (ถัดจากปุ่มสมาชิก) ต้องแสดงเมื่อเซิร์ฟเวอร์เปิดให้เห็นเท่านั้น
  if (state.card?.enabled) await page.getByLabel('ระดับสมาชิกที่หน้าขาย', { exact: true }).getByText(state.card.levelName, { exact: true }).waitFor({ timeout: 15000 })
  else assert.equal(await page.getByLabel('ระดับสมาชิกที่หน้าขาย', { exact: true }).count(), 0, 'ต้องไม่มีป้ายที่หน้าขายเมื่อเซิร์ฟเวอร์ไม่เปิดให้เห็น')
  await page.getByRole('button', { name: /คัพเค้กวานิลลา/ }).first().click()
  await page.getByRole('button', { name: 'ชำระเงิน', exact: true }).first().click()
  await page.getByText(CUSTOMER.name, { exact: true }).first().waitFor({ timeout: 15000 })
}

// เปิดแท็บ "สิทธิประโยชน์" ของบัญชีลูกค้าในเบราว์เซอร์แยก (ไม่มีการล็อกอินพนักงาน) · ตั้งโทเคนเซสชันก่อนแอปโหลด ให้แอปกู้บัญชีเอง
async function openCustomerRewards() {
  const p = await guestPage()
  await p.addInitScript(() => localStorage.setItem('punpang_customer_session', 'tok-e2e-member'))
  await p.goto(`${app.base}/#/account?tab=rewards`, { waitUntil: 'domcontentloaded' })
  await p.getByRole('heading', { name: CUSTOMER.name, level: 1 }).waitFor({ timeout: 15000 })
  return p
}
