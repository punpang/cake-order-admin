// หน้าสร้างออร์เดอร์ (ขั้นนัดรับ): จอแนวนอน 1280×800 วางสองคอลัมน์ · มือถือ 390px เรียงลงมาคอลัมน์เดียว
// โหมดเชื่อม Supabase · เซิร์ฟเวอร์จำลอง ไม่แตะฐานข้อมูลจริง
// รัน: node e2e/orderCreateLayout.supabase.e2e.mjs
import assert from 'node:assert/strict'
import { startApp, stepper, at } from './_supabaseApp.mjs'

const cust = { id: 'c1', name: 'มาลี ทดสอบ', phone: '0850001111', note: '', data: { memberCode: 'M0001', points: [] }, updated_at: at(5), created_at: at(30) }
const cake = { id: 'cake1', kind: 'retail', name: 'เค้กทดสอบ', price: 450, active: true, data: { stock: 50, category: 'เค้ก' } }

let fails = 0
const app = await startApp({ tables: { punpang_customers: [cust], punpang_items: [cake] } })
const { page, go } = app
const { step, finish } = stepper(page)
const left = () => page.getByText('วันเวลานัดรับ', { exact: true }).boundingBox()
const right = () => page.getByText('การส่งมอบ', { exact: true }).boundingBox()
try {
  await go('/admin/orders/new')
  await page.getByRole('button', { name: /มาลี ทดสอบ/ }).first().click()
  await page.getByRole('button', { name: 'ถัดไป' }).click()
  await page.getByText('วันเวลานัดรับ', { exact: true }).waitFor({ timeout: 10000 })

  await step('1280×800: ขั้นนัดรับวางสองคอลัมน์', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const [l, r] = [await left(), await right()]
    assert.ok(l && r, 'ไม่พบการ์ดนัดรับ/การส่งมอบ')
    assert.ok(r.x > l.x + l.width - 1, `การ์ดไม่ได้วางคู่กัน: ${JSON.stringify({ l, r })}`)
    assert.ok(Math.abs(r.y - l.y) < 40, 'การ์ดสองฝั่งควรเริ่มที่แถวเดียวกัน')
  })
  await step('1280×800: ตัวเลือกโอกาสไม่ล้นการ์ด', async () => {
    const overflow = await page.evaluate(() => [...document.querySelectorAll('[role="radiogroup"] .chip')].some((b) => b.scrollWidth > b.clientWidth + 1))
    assert.equal(overflow, false, 'ชิปโอกาสของการสั่งตัวอักษรล้นกรอบ')
  })
  await step('390px: เรียงลงมาคอลัมน์เดียว', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const [l, r] = [await left(), await right()]
    assert.ok(r.y > l.y + l.height - 1, `มือถือควรเรียงลงมา: ${JSON.stringify({ l, r })}`)
    const box = await page.getByRole('button', { name: 'ถัดไป' }).boundingBox()
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'ปุ่มถัดไปล้นจอ 390px')
  })
  await step('ไม่มีข้อผิดพลาดในหน้า', async () => assert.deepEqual(app.pageErrors().slice(0, 3), []))
} finally {
  await app.close()
}
fails += finish()

// ขั้นสินค้า: มีบริการเกี่ยวกับเงินเปิดอยู่ → บริการอยู่คอลัมน์ขวา · ไม่มีบริการ → คอลัมน์เดียว
const shopCash = { cashService: { maxNotes: 5, services: { hide: { fee: 50, show: true }, pull: { fee: 40, show: false }, stash: { fee: 30, show: false } } } }
const app2 = await startApp({ tables: { punpang_customers: [cust], punpang_items: [cake] }, shop: shopCash })
const s2 = stepper(app2.page)
try {
  const p2 = app2.page
  await app2.go('/admin/orders/new')
  await p2.getByRole('button', { name: /มาลี ทดสอบ/ }).first().click()
  await p2.getByRole('button', { name: 'ถัดไป' }).click()
  await p2.getByRole('button', { name: '14:00', exact: true }).click()
  await p2.getByRole('button', { name: 'ถัดไป' }).click()
  await p2.getByRole('button', { name: 'ถัดไป' }).click()
  await p2.getByText('บริการเกี่ยวกับเงิน').waitFor({ timeout: 10000 })
  await s2.step('1280×800 ขั้นสินค้า: บริการเกี่ยวกับเงินอยู่คอลัมน์ขวา', async () => {
    await p2.setViewportSize({ width: 1280, height: 800 })
    const l = await p2.getByText('เพิ่มสินค้า', { exact: true }).boundingBox()
    const r = await p2.getByText('บริการเกี่ยวกับเงิน').first().boundingBox()
    assert.ok(l && r && r.x > l.x + l.width - 1, `บริการไม่ได้อยู่คอลัมน์ขวา: ${JSON.stringify({ l, r })}`)
  })
  await s2.step('ขั้นสินค้า: ไม่มีข้อผิดพลาดในหน้า', async () => assert.deepEqual(app2.pageErrors().slice(0, 3), []))
} finally {
  await app2.close()
}
fails += s2.finish()
process.exit(fails ? 1 : 0)
