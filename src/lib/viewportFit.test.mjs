// ทดสอบการตรวจแป้นพิมพ์มือถือ · รัน: node src/lib/viewportFit.test.mjs
import assert from 'node:assert/strict'

let fail = 0
const t = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// จำลอง window/visualViewport/document แบบย่อ
function env({ innerHeight, height }) {
  const props = {}
  const vv = { height, width: 390, scale: 1, offsetTop: 0, addEventListener() {}, removeEventListener() {} }
  globalThis.window = { innerHeight, visualViewport: vv, addEventListener() {}, removeEventListener() {} }
  globalThis.document = { documentElement: { style: { setProperty: (k, v) => { props[k] = v }, removeProperty: (k) => { delete props[k] } } }, activeElement: null, addEventListener(ev, fn) { this[ev] = fn }, removeEventListener() {} }
  return { vv, props }
}
const { kb, watchViewport, keyboardOpen } = await import('./viewportFit.js')

await t('ส่วนต่างเกิน 120px = แป้นพิมพ์เปิด', () => {
  assert.equal(keyboardOpen(800, 500), true)
  assert.equal(keyboardOpen(800, 720), false)
})
await t('iOS ที่ innerHeight ไม่ลด: เปิดเมื่อส่วนที่มองเห็นลดลง', () => {
  const { vv, props } = env({ innerHeight: 800, height: 800 })
  const stop = watchViewport()
  assert.equal(kb.open, false)
  vv.height = 460
  document.focusin({ target: { tagName: 'TEXTAREA' } })
  assert.equal(kb.open, true)
  assert.equal(props['--vvh'], '460px')
  stop()
  assert.equal(kb.open, false)
})
await t('iOS ที่ innerHeight ลดตามแป้นพิมพ์: ยังรู้ว่าเปิด (เทียบกับความสูงเต็มที่เคยเห็น)', () => {
  const { vv } = env({ innerHeight: 800, height: 800 })
  const stop = watchViewport()
  window.innerHeight = 460
  vv.height = 460
  document.focusin({ target: { tagName: 'INPUT' } })
  assert.equal(kb.open, true)
  window.innerHeight = 800
  vv.height = 800
  document.focusout()
  assert.equal(kb.open, false)
  stop()
})
await t('หมุนจอ: เริ่มนับความสูงเต็มใหม่ ไม่ค้างว่าแป้นพิมพ์เปิด', () => {
  const { vv } = env({ innerHeight: 800, height: 800 })
  const stop = watchViewport()
  window.innerHeight = 390
  vv.height = 390
  vv.width = 800
  document.focusin({ target: { tagName: 'INPUT' } })
  assert.equal(kb.open, false)
  stop()
})
console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
