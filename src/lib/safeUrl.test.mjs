// ทดสอบการกรองลิงก์ก่อนใส่ href · รัน: node src/lib/safeUrl.test.mjs
import assert from 'node:assert/strict'
import { safeHref, safeNext } from './safeUrl.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('http/https ผ่าน และคืนค่าที่จัดรูปแล้ว', () => {
  assert.equal(safeHref('  https://maps.app.goo.gl/x?y=1  '), 'https://maps.app.goo.gl/x?y=1')
  assert.equal(safeHref('http://example.com'), 'http://example.com/')
})
t('สคีมอื่นและค่าที่ไม่ใช่ลิงก์ → ว่าง', () => {
  for (const v of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', 'intent://x', '//evil.example', 'evil.example', '', null, undefined, 0]) assert.equal(safeHref(v), '', String(v))
})
t('มีช่องว่าง/อักขระควบคุม/เครื่องหมายคำพูด หรือฝังชื่อผู้ใช้ → ว่าง', () => {
  for (const v of ['https://a.example/x y', 'https://a.example/\u0000', 'java\tscript:alert(1)', 'https://a.example/"><script>', "https://a.example/'", 'https://user:pw@a.example/', 'https://user@a.example/']) assert.equal(safeHref(v), '', v)
})

t('safeNext: รับเฉพาะพาธภายในเว็บ', () => {
  assert.equal(safeNext('/account'), '/account')
  assert.equal(safeNext('/account?x=1#a'), '/account?x=1#a')
  assert.equal(safeNext(undefined), '')
  assert.equal(safeNext(''), '')
  assert.equal(safeNext('https://evil.example/'), '')
  assert.equal(safeNext('//evil.example/'), '')
  assert.equal(safeNext('/\\evil.example/'), '')
})
t('safeNext: อักขระควบคุมหรือช่องว่างทำให้ไม่ผ่าน (กันการเปลี่ยนเป็น // ตอนเบราว์เซอร์แปลงค่า)', () => {
  for (const v of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\u0000/x', '/\u001f/x', '/ /x', '/account\u0007', '/a b']) assert.equal(safeNext(v), '', JSON.stringify(v))
})
console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
