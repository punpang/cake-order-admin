// ทดสอบการยินยอมคุกกี้ (ฝั่งเบราว์เซอร์) · รัน: node src/lib/consent.test.mjs
import assert from 'node:assert/strict'
import { cookieAllowed, cookieNeedsAsk, writeCookieConsent, COOKIE_TTL_MS } from './consent.js'

// จำลอง localStorage ของเบราว์เซอร์ (consent.js อ่านผ่าน global ตอนเรียกฟังก์ชัน)
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }
const V = '2026-11-01'
const reset = () => store.clear()

t('ยังไม่เคยเลือก → ไม่อนุญาตคุกกี้วิเคราะห์', () => {
  reset()
  assert.equal(cookieAllowed('analytics', V), false)
  assert.equal(cookieNeedsAsk(null, V), true)
})
t('ยอมรับวิเคราะห์ เวอร์ชันเดียวกัน ยังไม่หมดอายุ → อนุญาต', () => {
  reset()
  writeCookieConsent(V, { analytics: true })
  assert.equal(cookieAllowed('analytics', V), true)
})
t('ปฏิเสธวิเคราะห์ → ไม่อนุญาต', () => {
  reset()
  writeCookieConsent(V, { analytics: false })
  assert.equal(cookieAllowed('analytics', V), false)
})
t('เวอร์ชันนโยบายเปลี่ยน → ต้องถามใหม่ ไม่อนุญาต', () => {
  reset()
  writeCookieConsent(V, { analytics: true })
  assert.equal(cookieAllowed('analytics', '2026-12-01'), false)
})
t('เกิน 12 เดือนนับจากที่เลือก → ไม่อนุญาต', () => {
  reset()
  writeCookieConsent(V, { analytics: true })
  const c = JSON.parse(store.get('ck_consent'))
  store.set('ck_consent', JSON.stringify({ ...c, at: Date.now() - COOKIE_TTL_MS - 1000 }))
  assert.equal(cookieAllowed('analytics', V), false)
})
t('คุกกี้จำเป็นอนุญาตเสมอ', () => {
  reset()
  assert.equal(cookieAllowed('necessary', V), true)
})

console.log(`\nผ่าน ${pass} ข้อ`)
