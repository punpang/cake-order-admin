// ทดสอบตัวช่วย Turnstile (ส่วนที่ไม่ต้องใช้เบราว์เซอร์) · รัน: node src/lib/turnstile.test.mjs
import assert from 'node:assert/strict'
import { signInCaptchaOptions, turnstileSiteKey, turnstileOn } from './turnstile.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('ไม่มีโทเคน → ไม่ส่งฟิลด์ captchaToken', () => {
  assert.deepEqual(signInCaptchaOptions(''), {})
  assert.deepEqual(signInCaptchaOptions('   '), {})
  assert.deepEqual(signInCaptchaOptions(undefined), {})
})
t('มีโทเคน → ส่ง captchaToken (ตัดช่องว่างหัวท้าย)', () => {
  assert.deepEqual(signInCaptchaOptions(' abc.123 '), { captchaToken: 'abc.123' })
})
t('รันนอก build (ไม่มี import.meta.env) → ไม่มี site key และปิดวิดเจ็ต', () => {
  assert.equal(turnstileSiteKey(), '')
  assert.equal(turnstileOn(), false)
})
console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
