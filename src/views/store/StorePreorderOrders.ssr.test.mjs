// ทดสอบว่าหน้าออร์เดอร์ของฉันโหลดฝั่งเซิร์ฟเวอร์ได้ (Vite SSR) · รัน: node src/views/store/StorePreorderOrders.ssr.test.mjs
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
try {
  const mod = await server.ssrLoadModule('/src/views/store/StorePreorderOrders.vue')
  assert.ok(mod.default, 'ต้องมีคอมโพเนนต์ default')
  console.log('PASS StorePreorderOrders.vue โหลดได้ฝั่งเซิร์ฟเวอร์')
} catch (e) {
  console.log(`FAIL ${e.message.split('\n')[0]}`)
  process.exitCode = 1
} finally {
  await server.close()
}
