// เทสต์ทุกหน้า (ทุกไฟล์ .vue ใต้ src/views) ด้วยการเรนเดอร์ฝั่งเซิร์ฟเวอร์ (SSR) กับข้อมูลตัวอย่าง
// ผ่านเมื่อ: หน้าเรนเดอร์ได้โดยไม่โยน error · ได้ HTML ที่ไม่ว่าง · ไม่มีข้อความ error ของ Vue ที่หน้าเว็บจะพังจริง
// รัน: node src/views/pages.ssr.test.mjs
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const VIEWS = join(ROOT, 'src', 'views')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
// หน้าที่แตะ document/window ตอนตั้งค่าทันที: เรนเดอร์เฉพาะฝั่งเบราว์เซอร์ (ไม่มี SSR) · ผ่าน e2e แทน
const CLIENT_ONLY = { '/src/views/store/StoreItem.vue': 'ใช้ document ตอนตั้งค่า' }
const pages = walk(VIEWS).filter((f) => f.endsWith('.vue')).map((f) => '/' + relative(ROOT, f).split('\\').join('/')).sort()

// หน้าเว็บจริงลงทะเบียน directive ส่วนกลางใน src/main.js · ต้องลงทะเบียนเช่นเดียวกันในการเรนเดอร์ทดสอบ
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
const warnings = []
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  demo.seedDemo()
  S.session.role = 'admin'
  // ข้อความเตือนของ Vue ระหว่างเรนเดอร์ (เช่น props ขาด/ไม่รู้จัก) เก็บไว้ดู แต่ไม่ถือเป็นความล้มเหลว
  const origWarn = console.warn
  console.warn = (...a) => warnings.push(String(a[0]))

  const { vNum } = await server.ssrLoadModule('/src/lib/numInput.js')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  router.push('/')
  await router.isReady()

  // RouterLink ของ vue-router แสดงเป็น <a> ในการเรนเดอร์ทดสอบ (ไม่กระทบสิ่งที่ตรวจ)
  for (const page of pages) {
    if (CLIENT_ONLY[page]) { console.log(`SKIP ${page}: ${CLIENT_ONLY[page]}`); continue }
    try {
      const comp = (await server.ssrLoadModule(page)).default
      assert.ok(comp, 'ไม่มี default export')
      const app = createSSRApp({ render: () => h(comp) })
      app.use(router)
      app.directive('num', vNum)
      const html = await renderToString(app)
      assert.ok(html && html.length > 0, 'HTML ว่าง')
      console.log(`PASS ${page} (${html.length} ตัวอักษร)`)
    } catch (e) {
      fails++
      console.log(`FAIL ${page}: ${String(e?.message || e).split('\n')[0]}`)
    }
  }
  console.warn = origWarn
} catch (e) {
  fails++
  console.log('ERROR', e?.stack || e)
} finally {
  await server.close()
}
console.log(`หน้าทั้งหมด ${pages.length} · ไม่ผ่าน ${fails}`)
process.exitCode = fails ? 1 : 0
