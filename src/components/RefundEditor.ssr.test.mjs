// ทดสอบหน้าจอเลือกช่องทางคืนเงิน (RefundEditor) ด้วยการเรนเดอร์ฝั่งเซิร์ฟเวอร์ · รัน: node src/components/RefundEditor.ssr.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { REFUND_CHOICES, REFUND_METHODS } from '../lib/refund.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const RefundEditor = (await server.ssrLoadModule('/src/components/RefundEditor.vue')).default
  const render = (props) => renderToString(createSSRApp({
    render: () => h(RefundEditor, { modelValue: [{ method: 'cash', amount: 100 }], paid: 500, defaultMethod: 'cash', ...props }),
  }))
  // แท็กเปิดของปุ่มช่องทางที่มีป้ายตรงกับ label (ค้นด้วยข้อความตรง ๆ ไม่ใช้ regex เพราะป้ายมีวงเล็บ) · ไม่พบ = null
  const chipOf = (html, label) => {
    const i = html.indexOf(`>${label}</button>`)
    return i < 0 ? null : html.slice(html.lastIndexOf('<button', i), i)
  }
  const creditLabel = REFUND_METHODS.credit

  const cases = []
  const t = (name, fn) => cases.push([name, fn])

  t('ตัวเลือกช่องทางมีเฉพาะ เงินสด / โอน / คูปองคืนเงิน และไม่มีคะแนนสะสม', async () => {
    const html = await render({ canCredit: true })
    assert.deepEqual(REFUND_CHOICES, ['cash', 'transfer', 'credit'])
    for (const m of REFUND_CHOICES) assert.ok(chipOf(html, REFUND_METHODS[m]), `ไม่มีปุ่ม ${REFUND_METHODS[m]}`)
    assert.equal(html.includes(REFUND_METHODS.points), false, 'ยังแสดงช่องทางคะแนนสะสม')
  })

  t('ไม่มีลูกค้าผูกออร์เดอร์ → ปุ่มคูปองคืนเงินถูกปิด และแสดงเหตุผล', async () => {
    const html = await render({ canCredit: false })
    assert.match(chipOf(html, creditLabel) ?? '', /disabled/)
    assert.ok(html.includes('คืนเป็นคูปองได้เมื่อออร์เดอร์ผูกกับลูกค้า'))
  })

  t('มีลูกค้าผูกออร์เดอร์ → ปุ่มคูปองคืนเงินใช้ได้ และไม่มีเหตุผลปิดปุ่ม', async () => {
    const html = await render({ canCredit: true })
    assert.ok(chipOf(html, creditLabel), 'ไม่มีปุ่มคูปองคืนเงิน')
    assert.doesNotMatch(chipOf(html, creditLabel), /disabled/)
    assert.equal(html.includes('คืนเป็นคูปองได้เมื่อออร์เดอร์ผูกกับลูกค้า'), false)
  })

  t('ช่องคูปองคืนเงินที่ใส่ยอดแล้วบอกว่าไม่มีวันหมดอายุและใช้ได้หลายครั้ง', async () => {
    const html = await render({ canCredit: true, modelValue: [{ method: 'credit', amount: 150 }] })
    assert.ok(html.includes('ออกเป็นคูปองยอด'), 'ไม่มีข้อความยอดคูปอง')
    assert.ok(html.includes('ไม่มีวันหมดอายุ ใช้ได้หลายครั้งจนหมดยอด'))
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
