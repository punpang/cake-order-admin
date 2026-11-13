// ทดสอบตัวแยกวัน-เวลาทำรายการจากข้อความสลิป (ใช้กับผลอ่านจาก Workers AI)
import { assertEquals } from 'jsr:@std/assert@1'
import { inferThaiDateTime, parseThaiDateTime } from './slipText.ts'

Deno.test('วัน-เวลา: ปี พ.ศ. 4 หลักและ 2 หลัก แปลงเป็นค.ศ. ได้ถูกต้อง', () => {
  assertEquals(parseThaiDateTime('13 พ.ย. 2569 - 01:28'), '2026-11-13T01:28')
  assertEquals(parseThaiDateTime('12 พ.ย. 69 11:52'), '2026-11-12T11:52')
})

Deno.test('วัน-เวลา: เดือนหรือวันที่อ่านไม่ได้ → null (ให้พนักงานตรวจ)', () => {
  assertEquals(parseThaiDateTime('ll w.g. 69 20:24'), null)
  assertEquals(parseThaiDateTime('ll พ.ย. 69 15:49'), '2026-11-11T15:49') // l = 1 (OCR)
  assertEquals(parseThaiDateTime('ll พ.ย. 69 15:49x'), '2026-11-11T15:49')
  assertEquals(parseThaiDateTime('31 ก.พ. 2569 10:00'), null)
})

Deno.test('วัน-เวลา: สระลอยหลังจุดในชื่อเดือน ("พ.ุย.") ยังอ่านได้', () => {
  assertEquals(parseThaiDateTime('12 พ.ุย. 69 11:52'), '2026-11-12T11:52')
})

Deno.test('วัน-เวลา: เดือนอ่านไม่ออก → คาดการณ์เดือนล่าสุดที่ไม่เกินตอนนี้', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0) // 12-11-2026 19:00 เวลาไทย
  assertEquals(inferThaiDateTime('ทํารายการ\n11 we. 69 15:49', now), '2026-11-11T15:49')
  assertEquals(inferThaiDateTime('ทํารายการ\n25 we. 69 15:49', now), '2026-10-25T15:49') // 25 พ.ย. ยังไม่ถึง → เดือนก่อน
  assertEquals(inferThaiDateTime('ไม่มีวันที่', now), null)
})
Deno.test('วัน-เวลา: มีคอมมาหลังปีได้ (รูปแบบของแอป CLICX และ Bangkok Bank)', () => {
  assertEquals(parseThaiDateTime('10 พ.ย. 2569, 09:57'), '2026-11-10T09:57')
  assertEquals(parseThaiDateTime('25 ต.ค. 69, 08:33'), '2026-10-25T08:33')
  assertEquals(inferThaiDateTime('25 ต.ค. 69, 08:33', Date.UTC(2026, 10, 12, 12, 0)), '2026-10-25T08:33')
})
