// ทดสอบหน้าออร์เดอร์ (OrderDetail) หลังถอดการใช้คะแนนลดราคา: ไม่มีปุ่มใช้คะแนนเป็นส่วนลด แต่ยังแสดงส่วนลดคะแนนของออร์เดอร์เดิม
// เรนเดอร์ฝั่งเซิร์ฟเวอร์ (ไม่มีเบราว์เซอร์) · รัน: node src/views/OrderDetail.ssr.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  demo.seedDemo()
  const OrderDetail = (await server.ssrLoadModule('/src/views/OrderDetail.vue')).default
  const { db, session, adjustPoints } = S
  session.role = 'admin' // แอดมินมีสิทธิ์ใช้คะแนน: ปุ่มเดิมจะแสดงถ้ายังมีอยู่
  // RouterLink ของ vue-router ไม่ได้ติดตั้งในการเรนเดอร์ทดสอบ จึงใช้ตัวแทนที่แสดงลิงก์เป็น <a> (ไม่กระทบสิ่งที่ตรวจ)
  const RouterLink = { props: ['to'], render() { return h('a', { href: this.to }, this.$slots.default?.()) } }
  const render = (id) => renderToString(createSSRApp({ render: () => h(OrderDetail, { id }) }).component('RouterLink', RouterLink))

  // ออร์เดอร์ที่ยังไม่ปิด ผูกลูกค้า และลูกค้ามีคะแนนคงเหลือ (เงื่อนไขที่เคยแสดงปุ่มใช้คะแนน)
  const order = db.orders.find((o) => o.customerId && !['draft', 'cancelled', 'delivered'].includes(o.status) && !o.pointsUsed)
  assert.ok(order, 'ไม่มีออร์เดอร์ตัวอย่างที่ยังไม่ปิดและผูกลูกค้า')
  adjustPoints(order.customerId, 500, 'ทดสอบหน้าออร์เดอร์')

  const cases = []
  const t = (name, fn) => cases.push([name, fn])

  t('หน้าออร์เดอร์เรนเดอร์ได้และแสดงการ์ดคะแนน / คูปอง', async () => {
    const html = await render(order.id)
    assert.ok(html.includes('คะแนน / คูปอง'), 'ไม่พบการ์ดคะแนน / คูปอง (หน้าเรนเดอร์ไม่สมบูรณ์)')
    assert.ok(html.includes('คะแนนของลูกค้า'))
  })

  t('ลูกค้ามีคะแนนและเป็นแอดมิน ก็ไม่มีปุ่มใช้คะแนนเป็นส่วนลด', async () => {
    const html = await render(order.id)
    assert.equal(html.includes('ใช้คะแนนเป็นส่วนลด'), false, 'ยังมีปุ่มใช้คะแนนเป็นส่วนลด')
  })

  t('ออร์เดอร์ค้างที่ใช้คะแนนไว้ก่อนถอดฟีเจอร์: แสดงส่วนลดคะแนนเดิม และไม่มีปุ่มใช้คะแนนใหม่', async () => {
    order.pointsUsed = { points: 40, amount: 40, entryId: 'legacy' }
    try {
      const html = await render(order.id)
      assert.ok(html.includes('ใช้ 40 คะแนน'), 'ไม่แสดงส่วนลดคะแนนเดิมของออร์เดอร์')
      assert.equal(html.includes('ใช้คะแนนเป็นส่วนลด'), false)
    } finally { order.pointsUsed = null }
  })

  t('การ์ดช่องทางแจ้งเตือน: ตามเดิมเมื่อไม่มีการกำหนดเอง และแสดง "กำหนดเองบางช่องทาง" เมื่อมี', async () => {
    const prev = order.notifyChannels
    try {
      order.notifyChannels = {}
      const plain = await render(order.id)
      assert.ok(plain.includes('ช่องทางแจ้งเตือนออร์เดอร์นี้'), 'ไม่พบการ์ดช่องทางแจ้งเตือน')
      assert.ok(plain.includes('>ตามเดิม<'), 'ควรแสดงสถานะตามเดิม')
      assert.equal(plain.includes('กำหนดเองบางช่องทาง'), false)
      order.notifyChannels = { sms: false }
      const custom = await render(order.id)
      assert.ok(custom.includes('กำหนดเองบางช่องทาง'), 'ควรแสดงสถานะกำหนดเอง')
    } finally { order.notifyChannels = prev }
  })

  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
} catch (e) {
  fails++
  console.log('ERROR', e?.stack || e)
} finally {
  await server.close()
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
