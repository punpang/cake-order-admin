// ทดสอบบัญชีรับชำระ · รัน: node src/lib/payAccounts.test.mjs
import assert from 'node:assert/strict'
import { payAccountsOf, visiblePayAccounts, validatePayAccount, clonePayment } from './payAccounts.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('รูปแบบเดิม (promptpayId + bank/accountNo) แปลงเป็นรายการ และแสดงอยู่', () => {
  const list = payAccountsOf({ promptpayId: '0918853402', bank: 'กสิกรไทย', accountNo: '123-4-56789-0', accountName: 'บจก. ตัวอย่าง' })
  assert.equal(list.length, 2)
  assert.equal(list[0].kind, 'promptpay')
  assert.equal(list[1].accountNo, '1234567890')
  assert.equal(visiblePayAccounts({ promptpayId: '0918853402' }).length, 1)
})

t('บัญชีธนาคารที่เลือกจากรายการ: ชื่อธนาคารมาจากรหัส', () => {
  const [a] = payAccountsOf({ accounts: [{ kind: 'bank', bankCode: '006', bankName: 'อะไรก็ได้', accountNo: '1234567890', accountName: 'ร้าน' }] })
  assert.equal(a.bankName, 'ธนาคารกรุงไทย')
  assert.equal(a.show, true)
})

t('ปิดการแสดง → ไม่อยู่ในรายการที่ลูกค้าเห็น แต่ยังเก็บไว้', () => {
  const p = { accounts: [{ kind: 'promptpay', promptpayId: '0918853402', show: false }, { kind: 'bank', bankCode: '004', accountNo: '1234567890', show: true }] }
  assert.equal(payAccountsOf(p).length, 2)
  assert.deepEqual(visiblePayAccounts(p).map((a) => a.kind), ['bank'])
})

t('บัญชีไม่ครบ/เลขผิด ถูกทิ้งตอนอ่าน และตรวจด้วย validatePayAccount', () => {
  assert.equal(payAccountsOf({ accounts: [{ kind: 'promptpay', promptpayId: '123' }] }).length, 0)
  assert.match(validatePayAccount({ kind: 'promptpay', promptpayId: '123' }), /พร้อมเพย์/)
  assert.match(validatePayAccount({ kind: 'bank', bankCode: '004', bankName: 'ธนาคารกสิกรไทย', accountNo: '12' }), /6–20/)
  assert.match(validatePayAccount({ kind: 'bank', bankName: '', accountNo: '1234567890' }), /เลือกธนาคาร/)
  assert.equal(validatePayAccount({ kind: 'bank', bankCode: '004', bankName: 'ธนาคารกสิกรไทย', accountNo: '123-4-56789-0' }), '')
})

t('ไม่จำกัดจำนวนบัญชี', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'bank', bankCode: '004', accountNo: String(1000000 + i), id: `x${i}` }))
  assert.equal(payAccountsOf({ accounts: many }).length, 30)
})

t('clonePayment แยกอ้างอิง (แก้สำเนาแล้วไม่กระทบต้นฉบับ)', () => {
  const src = { accounts: [{ kind: 'bank', bankCode: '004', accountNo: '1234567890' }], note: 'n' }
  const c = clonePayment(src)
  c.accounts[0].show = false
  assert.equal(payAccountsOf(src)[0].show, true)
})

if (fail) { console.log(`${fail} FAILED`); process.exit(1) }
console.log('ALL PASS')
