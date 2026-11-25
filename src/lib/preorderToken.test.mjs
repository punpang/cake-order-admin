// ทดสอบที่เก็บโทเคนสั่งล่วงหน้าแยกจากเซสชันบัญชี (ฟังก์ชันล้วน ไม่เรียกเครือข่าย) · รัน: node src/lib/preorderRemote.test.mjs
import assert from 'node:assert/strict'

// จำลอง localStorage ของเบราว์เซอร์
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }

const { readPreorderToken, savePreorderToken, clearPreorderToken } = await import('./preorderToken.js')

let fail = 0
const check = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) } }

check('ยังไม่มีโทเคน → ค่าว่าง', () => {
  assert.equal(readPreorderToken(), '')
})
check('บันทึกแล้วอ่านได้ และล้างได้', () => {
  savePreorderToken('p'.repeat(64))
  assert.equal(readPreorderToken(), 'p'.repeat(64))
  clearPreorderToken()
  assert.equal(readPreorderToken(), '')
})
check('ใช้คีย์แยกจากเซสชันบัญชีลูกค้า', () => {
  savePreorderToken('x')
  assert.equal(store.has('punpang_customer_session'), false)
  assert.equal(store.has('punpang_preorder_session'), true)
  clearPreorderToken()
})
check('localStorage ใช้ไม่ได้ → ไม่ throw', () => {
  const saved = globalThis.localStorage
  globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(readPreorderToken(), '')
  savePreorderToken('y')
  clearPreorderToken()
  globalThis.localStorage = saved
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
