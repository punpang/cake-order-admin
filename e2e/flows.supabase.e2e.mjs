// เส้นทางหลักบนแอปจริงที่เชื่อม Supabase (เซิร์ฟเวอร์จำลองในเครื่อง · ไม่แตะฐานข้อมูลจริง)
// POS ขายเงินสด · ยืนยันยอดชำระออร์เดอร์ · หน้าบัญชี · ข้อผิดพลาดของแอปถูกส่งเข้าบันทึก
// ข้อจำกัด: ไม่ทดสอบ RLS/Realtime/เครือข่ายจริง (RLS อยู่ใน supabase/tests)
// รัน: node e2e/flows.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const cust = { id: 'c1', name: 'มาลี ทดสอบ', phone: '0850001111', note: '', data: { memberCode: 'M0001', points: [] }, updated_at: at(5), created_at: at(30) }
const order = (id, status, payments, extra = {}) => ({
  id, code: `OR-${id}`, customer_id: 'c1', status, fulfillment: 'pickup', channel: null, updated_at: at(1), created_at: at(3),
  data: { createdAt: at(3), pickupAt: at(-2), items: [{ name: 'เค้กส้ม 1 ปอนด์', qty: 1, unitPrice: 450, price: 450 }], payments, history: [{ at: at(3), by: 'พนักงาน', action: 'สร้างออร์เดอร์' }], ...extra },
})
const app = await startApp({
  tables: {
    punpang_customers: [cust],
    punpang_items: [{ id: 'rt1', kind: 'retail', name: 'คัพเค้กวานิลลา', price: 45, active: true, data: { stock: 50, category: 'คัพเค้ก' } }],
    punpang_orders: [order('o_rep', 'payment_reported', [{ id: 'p1', status: 'reported', amount: 450, requested: 450, method: 'transfer', at: at(1) }])],
  },
})
const { page, mock, go } = app
const { step, finish } = stepper(page)

try {
  await step('1. POS: เปิดกะ → ขายเงินสด → บิลถูกบันทึกขึ้นเซิร์ฟเวอร์', async () => {
    await go('/admin/pos')
    const open = page.getByRole('button', { name: 'เปิดกะ', exact: true })
    if (await open.isVisible().catch(() => false)) { await open.click(); await page.waitForTimeout(800) }
    await page.getByRole('button', { name: 'ไม่มี', exact: true }).first().click()
    await page.getByRole('button', { name: /คัพเค้กวานิลลา/ }).first().click()
    await page.getByRole('button', { name: 'ชำระเงิน', exact: true }).first().click()
    await page.getByRole('button', { name: 'เงินสด', exact: true }).first().click()
    await page.getByRole('button', { name: 'พอดี', exact: true }).first().click()
    await page.getByRole('button', { name: 'ยืนยันรับเงิน', exact: true }).first().click()
    let bill = null
    for (let i = 0; i < 40 && !bill; i++) { await page.waitForTimeout(250); bill = (mock.db.punpang_orders || []).find((o) => o.channel === 'pos') }
    assert.ok(bill, 'ต้องมีบิล POS ในฐานข้อมูล')
    assert.equal(bill.status, 'delivered')
    assert.ok((mock.db.punpang_shifts || []).some((s) => !s.closed_at), 'ต้องมีกะที่เปิดอยู่ในฐานข้อมูล')
  })

  await step('2. ชำระเงิน: ยืนยันยอดที่ลูกค้าแจ้ง → สถานะออร์เดอร์บนเซิร์ฟเวอร์เปลี่ยน', async () => {
    await go('/admin/payments')
    await page.getByRole('button', { name: /ยืนยันยอด 450/ }).first().click()
    const dlg = page.getByRole('dialog').last()
    await dlg.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click() // ยืนยันซ้ำ: ได้รับจริง 450 บาท
    let row = null
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(250); row = mock.db.punpang_orders.find((o) => o.id === 'o_rep'); if (row.status !== 'payment_reported') break }
    assert.notEqual(row.status, 'payment_reported', `สถานะยังเป็น ${row.status}`)
    assert.equal(row.data.payments.find((p) => p.id === 'p1')?.status, 'confirmed')
  })

  await step('3. บัญชี: เปิดหน้าได้ · โหลดคูปองแบบเต็มสำหรับบัญชี', async () => {
    await go('/admin/accounting')
    await page.getByRole('heading', { name: 'บัญชี', exact: true }).waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    const full = mock.log.some((x) => x.table === 'punpang_records' && x.method === 'GET' && /collection=eq\.coupons/.test(x.q || '') && !/or=/.test(x.q || ''))
    assert.ok(full, 'ต้องโหลดคูปองทั้งหมด (ไม่มีตัวกรอง) เมื่อเปิดหน้าบัญชี')
  })

  await step('4. ข้อผิดพลาดของแอปถูกส่งเข้าบันทึก และดูได้ในหน้าตั้งค่า', async () => {
    await page.evaluate(() => setTimeout(() => { throw new Error('ทดสอบข้อผิดพลาด 0812345678') }, 0))
    let sent = null
    for (let i = 0; i < 20 && !sent; i++) { await page.waitForTimeout(250); sent = mock.log.find((x) => x.rpc === 'punpang_log_error') }
    assert.ok(sent, 'ต้องเรียก punpang_log_error')
    assert.ok(!JSON.stringify(sent.body || {}).includes('0812345678'), 'ต้องตัดเบอร์โทรออกก่อนส่ง')
    mock.db.punpang_error_log = [{ id: 1, at: at(0), last_at: at(0), n: 3, staff_id: 'u-staff', message: 'Error: ทดสอบจากเซิร์ฟเวอร์', stack: 'at x', url: '/#/admin/pos', ua: 'ua', build: 'b1' }]
    await go('/admin/settings/errors')
    await page.getByText('Error: ทดสอบจากเซิร์ฟเวอร์').first().waitFor({ timeout: 10000 })
    await page.getByText('3 ครั้ง').first().waitFor({ timeout: 5000 })
  })

  const errs = app.pageErrors().filter((e) => !/ทดสอบข้อผิดพลาด/.test(e))
  await step('ไม่มีข้อผิดพลาดในหน้า', async () => assert.deepEqual(errs.slice(0, 3), []))
} finally {
  await app.close()
}
process.exit(finish() ? 1 : 0)
