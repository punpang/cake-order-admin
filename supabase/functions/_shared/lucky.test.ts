// ทดสอบกติกาลุ้นโชคท้ายบิล (ฟังก์ชันล้วน) · รัน: deno test supabase/functions/_shared/
import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { CODE_ALPHABET, codeFromBytes, inWindow, isTokenShape, nextSpin, percentFromBytes, pickPrize, tallyAwards, tokenFromBytes, validatePrizes } from './lucky.ts'

const P = [
  { id: 'a', name: 'ส่วนลด 50', kind: 'coupon' as const, amount: 50, chance: 10 },
  { id: 'b', name: 'คัพเค้ก', kind: 'item' as const, amount: 0, chance: 30 },
]

Deno.test('token: 24 ไบต์ → 32 ตัว base64url และผ่านรูปแบบ', () => {
  const t = tokenFromBytes(new Uint8Array(24).map((_, i) => i * 7))
  assertEquals(t.length, 32)
  assertMatch(t, /^[A-Za-z0-9_-]+$/)
  assertEquals(isTokenShape(t), true)
  assertEquals(isTokenShape('short'), false)
  assertEquals(isTokenShape(t + '='), false)
})

Deno.test('รหัสรางวัล: 6 ตัวจากตัวอักษรที่อ่านง่าย (ไม่มี 0 O 1 I)', () => {
  const code = codeFromBytes(new Uint8Array([0, 31, 255, 32, 1, 2]))
  assertEquals(code.length, 6)
  for (const ch of code) assertEquals(CODE_ALPHABET.includes(ch), true)
  assertEquals(/[01OI]/.test(CODE_ALPHABET), false)
  assertEquals(CODE_ALPHABET.length, 32)
})

Deno.test('ตรวจรายการรางวัล: ชื่อว่าง/โอกาสติดลบ/รวมเกิน 100 ไม่ผ่าน', () => {
  assertEquals(validatePrizes(P), '')
  assertEquals(validatePrizes([{ ...P[0], name: '  ' }]) !== '', true)
  assertEquals(validatePrizes([{ ...P[0], chance: -1 }]) !== '', true)
  assertEquals(validatePrizes([{ ...P[0], chance: 60 }, { ...P[1], chance: 41 }]).includes('เกิน 100'), true)
  assertEquals(validatePrizes([{ ...P[0], chance: 60 }, { ...P[1], chance: 40 }]), '')
})

Deno.test('สุ่มรางวัล: ช่วงสะสมตามโอกาส และส่วนที่เหลือไม่ได้รางวัล', () => {
  assertEquals(pickPrize(P, 0)?.id, 'a') // 0 ≤ r < 10
  assertEquals(pickPrize(P, 9.99)?.id, 'a')
  assertEquals(pickPrize(P, 10)?.id, 'b') // 10 ≤ r < 40
  assertEquals(pickPrize(P, 39.99)?.id, 'b')
  assertEquals(pickPrize(P, 40), null) // 40 ≤ r < 100 = ไม่ได้รางวัล
  assertEquals(pickPrize(P, 99.9), null)
  assertEquals(pickPrize([], 5), null)
})

Deno.test('เลขสุ่มจาก 4 ไบต์อยู่ในช่วง [0, 100)', () => {
  assertEquals(percentFromBytes(new Uint8Array([0, 0, 0, 0])), 0)
  const max = percentFromBytes(new Uint8Array([255, 255, 255, 255]))
  assertEquals(max < 100, true)
  assertEquals(max > 99.99, true)
})

Deno.test('ช่วงเวลาเปิดลุ้น: from ≤ now ≤ to เท่านั้น', () => {
  const cfg = { from: '2026-11-15T00:00:00.000Z', to: '2026-11-30T23:59:59.000Z' }
  assertEquals(inWindow(cfg, Date.parse('2026-11-14T23:59:59.000Z')), false)
  assertEquals(inWindow(cfg, Date.parse('2026-11-15T00:00:00.000Z')), true)
  assertEquals(inWindow(cfg, Date.parse('2026-11-30T23:59:59.000Z')), true)
  assertEquals(inWindow(cfg, Date.parse('2026-12-01T00:00:00.000Z')), false)
  assertEquals(inWindow({ from: '', to: '' }, Date.now()), false)
  assertEquals(inWindow({ from: 'x', to: 'y' }, Date.now()), false)
})

Deno.test('การลุ้นครั้งถัดไป: ครบจำนวนแล้วคืน null · ถ้าได้รางวัลมีรหัสและวันหมดอายุ', () => {
  const now = '2026-11-20T10:00:00.000Z'
  const rnd = new Uint8Array([0, 0, 0, 0, 5, 6, 7, 8, 9, 10]) // สุ่มได้ 0% → รางวัลแรก
  const won = nextSpin({ draws: 2, spinCount: 0, prizes: P, rnd, nowIso: now, prizeDays: 30 })
  assertEquals(won?.prize?.id, 'a')
  assertEquals(won?.code?.length, 6)
  assertEquals(won?.codeExpiresAt, '2026-12-20T10:00:00.000Z')
  assertEquals(won?.redeemedAt, null)
  assertEquals(nextSpin({ draws: 2, spinCount: 2, prizes: P, rnd, nowIso: now, prizeDays: 30 }), null)
  const miss = nextSpin({ draws: 1, spinCount: 0, prizes: P, rnd: new Uint8Array([255, 255, 255, 255, 1, 1, 1, 1, 1, 1]), nowIso: now, prizeDays: 30 })
  assertEquals(miss?.prize, null) // 99.99% ≥ 40% รวมโอกาส → ไม่ได้รางวัล
  assertEquals(miss?.code, null)
  assertEquals(miss?.codeExpiresAt, null)
})

Deno.test('รางวัลที่ออกไปแล้วในช่วงเปิดลุ้น: นับเฉพาะที่ได้รางวัลและอยู่ในช่วง เรียงจากมากไปน้อย', () => {
  const from = Date.parse('2026-11-15T00:00:00.000Z')
  const to = Date.parse('2026-11-30T23:59:59.000Z')
  const spins = [
    { at: '2026-11-15T01:00:00.000Z', prize: { name: 'ส่วนลด 50' } },
    { at: '2026-11-16T01:00:00.000Z', prize: { name: 'คัพเค้ก' } },
    { at: '2026-11-17T01:00:00.000Z', prize: { name: 'ส่วนลด 50' } },
    { at: '2026-11-18T01:00:00.000Z', prize: null }, // ไม่ได้รางวัล
    { at: '2026-11-14T23:00:00.000Z', prize: { name: 'ส่วนลด 50' } }, // ก่อนเริ่มช่วง
    { at: '2026-12-01T00:00:00.000Z', prize: { name: 'คัพเค้ก' } }, // หลังสิ้นสุดช่วง
    { at: 'ไม่ใช่วันที่', prize: { name: 'ส่วนลด 50' } }, // อ่านเวลาไม่ได้
  ]
  assertEquals(tallyAwards(spins, from, to), [{ name: 'ส่วนลด 50', count: 2 }, { name: 'คัพเค้ก', count: 1 }])
  assertEquals(tallyAwards(spins, Number.NaN, to), []) // ช่วงไม่ถูกต้อง = ไม่มีรายการ
  assertEquals(tallyAwards([], from, to), [])
})
