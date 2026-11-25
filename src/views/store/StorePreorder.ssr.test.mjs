// ทดสอบว่าหน้าสั่งล่วงหน้าเรนเดอร์ฝั่งเซิร์ฟเวอร์ได้โดยไม่ throw (ผ่าน Vite SSR) · รัน: node src/views/store/StorePreorder.ssr.test.mjs
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
try {
  const mod = await server.ssrLoadModule('/src/views/store/StorePreorder.vue')
  assert.ok(mod.default, 'ต้องมีคอมโพเนนต์ default')
  console.log('PASS StorePreorder.vue โหลดได้ฝั่งเซิร์ฟเวอร์')
} catch (e) {
  console.log(`FAIL ${e.message.split('\n')[0]}`)
  process.exitCode = 1
} finally {
  await server.close()
}
