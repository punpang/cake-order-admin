// ทดสอบกติกาลุ้นโชคท้ายบิล (ฟังก์ชันล้วน) · รัน: deno test supabase/functions/_shared/
// การเลือกรางวัลตามลำดับของโครงการ และจำนวนที่ออกแล้ว ทดสอบจริงในฐานข้อมูล: supabase/tests/lucky.test.sql
import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { isProjectId, isTokenShape, tallyByProject, tokenFromBytes } from './lucky.ts'

Deno.test('token: 24 ไบต์ → 32 ตัว base64url และผ่านรูปแบบ', () => {
  const t = tokenFromBytes(new Uint8Array(24).map((_, i) => i * 7))
  assertEquals(t.length, 32)
  assertMatch(t, /^[A-Za-z0-9_-]+$/)
  assertEquals(isTokenShape(t), true)
  assertEquals(isTokenShape('short'), false)
  assertEquals(isTokenShape(t + '='), false)
})

Deno.test('รหัสโครงการ: ตัวอักษร ตัวเลข _ - ไม่เกิน 64 ตัว', () => {
  assertEquals(isProjectId('lpjabc-12_3'), true)
  assertEquals(isProjectId('legacy'), true)
  assertEquals(isProjectId(''), false)
  assertEquals(isProjectId('a b'), false)
  assertEquals(isProjectId('x'.repeat(65)), false)
})

Deno.test('นับรางวัลที่ออกไปแล้วแยกตามโครงการและรหัสรางวัล: ข้ามการไม่ได้รางวัลและรายการที่ไม่ครบ', () => {
  const spins = [
    { projectId: 'p1', prize: { id: 'pA' } },
    { projectId: 'p1', prize: { id: 'pB' } },
    { projectId: 'p1', prize: { id: 'pA' } },
    { projectId: 'p1', prize: null }, // ไม่มีรางวัล (null)
    { projectId: 'p2', prize: { id: 'qX' } },
    { prize: { id: 'pA' } }, // ไม่มีรหัสโครงการ
    { projectId: 'p2', prize: {} }, // ไม่มีรหัสรางวัล
  ]
  assertEquals(tallyByProject(spins), { p1: { pA: 2, pB: 1 }, p2: { qX: 1 } })
  assertEquals(tallyByProject([]), {})
})
