// ตัวรายงานข้อผิดพลาด: ส่งซ้ำไม่ได้ · มีเพดานต่อการเปิดแอป · ข้ามข้อความทั่วไป · ตัดตัวเลขยาว · ไม่ส่งเมื่อปิด
// รัน: node src/lib/errorReport.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeReporter, normalizeError } from './errorReport.js'

const flush = () => new Promise((r) => setTimeout(r, 0))
const mk = (opts = {}) => { const sent = []; const report = makeReporter({ send: async (p) => sent.push(p), url: () => '/#/admin/orders?q=0812345678', ua: () => 'ua', ...opts }); return { sent, report } }

test('ส่งข้อผิดพลาด · ตัดตัวเลขยาวทั้งข้อความและ url · ข้อผิดพลาดเดิมส่งครั้งเดียว', async () => {
  const { sent, report } = mk()
  const e = new TypeError('ไม่พบลูกค้า 0812345678')
  assert.equal(report(e, 'vue:render'), true)
  assert.equal(report(e, 'vue:render'), false)
  await flush()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].p_message, 'TypeError: ไม่พบลูกค้า [ตัวเลข] (vue:render)')
  assert.equal(sent[0].p_url, '/#/admin/orders?q=[ตัวเลข]')
  assert.ok(!sent[0].p_stack.includes('0812345678'))
})

test('ข้ามข้อความทั่วไปที่ไม่ใช่ปัญหาของแอป (ออฟไลน์ / ResizeObserver)', async () => {
  const { sent, report } = mk()
  assert.equal(report(new TypeError('Failed to fetch')), false)
  assert.equal(report('ResizeObserver loop completed with undelivered notifications.'), false)
  await flush()
  assert.equal(sent.length, 0)
})

test('เพดานต่อการเปิดแอป · ปิดอยู่ = ไม่ส่ง · ส่งไม่สำเร็จ = เงียบ', async () => {
  const { sent, report } = mk({ max: 3 })
  for (let i = 0; i < 10; i++) report(new Error(`e${i}`))
  await flush()
  assert.equal(sent.length, 3)
  const off = mk({ enabled: () => false })
  assert.equal(off.report(new Error('x')), false)
  const bad = makeReporter({ send: async () => { throw new Error('net') } })
  assert.equal(bad(new Error('y')), true)
  await flush()
})

test('normalizeError รับได้ทุกชนิด', () => {
  assert.equal(normalizeError('ข้อความ').message, 'ข้อความ')
  assert.equal(normalizeError({ message: 'obj' }).message, 'obj')
  assert.equal(normalizeError(null).message, 'ข้อผิดพลาด')
  assert.equal(normalizeError(new Error('a')).message, 'a')
})
