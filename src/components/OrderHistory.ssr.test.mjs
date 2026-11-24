// ทดสอบคอมโพเนนต์ประวัติออร์เดอร์ (ใช้ซ้ำในหน้าออร์เดอร์): รายการล่าสุดขึ้นก่อน · ไม่มีประวัติก็ไม่พัง
// เรนเดอร์ฝั่งเซิร์ฟเวอร์ (ไม่มีเบราว์เซอร์) · รัน: node src/components/OrderHistory.ssr.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
const t = async (name, fn) => {
  try { await fn(); console.log('PASS', name) } catch (e) { fails++; console.log('FAIL', name, '—', e.message) }
}
try {
  const OrderHistory = (await server.ssrLoadModule('/src/components/OrderHistory.vue')).default
  // AppIcon เป็นส่วนกลางของแอป จึงแทนด้วยตัวว่างในการทดสอบนี้
  const render = (history) => renderToString(createSSRApp({ render: () => h(OrderHistory, { history }) }).component('AppIcon', { render: () => h('i') }))

  await t('แสดงรายการล่าสุดขึ้นก่อน', async () => {
    const html = await render([{ text: 'สร้างออร์เดอร์', at: '2026-11-20T10:00:00Z', by: 'owner' }, { text: 'รับชำระ', at: '2026-11-21T10:00:00Z', by: 'owner' }])
    assert.ok(html.indexOf('รับชำระ') < html.indexOf('สร้างออร์เดอร์'), 'รายการใหม่ต้องอยู่ก่อน')
  })
  await t('ไม่มีประวัติก็เรนเดอร์ได้โดยไม่พัง', async () => {
    const html = await render([])
    assert.ok(html.includes('ประวัติ'))
  })
} finally {
  await server.close()
}
console.log(fails ? `${fails} failed` : 'OrderHistory: all passed')
process.exit(fails ? 1 : 0)
