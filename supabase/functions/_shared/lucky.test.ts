// ทดสอบกติกาลุ้นโชคท้ายบิล (ฟังก์ชันล้วน) · รัน: deno test supabase/functions/_shared/
// การเลือกรางวัลตามลำดับ/จำนวน และการนับตามช่วงเวลา ทดสอบจริงในฐานข้อมูล: supabase/tests/lucky.test.sql
import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { isTokenShape, tallyAwards, tokenFromBytes } from './lucky.ts'

Deno.test('token: 24 ไบต์ → 32 ตัว base64url และผ่านรูปแบบ', () => {
  const t = tokenFromBytes(new Uint8Array(24).map((_, i) => i * 7))
  assertEquals(t.length, 32)
  assertMatch(t, /^[A-Za-z0-9_-]+$/)
  assertEquals(isTokenShape(t), true)
  assertEquals(isTokenShape('short'), false)
  assertEquals(isTokenShape(t + '='), false)
})

Deno.test('นับรางวัลที่ออกไปแล้วต่อรหัสรางวัล: เฉพาะที่ได้รางวัลและอยู่ในช่วงเปิดลุ้น', () => {
  const from = Date.parse('2026-11-15T00:00:00.000Z')
  const to = Date.parse('2026-11-30T23:59:59.000Z')
  const spins = [
    { at: '2026-11-15T01:00:00.000Z', prize: { id: 'pA' } },
    { at: '2026-11-16T01:00:00.000Z', prize: { id: 'pB' } },
    { at: '2026-11-17T01:00:00.000Z', prize: { id: 'pA' } },
    { at: '2026-11-18T01:00:00.000Z', prize: null }, // ไม่ได้รางวัล
    { at: '2026-11-14T23:00:00.000Z', prize: { id: 'pA' } }, // ก่อนเริ่มช่วง
    { at: '2026-12-01T00:00:00.000Z', prize: { id: 'pB' } }, // หลังสิ้นสุดช่วง
    { at: 'ไม่ใช่วันที่', prize: { id: 'pA' } }, // อ่านเวลาไม่ได้
  ]
  assertEquals(tallyAwards(spins, from, to), { pA: 2, pB: 1 })
  assertEquals(tallyAwards(spins, Number.NaN, to), {}) // ช่วงไม่ถูกต้อง = ไม่มีรายการ
  assertEquals(tallyAwards([], from, to), {})
})
