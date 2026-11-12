// ทดสอบการเดาว่ามีเซสชันพนักงานค้างหรือไม่ · รัน: node src/lib/staffSessionHint.test.mjs
import assert from 'node:assert/strict'
import { mayHaveStaffSession } from './staffSessionHint.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const store = (keys) => ({ length: keys.length, key: (i) => keys[i] ?? null })

t('ไม่มีคีย์ของ Supabase → ไม่มีเซสชันพนักงาน (ผู้เยี่ยมชมทั่วไป)', () => {
  assert.equal(mayHaveStaffSession(store([])), false)
  assert.equal(mayHaveStaffSession(store(['punpang.cookie', 'punpang.custSession', 'theme'])), false)
})
t('มีคีย์เซสชันของ Supabase (รวมแบบแบ่งท่อน) → อาจมีเซสชัน', () => {
  assert.equal(mayHaveStaffSession(store(['theme', 'sb-itleduijrckxdbhhuooi-auth-token'])), true)
  assert.equal(mayHaveStaffSession(store(['sb-abc-auth-token.0', 'sb-abc-auth-token.1'])), true)
  assert.equal(mayHaveStaffSession(store(['sb-abc-auth-token-code-verifier'])), true)
})
t('อ่าน localStorage ไม่ได้/ไม่มี → ตอบ true (ใช้ขั้นตอนเต็มแบบเดิม)', () => {
  assert.equal(mayHaveStaffSession(null), true)
  assert.equal(mayHaveStaffSession({ get length() { throw new Error('denied') } }), true)
  assert.equal(mayHaveStaffSession({ length: 1, key() { throw new Error('denied') } }), true)
})
t('ไม่ส่งพารามิเตอร์และไม่มี localStorage (เช่น รันนอกเบราว์เซอร์) → true', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try { Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true }); assert.equal(mayHaveStaffSession(), true) } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage }
})
console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
