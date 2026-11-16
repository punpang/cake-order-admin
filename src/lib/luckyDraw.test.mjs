// ทดสอบกติกาฝั่งแอปของลุ้นโชคท้ายบิล (หลายโครงการ) · รัน: node src/lib/luckyDraw.test.mjs
import assert from 'node:assert/strict'
import {
  LUCKY_SITE_URL, LEGACY_PROJECT_ID, MAX_DRAWS_PER_BILL, genLuckyToken, hashLuckyToken, luckyDefaults, luckyDrawsByProject,
  luckyBudgetOf, luckyProjectsOf, luckyUrl, newLuckyProject, prizeValueOf, projectDrawsOf, projectOpenAt, validateLuckyConfig, validateLuckyPrizes, validateLuckyProject, worstRoundValue,
} from './luckyDraw.js'

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
  { id: 'p1', name: 'ส่วนลด 50 บาท', kind: 'discount', amount: 50 },
  { id: 'p2', name: 'คัพเค้ก 1 ชิ้น', kind: 'reward', amount: 0, value: 30 },
]
const OPEN = { from: '2026-11-15T00:00:00.000Z', to: '2026-11-30T23:59:59.000Z' }
const items = (over = {}) => ({ id: 'j1', name: 'โครงการสินค้า', enabled: true, kind: 'items', itemIds: ['a'], everyBaht: null, ...OPEN, couponDays: 30, prizes: PR, ...over })
const amount = (over = {}) => ({ id: 'j2', name: 'โครงการยอด', enabled: true, kind: 'amount', itemIds: [], everyBaht: 100, roundDraws: 10, prizePct: 50, ...OPEN, couponDays: 30, prizes: PR, ...over })

await t('ค่าเริ่มต้น: ไม่มีโครงการ อายุคูปอง 30 วัน และชี้ไปเว็บหลัก · โครงการใหม่ยังปิดอยู่', () => {
  const d = luckyDefaults()
  assert.deepEqual(d.projects, [])
  assert.equal(d.siteUrl, LUCKY_SITE_URL)
  const n = newLuckyProject('x', 'amount')
  assert.equal(n.enabled, false)
  assert.equal(n.everyBaht, 100)
  assert.equal(newLuckyProject('y', 'items').everyBaht, null)
  assert.equal(n.couponDays, 30)
})

await t('รายการโครงการ: รูปแบบใหม่ใช้ตามที่เก็บ · รูปแบบเดิมย้ายเป็นโครงการแรก legacy (ซื้อสินค้าที่เลือก) · ไม่มีค่าเลยได้ว่าง', () => {
  assert.deepEqual(luckyProjectsOf({ projects: [items()] }), [items()])
  const legacy = luckyProjectsOf({ enabled: true, from: OPEN.from, to: OPEN.to, couponDays: 14, perBaht: 100, itemIds: ['a'], prizes: PR })
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].id, LEGACY_PROJECT_ID)
  assert.equal(legacy[0].kind, 'items')
  assert.deepEqual(legacy[0].itemIds, ['a'])
  assert.equal(legacy[0].couponDays, 14)
  assert.deepEqual(luckyProjectsOf(undefined), [])
  assert.deepEqual(luckyProjectsOf(luckyDefaults()), [])
})

await t('ตรวจรายการรางวัล: ชื่อ ประเภท ส่วนลด คะแนน และรหัสรางวัล (ไม่มีจำนวนจำกัด)', () => {
  assert.equal(validateLuckyPrizes(PR), '')
  assert.equal(validateLuckyPrizes([]), '')
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], name: ' ' }]), '')
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], kind: 'coupon' }]), '') // ประเภทคูปองไม่มีในรายการ
  assert.notEqual(validateLuckyPrizes([{ ...PR[0], amount: 0 }]), '') // ส่วนลดต้องมากกว่า 0
  assert.notEqual(validateLuckyPrizes([PR[0], { ...PR[1], id: 'p1' }]), '') // รหัสซ้ำ
  assert.notEqual(validateLuckyPrizes([{ ...PR[1], id: '' }]), '')
  assert.equal(validateLuckyPrizes([{ id: 'x', name: 'คะแนน', kind: 'points', points: 10 }]), '')
  assert.notEqual(validateLuckyPrizes([{ id: 'x', name: 'คะแนน', kind: 'points', points: 0 }]), '') // ต้องมากกว่า 0
  assert.notEqual(validateLuckyPrizes([{ id: 'x', name: 'คะแนน', kind: 'points', points: 1.5 }]), '') // ต้องเป็นจำนวนเต็ม
  assert.equal(validateLuckyPrizes([{ id: 'n', name: 'ไม่ได้รางวัล', kind: 'none' }]), '') // ไม่มีค่าเพิ่ม
  assert.notEqual(validateLuckyPrizes(null), '')
})

await t('ตรวจโครงการ: ชื่อ · เงื่อนไขสินค้า/ยอด · อายุคูปอง · เปิดแล้วต้องมีช่วงวันและรางวัล', () => {
  assert.equal(validateLuckyProject(items()), '')
  assert.equal(validateLuckyProject(amount()), '')
  assert.match(validateLuckyProject(items({ name: ' ' })), /ตั้งชื่อ/)
  assert.match(validateLuckyProject(items({ kind: 'other' })), /เลือกเงื่อนไข/)
  assert.match(validateLuckyProject(items({ itemIds: [] })), /เลือกสินค้า/)
  assert.equal(validateLuckyProject(items({ itemIds: [], enabled: false })), '') // ปิดอยู่ยังไม่ต้องเลือกสินค้า
  assert.match(validateLuckyProject(amount({ everyBaht: 0 })), /มากกว่า 0/)
  assert.match(validateLuckyProject(amount({ everyBaht: 0, enabled: false })), /มากกว่า 0/) // ค่าที่กรอกต้องถูกเสมอ
  assert.match(validateLuckyProject(items({ couponDays: 0 })), /1–365/)
  assert.match(validateLuckyProject(items({ couponDays: 366 })), /1–365/)
  assert.match(validateLuckyProject(items({ from: '', to: '' })), /ช่วงวันที่/)
  assert.match(validateLuckyProject(items({ from: OPEN.to, to: OPEN.from })), /ช่วงวันที่/)
  assert.match(validateLuckyProject(items({ prizes: [] })), /รางวัล/)
  assert.equal(validateLuckyProject(items({ prizes: [], enabled: false })), '')
})

await t('ตรวจทั้งชุด: รหัสโครงการไม่ซ้ำ และแจ้งลำดับโครงการที่ผิด', () => {
  assert.equal(validateLuckyConfig({ projects: [items(), amount()] }), '')
  assert.equal(validateLuckyConfig({ projects: [] }), '')
  assert.match(validateLuckyConfig({ projects: [items(), amount({ id: 'j1' })] }), /รหัสโครงการซ้ำ/)
  assert.match(validateLuckyConfig({ projects: [items(), amount({ everyBaht: 0 })] }), /^โครงการที่ 2: /)
})

await t('เปิดโครงการ: ต้องเปิดใช้งานและบิลถูกขายในช่วงเวลา', () => {
  const p = items()
  assert.equal(projectOpenAt(p, Date.parse('2026-11-14T23:59:00.000Z')), false)
  assert.equal(projectOpenAt(p, Date.parse('2026-11-20T00:00:00.000Z')), true)
  assert.equal(projectOpenAt(p, Date.parse('2026-12-01T00:00:00.000Z')), false)
  assert.equal(projectOpenAt({ ...p, enabled: false }, Date.parse('2026-11-20T00:00:00.000Z')), false)
})

await t('ซื้อสินค้าที่เลือก: มีสินค้าที่เลือกอย่างน้อย 1 ชิ้น = 1 ครั้ง ไม่ดูจำนวนหรือราคา', () => {
  assert.equal(projectDrawsOf(bill(), items({ itemIds: ['a'] })), 1) // a ซื้อ 2 ชิ้น = 1 ครั้ง
  assert.equal(projectDrawsOf(bill(), items({ itemIds: ['b'] })), 1) // b ราคา 50 บาท ก็ได้ 1 ครั้ง
  assert.equal(projectDrawsOf(bill(), items({ itemIds: ['x'] })), 0) // ไม่มีสินค้าที่เลือกในบิล
  assert.equal(projectDrawsOf(bill(), items({ itemIds: [] })), 0)
  const gift = bill({ items: [{ retailId: 'g', name: 'ของแถม', unitPrice: 0, qty: 1, promoGift: { dealId: 'd', name: 'แถม' } }] })
  assert.equal(projectDrawsOf(gift, items({ itemIds: ['g'] })), 0) // ของแถมจากโปรไม่นับ
})

await t('ซื้อครบทุก X บาท: ยอดที่จ่ายจริงทั้งบิล ÷ X ปัดลง และไม่เกินเพดาน', () => {
  assert.equal(projectDrawsOf(bill(), amount({ everyBaht: 100 })), 2) // 250 ÷ 100
  assert.equal(projectDrawsOf(bill(), amount({ everyBaht: 50 })), 5) // 250 ÷ 50
  assert.equal(projectDrawsOf(bill(), amount({ everyBaht: 300 })), 0) // ยังไม่ถึง 300
  assert.equal(projectDrawsOf(bill(), amount({ everyBaht: 0 })), 0)
  const big = bill({ items: [{ retailId: 'a', name: 'เค้กใหญ่', unitPrice: 10000, qty: 1 }] })
  assert.equal(projectDrawsOf(big, amount({ everyBaht: 100 })), MAX_DRAWS_PER_BILL)
})

await t('ยอดซื้อครบใช้ยอดหลังหักส่วนลดและคูปอง', () => {
  const withCoupon = bill({ couponsUsed: [{ couponId: 'c1', name: 'คูปอง', amount: 50 }] }) // ยอดจ่าย 200 จาก 250
  assert.equal(projectDrawsOf(withCoupon, amount({ everyBaht: 100 })), 2) // 200 ÷ 100
  assert.equal(projectDrawsOf(withCoupon, amount({ everyBaht: 150 })), 1) // 200 ÷ 150
})

await t('หลายโครงการ: แต่ละโครงการนับแยก · เฉพาะโครงการที่เปิดในช่วงเวลาขาย และมีครั้งลุ้นอย่างน้อย 1', () => {
  const cfg = {
    projects: [
      items({ id: 'j1' }), // ซื้อสินค้า a → 1 ครั้ง
      amount({ id: 'j2', everyBaht: 100 }), // 250 → 2 ครั้ง
      amount({ id: 'j3', everyBaht: 300 }), // ยังไม่ถึง → ไม่มี
      items({ id: 'j4', itemIds: ['x'] }), // ไม่มีสินค้าในบิล → ไม่มี
      items({ id: 'j5', enabled: false }), // ปิดอยู่ → ไม่มี
      amount({ id: 'j6', from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' }), // ยังไม่ถึงช่วง → ไม่มี
    ],
  }
  const now = Date.parse('2026-11-20T00:00:00.000Z')
  assert.deepEqual(luckyDrawsByProject(bill(), cfg, now), { j1: 1, j2: 2 })
  assert.deepEqual(luckyDrawsByProject(bill(), { projects: [] }, now), {})
  assert.deepEqual(luckyDrawsByProject(bill(), undefined, now), {})
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

await t('โครงการใหม่แบบซื้อครบทุก X บาท: ค่าเริ่มต้น 100 ครั้งต่อรอบ และ 5% · แบบสินค้าไม่มีค่าเหล่านี้', () => {
  const n = newLuckyProject('x', 'amount')
  assert.equal(n.roundDraws, 100)
  assert.equal(n.prizePct, 5)
  assert.equal(newLuckyProject('y', 'items').roundDraws, null)
  assert.equal(newLuckyProject('y', 'items').prizePct, null)
})

await t('งบรางวัลต่อรอบ: 100 บาท × 100 ครั้ง × 5% = เพดาน 500 บาท (ตัวอย่างจากโจทย์)', () => {
  const noneRows = Array.from({ length: 99 }, (_, i) => ({ id: `n${i}`, name: 'ไม่ได้รางวัล', kind: 'none' }))
  const ok500 = amount({ everyBaht: 100, roundDraws: 100, prizePct: 5, prizes: [{ id: 'd1', name: 'ส่วนลด 500 บาท', kind: 'discount', amount: 500 }, ...noneRows] })
  const b = luckyBudgetOf(ok500)
  assert.equal(b.ceiling, 500)
  assert.equal(b.worst, 500)
  assert.equal(b.over, false)
  assert.equal(validateLuckyProject(ok500), '')

  const over501 = amount({ everyBaht: 100, roundDraws: 100, prizePct: 5, prizes: [{ id: 'd1', name: 'ส่วนลด 501 บาท', kind: 'discount', amount: 501 }, ...noneRows] })
  assert.equal(luckyBudgetOf(over501).over, true)
  assert.match(validateLuckyProject(over501), /เกินเพดาน 500 บาท/)
  assert.match(validateLuckyConfig({ projects: [items(), over501] }), /^โครงการที่ 2: .*เกินเพดาน 500 บาท/)
})

await t('งบรางวัลต่อรอบ: จำนวนครั้งในรอบ เปอร์เซ็นต์ และมูลค่าของแลกต้องถูกต้อง', () => {
  assert.match(validateLuckyProject(amount({ roundDraws: 0 })), /จำนวนครั้งลุ้นต่อ 1 รอบ/)
  assert.match(validateLuckyProject(amount({ roundDraws: 1.5 })), /จำนวนครั้งลุ้นต่อ 1 รอบ/)
  assert.match(validateLuckyProject(amount({ prizePct: 0 })), /ต้องมากกว่า 0% และไม่เกิน 100%/)
  assert.match(validateLuckyProject(amount({ prizePct: 101 })), /ต้องมากกว่า 0% และไม่เกิน 100%/)
  assert.match(validateLuckyProject(amount({ prizes: [{ id: 'r', name: 'คัพเค้ก', kind: 'reward', amount: 0, value: 0 }] })), /ต้องใส่มูลค่า/)
  // แบบซื้อสินค้าที่เลือกไม่คิดงบรางวัล
  assert.equal(validateLuckyProject(items({ prizes: [{ id: 'd', name: 'ใหญ่มาก', kind: 'discount', amount: 1000000 }] })), '')
})

await t('มูลค่ารางวัลตามชนิด: ส่วนลด = บาท · ของแลก = มูลค่าที่กรอก · คะแนน = คะแนน × มูลค่าต่อคะแนน · ไม่ได้รางวัล = 0', () => {
  assert.equal(prizeValueOf({ kind: 'discount', amount: 50 }), 50)
  assert.equal(prizeValueOf({ kind: 'reward', value: 120 }), 120)
  assert.equal(prizeValueOf({ kind: 'points', points: 100 }, 2), 200)
  assert.equal(prizeValueOf({ kind: 'none' }), 0)
})

await t('รางวัลวนตามลำดับ: รอบเริ่มจุดไหนก็ได้ จึงคิดจุดเริ่มที่มูลค่ารวมมากที่สุด', () => {
  assert.equal(worstRoundValue([300, 0, 0], 100), 10200) // 33 รอบเต็ม (9,900) + ครั้งที่เหลือ 1 ได้ 300 อีก
  assert.equal(worstRoundValue([50, 30], 10), 400) // 5 รอบเต็ม × 80
  assert.equal(worstRoundValue([100, 0, 0, 0], 2), 100) // จุดเริ่มท้ายลำดับ ได้ [100, 0]
  assert.equal(worstRoundValue([], 10), 0)
})

await t('งบรางวัลด้วยคะแนน: คะแนนมีมูลค่าตามการตั้งค่าร้าน (มูลค่าต่อคะแนน)', () => {
  const pts = amount({ everyBaht: 100, roundDraws: 10, prizePct: 5, prizes: [{ id: 'pt', name: 'คะแนน 100', kind: 'points', points: 100 }] })
  // เพดาน 100 × 10 × 5% = 50 บาท · ถ้า 1 คะแนน = 1 บาท รอบละ 10 ครั้ง = 1,000 บาท
  assert.equal(validateLuckyProject(pts, 0), '')
  assert.match(validateLuckyProject(pts, 1), /เกินเพดาน 50 บาท/)
  assert.match(validateLuckyConfig({ projects: [pts], pointValue: 1 }), /^โครงการที่ 1: /)
  assert.equal(validateLuckyConfig({ projects: [pts], pointValue: 0 }), '')
})

console.log(`ผ่าน ${pass} กรณี`)
