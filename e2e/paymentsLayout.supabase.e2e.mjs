// หน้าชำระเงิน (/admin/payments): จอแนวนอน 1280×800 เรียงการ์ด 3 คอลัมน์ในแถวเดียว · ปุ่มสร้าง QR อยู่แถวเดียวกับหัวข้อ
// โหมดเชื่อม Supabase · เซิร์ฟเวอร์จำลอง ไม่แตะฐานข้อมูลจริง · รัน: node e2e/paymentsLayout.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const pick = () => new Date(Date.now() + 3 * 3600e3).toISOString()
const cust = (id, name) => ({ id, name, phone: '0850001111', note: '', data: { memberCode: 'M' + id, points: [] }, updated_at: at(5), created_at: at(30) })
const row = (id, code, c, total) => ({ id, code, customer_id: c, status: 'new', fulfillment: 'pickup', channel: 'store', updated_at: at(1), created_at: at(1), data: { pickupAt: pick(), total, items: [{ id: 'l' + id, name: 'เค้กทดสอบ', qty: 1, unitPrice: total, lineTotal: total }], createdAt: at(1), payments: [], balance: total } })
const orders = [row('o1', 'ORD-0001', 'c1', 450), row('o2', 'ORD-0002', 'c2', 900), row('o3', 'ORD-0003', 'c1', 1350)]

const app = await startApp({ tables: { punpang_customers: [cust('c1', 'มาลี ทดสอบ'), cust('c2', 'สมชาย ทดสอบ')], punpang_orders: orders } })
const { page, go } = app
const s = stepper(page)
try {
  await go('/admin/payments')
  await page.getByRole('button', { name: /ค้างชำระ/ }).click()
  await page.getByText('ORD-0003').first().waitFor({ timeout: 10000 })
  await s.step('1280×800: การ์ดชำระเงิน 3 คอลัมน์ในแถวเดียว', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const cards = page.locator('li[data-order]')
    const boxes = []
    for (let i = 0; i < 3; i++) boxes.push(await cards.nth(i).boundingBox())
    assert.ok(boxes.every(Boolean), 'ไม่พบการ์ดครบ 3 ใบ')
    assert.ok(Math.abs(boxes[0].y - boxes[2].y) < 4, `การ์ดไม่อยู่แถวเดียวกัน: ${JSON.stringify(boxes.map((b) => b.y))}`)
    assert.ok(boxes[1].x > boxes[0].x + boxes[0].width - 1 && boxes[2].x > boxes[1].x + boxes[1].width - 1, 'การ์ดไม่ได้วางต่อกันแนวนอน')
  })
  await s.step('1280×800: ปุ่มสร้าง QR อยู่แถวเดียวกับหัวข้อ', async () => {
    const title = await page.getByRole('heading', { name: 'ชำระเงิน' }).boundingBox()
    const qr = await page.getByRole('link', { name: 'สร้าง QR ชำระ' }).boundingBox()
    assert.ok(title && qr, 'ไม่พบหัวข้อหรือปุ่มสร้าง QR')
    assert.ok(Math.abs(qr.y - title.y) < 40, `ปุ่มสร้าง QR ไม่ได้อยู่ข้างหัวข้อ: ${JSON.stringify({ title, qr })}`)
  })
  await s.step('ไม่มีข้อผิดพลาดในหน้า', async () => assert.deepEqual(app.pageErrors().slice(0, 3), []))
} finally {
  await app.close()
}
process.exit(s.finish() ? 1 : 0)
