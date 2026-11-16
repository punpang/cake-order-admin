// ทดสอบกติกาฝั่งแอปของลุ้นโชคท้ายบิล · รัน: node src/lib/luckyDraw.test.mjs
import assert from 'node:assert/strict'
import { LUCKY_SITE_URL, MAX_DRAWS_PER_BILL, genLuckyToken, hashLuckyToken, luckyActive, luckyDefaults, luckyDrawsOf, luckyUrl, validateLuckyConfig, validateLuckyPrizes } from './luckyDraw.js'

let pass = 0
const t = async (name, fn) => { await fn(); pass++; console.log('PASS', name) }

// บิลตัวอย่าง: สินค้า a 100 บาท ×2 และ b 50 บาท ×1 (ยอดรวม 250)
const bill = (extra = {}) => ({
  fulfillment: 'pickup', payments: [], adjustment: { amount: 0, reason: '' }, pointsUsed: null, couponsUsed: [], vat: undefined,
  items: [
    { retailId: 'a', name: 'เค้ก A', unitPrice: 100, qty: 2 },
    { retailId: 'b', name: 'คัพเค้ก B', unitPrice: 50, qty: 1 },
  ],
  ...extra,
})

const PR = [
  { id: 'p1', name: 'ส่วนลด 50 บาท', kind: 'discount', amount: 50, quota: 10 },
  { id: 'p2', name: 'คัพเค้ก 1 ชิ้น', kind: 'reward', amount: 0, quota: 20 },
]

await t('ค่าเริ่มต้น: ปิดอยู่ ทุก 100 บาท ยังไม่เลือกสินค้า ยังไม่มีรางวัล อายุคูปอง 30 วัน และชี้ไปเว็บหลัก', () => {
  const d = luckyDefaults()
  assert.equal(d.enabled, false)
  assert.equal(d.perBaht, 100)
  assert.deepEqual(d.itemIds, [])
  assert.deepEqual(d.prizes, [])
  assert.equal(d.siteUrl, LUCKY_SITE_URL)
  assert.equal(d.couponDays, 30)
})

await t('ตรวจรายการรางวัล: ชื่อ ประเภท ส่วนลด จำนวน และรหัสรางวัล', () => {
  assert.equal(validateLuckyPrizes(PR), '')
  assert.equal(validateLuckyPrizes([]), '')
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], name: ' ' }]), '')
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], kind: 'points' }]), '') // คะแนนสะสมไม่ใช้แล้ว
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], amount: 0 }]), '') // ส่วนลดต้องมากกว่า 0
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], quota: -1 }]), '')
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], quota: 1.5 }]), '')
  assert.notEqual(validateLuckyPrizes([PR[0], { ...PR[1], id: 'p1' }]), '') // รหัสซ้ำ
  assert.notEqual(validateLuckyPrizes([{ ...PR[1], id: '' }]), '')
  assert.notEqual(validateLuckyPrizes(null), '')
})

await t('ตรวจการตั้งค่า: ทุกกี่บาทต้องมากกว่า 0 · เปิดใช้ต้องเลือกสินค้าและมีรางวัล', () => {
  assert.match(validateLuckyConfig({ perBaht: 0, enabled: false, itemIds: ['a'], prizes: [] }), /มากกว่า 0/)
  assert.match(validateLuckyConfig({ perBaht: 100, enabled: true, itemIds: [], prizes: PR }), /เลือกสินค้า/)
  assert.match(validateLuckyConfig({ perBaht: 100, enabled: true, itemIds: ['a'], prizes: [] }), /ตั้งรางวัล/)
  assert.equal(validateLuckyConfig({ perBaht: 100, enabled: false, itemIds: [], prizes: [] }), '')
  assert.equal(validateLuckyConfig({ perBaht: 100, enabled: true, itemIds: ['a'], prizes: PR }), '')
})

await t('เปิดให้ลุ้น: ต้องเปิดใช้งานและอยู่ในช่วงเวลา', () => {
  const cfg = { enabled: true, from: '2026-11-15T00:00:00.000Z', to: '2026-11-30T23:59:59.000Z' }
  assert.equal(luckyActive(cfg, Date.parse('2026-11-14T23:59:00.000Z')), false)
  assert.equal(luckyActive(cfg, Date.parse('2026-11-20T00:00:00.000Z')), true)
  assert.equal(luckyActive(cfg, Date.parse('2026-12-01T00:00:00.000Z')), false)
  assert.equal(luckyActive({ ...cfg, enabled: false }, Date.parse('2026-11-20T00:00:00.000Z')), false)
})

await t('จำนวนครั้งลุ้น: นับเฉพาะสินค้าที่ร่วมรายการ ทุก X บาท ปัดลง', () => {
  assert.equal(luckyDrawsOf(bill(), { perBaht: 100, itemIds: ['a'] }), 2) // a = 200 บาท → 2 ครั้ง
  assert.equal(luckyDrawsOf(bill(), { perBaht: 100, itemIds: ['b'] }), 0) // b = 50 บาท ยังไม่ถึง 100
  assert.equal(luckyDrawsOf(bill(), { perBaht: 50, itemIds: ['a', 'b'] }), 5) // 250 ÷ 50
  assert.equal(luckyDrawsOf(bill(), { perBaht: 100, itemIds: [] }), 0) // ไม่เลือกสินค้า = ไม่มีบิลไหนลุ้น
  assert.equal(luckyDrawsOf(bill(), { perBaht: 0, itemIds: ['a'] }), 0)
})

await t('จำนวนครั้งลุ้นใช้ยอดที่จ่ายจริง: ส่วนลดคูปองลดสัดส่วนของสินค้าที่ร่วมด้วย', () => {
  const withCoupon = bill({ couponsUsed: [{ couponId: 'c1', name: 'คูปอง', amount: 50 }] }) // ยอดจ่าย 200 จาก 250
  // สินค้า a = 200 × (200 ÷ 250) = 160 บาท → 1 ครั้ง (ไม่ใช่ 2 ครั้งตามราคาก่อนลด)
  assert.equal(luckyDrawsOf(withCoupon, { perBaht: 100, itemIds: ['a'] }), 1)
})

await t('ของแถมจากโปรไม่นับ และเพดานต่อบิลคือ 10 ครั้ง', () => {
  const gift = bill({ items: [...bill().items, { retailId: 'g', name: 'ของแถม', unitPrice: 0, qty: 1, promoGift: { dealId: 'd', name: 'แถม' } }] })
  assert.equal(luckyDrawsOf(gift, { perBaht: 100, itemIds: ['g'] }), 0)
  const big = bill({ items: [{ retailId: 'a', name: 'เค้กใหญ่', unitPrice: 10000, qty: 1 }] })
  assert.equal(luckyDrawsOf(big, { perBaht: 100, itemIds: ['a'] }), MAX_DRAWS_PER_BILL)
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
})

await t('URL ของ QR: ชี้ไปหน้าลุ้นโชคของบิล และตัด / ท้ายออก', () => {
  assert.equal(luckyUrl('https://example.com/', 'TOKEN'), 'https://example.com/#/luck/TOKEN')
  assert.equal(luckyUrl('', 'TOKEN'), `${LUCKY_SITE_URL}/#/luck/TOKEN`)
})

console.log(`ผ่าน ${pass} กรณี`)
