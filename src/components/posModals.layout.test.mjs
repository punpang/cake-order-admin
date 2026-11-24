// ทดสอบโครงสร้างโมดัล POS ให้แบ่งซ้าย/ขวา (หรือซ้าย/กลาง/ขวา) บนหน้าจอแนวนอน
// โมดัลถูกวาดผ่าน Teleport จึงตรวจจากซอร์สโดยตรง: ทุกโมดัลต้องใช้ split + slot ที่กำหนด + footer เดิม และแท็ก template สมดุล
// รัน: node src/components/posModals.layout.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
// คืนข้อความของแท็ก AppModal ที่มี title ตรงกับ marker (เช่น "คืนเงิน")
const modalTag = (src, marker) => {
  const i = src.indexOf(marker)
  assert.ok(i >= 0, `ไม่พบโมดัล: ${marker}`)
  const start = src.lastIndexOf('<AppModal', i)
  return src.slice(start, src.indexOf('>', i) + 1)
}
const count = (src, s) => src.split(s).length - 1

let fails = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

const CASES = [
  ['src/components/RefundPartialDialog.vue', 'คืนเงิน ${order.code}', ['#left', '#right']],
  ['src/components/ExchangeModal.vue', 'แลกสินค้า ${orderNo', ['#left', '#center', '#right']],
  ['src/views/Pos.vue', 'ยกเลิกบิล ${voidFor.code}', ['#left', '#right']],
  ['src/views/PosBills.vue', 'ยกเลิกบิล ${orderNo(voidFor.code)}', ['#left', '#right']],
  ['src/components/TaxInvoiceModal.vue', 'ใบกำกับภาษีเต็มรูป"', ['#left', '#right']],
]

t('AppModal มี prop split และ class แนวนอน (ระบบเดิมที่ใช้ร่วมกัน)', () => {
  const src = read('./AppModal.vue')
  assert.match(src, /split: \{ type: Boolean/)
  assert.ok(src.includes('landscape:lg:grid'))
})

t('ใบกำกับภาษี (split + wide) ยังกว้าง 2xl บนแท็บเล็ตแนวตั้ง ไม่ถูกบีบเป็น md', () => {
  assert.match(modalTag(read('../../src/components/TaxInvoiceModal.vue'), 'ใบกำกับภาษีเต็มรูป"'), /\swide[\s>]/)
  assert.ok(read('./AppModal.vue').includes("wide ? 'sm:max-w-2xl landscape:lg:max-w-5xl'"))
})

for (const [file, marker, slots] of CASES) {
  t(`${file} → โมดัลเปิดแบบ split`, () => {
    const src = read('../../' + file)
    assert.match(modalTag(src, marker), /\ssplit[\s>]/, 'แท็ก AppModal ไม่มี split')
  })
  t(`${file} → มี slot ${slots.join(' ')} และ footer เดิม`, () => {
    const src = read('../../' + file)
    for (const s of slots) assert.ok(src.includes(`<template ${s}>`), `ไม่มี slot ${s}`)
    assert.ok(src.includes('<template #footer>'), 'footer หาย')
  })
  t(`${file} → แท็ก template สมดุล`, () => {
    const src = read('../../' + file)
    assert.equal(count(src, '<template'), count(src, '</template>'))
  })
}

for (const [name, fn] of cases) {
  try { fn(); console.log('ok  ', name) } catch (e) { fails++; console.log('FAIL', name, '\n  ', e.message) }
}
console.log(fails ? `\n${fails} ไม่ผ่าน` : '\nผ่านทั้งหมด')
process.exit(fails ? 1 : 0)
