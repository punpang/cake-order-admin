// ทดสอบกติกาฝั่งแอปของลุ้นโชคท้ายบิล · รัน: node src/lib/luckyDraw.test.mjs
import assert from 'node:assert/strict'
import { LUCKY_SITE_URL, genLuckyToken, hashLuckyToken, isLuckyCodeShape, luckyActive, luckyDefaults, luckyUrl, normalizeLuckyCode, validateLuckyPrizes } from './luckyDraw.js'

let pass = 0
const t = async (name, fn) => { await fn(); pass++; console.log('PASS', name) }

await t('ค่าเริ่มต้น: ปิดอยู่ ไม่มีรางวัล และชี้ไปเว็บหลัก', () => {
  const d = luckyDefaults()
  assert.equal(d.enabled, false)
  assert.deepEqual(d.prizes, [])
  assert.equal(d.siteUrl, LUCKY_SITE_URL)
  assert.equal(d.prizeDays, 30)
})

await t('ตรวจรายการรางวัล: ชื่อว่าง โอกาสติดลบ หรือรวมเกิน 100 ไม่ผ่าน', () => {
  assert.equal(validateLuckyPrizes([{ name: 'ส่วนลด 50', chance: 10 }, { name: 'คัพเค้ก', chance: 30 }]), '')
  assert.notEqual(validateLuckyPrizes([{ name: ' ', chance: 10 }]), '')
  assert.notEqual(validateLuckyPrizes([{ name: 'ก', chance: -1 }]), '')
  assert.match(validateLuckyPrizes([{ name: 'ก', chance: 60 }, { name: 'ข', chance: 41 }]), /เกิน 100/)
  assert.equal(validateLuckyPrizes([{ name: 'ก', chance: 60 }, { name: 'ข', chance: 40 }]), '')
  assert.notEqual(validateLuckyPrizes(null), '')
})

await t('เปิดให้ลุ้น: ต้องเปิดใช้งานและอยู่ในช่วงเวลา', () => {
  const cfg = { enabled: true, from: '2026-11-15T00:00:00.000Z', to: '2026-11-30T23:59:59.000Z' }
  assert.equal(luckyActive(cfg, Date.parse('2026-11-14T23:59:00.000Z')), false)
  assert.equal(luckyActive(cfg, Date.parse('2026-11-20T00:00:00.000Z')), true)
  assert.equal(luckyActive(cfg, Date.parse('2026-12-01T00:00:00.000Z')), false)
  assert.equal(luckyActive({ ...cfg, enabled: false }, Date.parse('2026-11-20T00:00:00.000Z')), false)
  assert.equal(luckyActive({ enabled: true, from: '', to: '' }, Date.now()), false)
})

await t('token: 32 ตัว base64url และไม่ซ้ำกัน', () => {
  const a = genLuckyToken()
  const b = genLuckyToken()
  assert.equal(a.length, 32)
  assert.match(a, /^[A-Za-z0-9_-]{32}$/)
  assert.notEqual(a, b)
})

await t('hash ของ token: กำหนดได้แน่นอน และไม่เท่ากับ token', async () => {
  const token = 'abcdefghijklmnopqrstuvwxyzABCDEF'
  const h1 = await hashLuckyToken(token)
  const h2 = await hashLuckyToken(token)
  assert.equal(h1, h2)
  assert.match(h1, /^[0-9a-f]{64}$/)
  assert.notEqual(h1, token)
  assert.notEqual(h1, await hashLuckyToken(token.slice(1) + 'A'))
})

await t('URL ของ QR: ชี้ไปหน้าลุ้นโชคของบิล และตัด / ท้ายออก', () => {
  assert.equal(luckyUrl('https://example.com/', 'TOKEN'), 'https://example.com/#/luck/TOKEN')
  assert.equal(luckyUrl('https://example.com', 'TOKEN'), 'https://example.com/#/luck/TOKEN')
  assert.equal(luckyUrl('', 'TOKEN'), `${LUCKY_SITE_URL}/#/luck/TOKEN`)
})

await t('รหัสรางวัล: ตัดช่องว่างและแปลงเป็นพิมพ์ใหญ่ก่อนตรวจรูปแบบ', () => {
  assert.equal(normalizeLuckyCode(' ab3 c4-x '), 'AB3C4-X')
  assert.equal(isLuckyCodeShape(' ab3 c4 '), false) // ตัวอักษร/เลขต้อง 6 ตัวในชุดที่กำหนด (มีขีดไม่ผ่าน)
  assert.equal(isLuckyCodeShape('ab3c45'), true)
  assert.equal(isLuckyCodeShape('AB0CDE'), false) // ไม่มี 0
  assert.equal(isLuckyCodeShape('ABCDE'), false)
})

console.log(`ผ่าน ${pass} กรณี`)
