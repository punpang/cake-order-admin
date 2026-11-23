// หน้ารายการออร์เดอร์ (/admin/orders) มุมมองการ์ด: จอแนวนอน 1280×800 เรียง 3 คอลัมน์ · ชื่อเค้กยาวตัดด้วย … ไม่ดันการ์ดล้น
// โหมดเชื่อม Supabase · เซิร์ฟเวอร์จำลอง ไม่แตะฐานข้อมูลจริง · รัน: node e2e/orderListLayout.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const pick = () => new Date(Date.now() + 3 * 3600e3).toISOString()
const cust = (id, name) => ({ id, name, phone: '0850001111', note: '', data: { memberCode: 'M' + id, points: [] }, updated_at: at(5), created_at: at(30) })
const row = (id, code, c, total, name) => ({ id, code, customer_id: c, status: 'new', fulfillment: 'pickup', channel: 'store', updated_at: at(1), created_at: at(1), data: { pickupAt: pick(), total, items: [{ id: 'l' + id, name, qty: 1, unitPrice: total, lineTotal: total }], createdAt: at(1), payments: [], balance: total } })
const orders = [
  row('o1', 'ORD-0001', 'c1', 450, 'เค้กทดสอบ'),
  row('o2', 'ORD-0002', 'c2', 900, 'เค้กทดสอบ'),
  row('o3', 'ORD-0003', 'c1', 1350, 'เค้กช็อกโกแลตขนาดใหญ่สำหรับงานรวมญาติที่ยาวมาก ๆ'),
]

let fails = 0
const app = await startApp({ tables: { punpang_customers: [cust('c1', 'มาลี ทดสอบ'), cust('c2', 'สมชาย ทดสอบ')], punpang_orders: orders } })
const { page, go } = app
const s = stepper(page)
try {
  await go('/admin/orders')
  await page.getByRole('button', { name: 'ดูทั้งหมด' }).click().catch(() => {})
  await page.getByText('ORD-0003').first().waitFor({ timeout: 10000 })
  await s.step('1280×800: การ์ดออร์เดอร์เรียง 3 คอลัมน์ในแถวเดียว', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const links = page.locator('a[href^="#/admin/orders/o"]')
    const boxes = []
    for (let i = 0; i < 3; i++) boxes.push(await links.nth(i).boundingBox())
    assert.ok(boxes.every(Boolean), 'ไม่พบการ์ดออร์เดอร์ครบ 3 ใบ')
    assert.ok(Math.abs(boxes[0].y - boxes[2].y) < 4, `การ์ดไม่อยู่แถวเดียวกัน: ${JSON.stringify(boxes.map((b) => b.y))}`)
    assert.ok(boxes[1].x > boxes[0].x + boxes[0].width - 1 && boxes[2].x > boxes[1].x + boxes[1].width - 1, 'การ์ดไม่ได้วางต่อกันแนวนอน')
  })
  await s.step('1280×800: ชื่อเค้กยาวไม่ดันการ์ดให้ล้นกรอบ', async () => {
    const card = page.locator('a[href="#/admin/orders/o3"]').first()
    const b = await card.boundingBox()
    const over = await card.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    assert.ok(b && b.x + b.width <= 1280, 'การ์ดล้นขอบขวาจอ')
    assert.equal(over, false, 'เนื้อหาในการ์ดล้นกรอบ')
  })
  await s.step('ไม่มีข้อผิดพลาดในหน้า', async () => assert.deepEqual(app.pageErrors().slice(0, 3), []))
} finally {
  await app.close()
}
fails += s.finish()
process.exit(fails ? 1 : 0)
