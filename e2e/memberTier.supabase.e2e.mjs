// ตัวอย่างแต้มที่บิลนี้จะได้ และป้ายระดับ ที่หน้าขาย POS (โหมดเชื่อม Supabase · เซิร์ฟเวอร์จำลอง ไม่แตะฐานข้อมูลจริง)
// ครอบคลุม: โหมดใช้จริง → ป้าย "LV2 · x3" และ "บิลนี้จะได้ N แต้ม · คูณ x3" (พอดีจอ 390px) · โหมดทดลอง → มีป้ายแต่ไม่แสดงตัวอย่างแต้ม
// ตัวตอบ RPC ของระดับสมาชิกเป็นค่าที่กำหนดในเทสต์ · การคำนวณจริงทดสอบใน supabase/tests/member_levels.test.sql
// รัน: node e2e/memberTier.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const cust = { id: 'c1', name: 'มาลี ทดสอบ', phone: '0850001111', note: '', data: { memberCode: 'M0001', points: [] }, updated_at: at(5), created_at: at(30) }
const cake = { id: 'cake1', kind: 'retail', name: 'เค้กทดสอบ', price: 450, active: true, data: { stock: 50, category: 'เค้ก' } }
// การ์ดพนักงาน: LV2 ใช้งานอยู่ ตัวคูณ 3 · ตัวอย่างตัวคูณของบิล: โหมดใช้จริง = 3 · โหมดอื่น = 1
const memberRpc = (mode) => ({
  punpang_member_staff_card: () => ({ mode, level: 2, levelName: 'LV2', mult: 3, active: true }),
  punpang_member_quote: () => ({ mode, mult: mode === 'live' ? 3 : 1 }),
})
const BADGE = { live: 'LV2 · x3', shadow: 'LV2 · ทดลอง · จะได้ x3' }

let fails = 0
for (const mode of ['live', 'shadow']) {
  const app = await startApp({ tables: { punpang_customers: [cust], punpang_items: [cake], __rpc: memberRpc(mode) } })
  const { page, go } = app
  const { step, finish } = stepper(page)
  const tile = () => page.getByText(/^ลูกค้าจะได้/).first()
  try {
    await step(`${mode}: เลือกสมาชิกที่หน้าขาย`, async () => {
      await go('/admin/pos')
      const open = page.getByRole('button', { name: 'เปิดกะ', exact: true })
      if (await open.isVisible().catch(() => false)) { await open.click(); await page.waitForTimeout(800) }
      await page.getByLabel('เบอร์สมาชิก').fill('0850001111')
      await page.getByRole('button', { name: /มาลี ทดสอบ/ }).first().click()
      await page.getByRole('button', { name: 'เปลี่ยนสมาชิก' }).waitFor({ timeout: 10000 })
    })
    await step(`${mode}: ชำระเงิน → ป้ายระดับและตัวอย่างแต้มตามโหมด`, async () => {
      await page.getByRole('button', { name: /เค้กทดสอบ/ }).first().click()
      await page.getByRole('button', { name: 'ชำระเงิน', exact: true }).first().click()
      await page.getByText(BADGE[mode], { exact: true }).first().waitFor({ timeout: 10000 })
      if (mode === 'live') {
        const per = await page.evaluate(async () => (await import('/src/data/store.js')).db.loyalty.earnPer)
        await tile().waitFor({ state: 'visible', timeout: 10000 })
        const txt = await tile().innerText()
        assert.ok(txt.includes(`${Math.floor((450 * 3) / per)} แต้ม`), `แต้มในตัวอย่างไม่ถูกต้อง: ${txt}`)
        assert.ok(txt.includes('คูณ x3'), `ไม่มีข้อความตัวคูณ: ${txt}`)
        await page.setViewportSize({ width: 390, height: 844 })
        await tile().waitFor({ state: 'visible', timeout: 5000 })
        const box = await tile().boundingBox()
        assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `ล้นจอ 390px: ${JSON.stringify(box)}`)
      } else {
        await page.waitForTimeout(1200) // รอคำตอบของตัวอย่างแต้ม (หน่วงเวลา 250 มิลลิวินาที)
        assert.equal(await page.getByText(/ลูกค้าจะได้/).count(), 0, 'โหมดทดลองต้องไม่แสดงตัวอย่างแต้ม')
      }
    })
    await step(`${mode}: ไม่มีข้อผิดพลาดในหน้า`, async () => assert.deepEqual(app.pageErrors().slice(0, 3), []))
  } finally {
    await app.close()
  }
  fails += finish()
}
process.exit(fails ? 1 : 0)
