// ทดสอบตัวช่วยของ line-push · รัน: deno test supabase/functions/_shared/linepush.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { LINE_TEXT_MAX, pickFollowedLineUser, pushPayload } from './linepush.ts'

Deno.test('pushPayload: ข้อความปกติ → ข้อความเดียวแบบ text (ตัดช่องว่างหัวท้าย)', () => {
  assertEquals(pushPayload('  พร้อมรับแล้วค่ะ  '), { ok: true, messages: [{ type: 'text', text: 'พร้อมรับแล้วค่ะ' }] })
})
Deno.test('pushPayload: ว่างหรือไม่ใช่ข้อความ → ปฏิเสธ', () => {
  assertEquals(pushPayload('   ').ok, false)
  assertEquals(pushPayload(undefined).ok, false)
  assertEquals(pushPayload(123).ok, false)
})
Deno.test('pushPayload: ยาวเกินเพดาน → ปฏิเสธ · พอดีเพดาน → รับ', () => {
  assertEquals(pushPayload('ก'.repeat(LINE_TEXT_MAX + 1)).ok, false)
  assertEquals(pushPayload('a'.repeat(LINE_TEXT_MAX)).ok, true)
})
Deno.test('pickFollowedLineUser: เลือกคนที่ยังติดตามและอัปเดตล่าสุด', () => {
  const rows = [
    { line_user_id: 'U1', followed: false, updated_at: '2026-11-20T10:00:00Z' },
    { line_user_id: 'U2', followed: true, updated_at: '2026-11-18T10:00:00Z' },
    { line_user_id: 'U3', followed: true, updated_at: '2026-11-19T10:00:00Z' },
  ]
  assertEquals(pickFollowedLineUser(rows), 'U3')
})
Deno.test('pickFollowedLineUser: ไม่มีคนติดตาม/ข้อมูลเสีย → null', () => {
  assertEquals(pickFollowedLineUser([{ line_user_id: 'U1', followed: false }]), null)
  assertEquals(pickFollowedLineUser([]), null)
  assertEquals(pickFollowedLineUser(null), null)
})
