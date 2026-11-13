// ทดสอบการตั้งค่ายืนยันสลิปอัตโนมัติ และการนับวันถึงวันนัดรับ (ฟังก์ชันล้วน)
import { assertEquals } from 'jsr:@std/assert@1'
import { autoConfirmOf, daysUntilPickup } from './slip.ts'

Deno.test('ยืนยันอัตโนมัติ: ค่าเริ่มต้นปิดและ 3 วัน · ค่าผิดรูปแบบหรือเกิน 30 ใช้ค่าเริ่มต้น', () => {
  assertEquals(autoConfirmOf(undefined), { enabled: false, days: 3 })
  assertEquals(autoConfirmOf({ autoConfirm: { enabled: true } }), { enabled: true, days: 3 })
  assertEquals(autoConfirmOf({ autoConfirm: { enabled: true, days: 5 } }), { enabled: true, days: 5 })
  assertEquals(autoConfirmOf({ autoConfirm: { enabled: 'yes', days: 40 } }), { enabled: false, days: 3 })
  assertEquals(autoConfirmOf({ autoConfirm: { enabled: true, days: -1 } }), { enabled: true, days: 3 })
  assertEquals(autoConfirmOf({ autoConfirm: { enabled: true, days: 2.5 } }), { enabled: true, days: 3 })
  assertEquals(autoConfirmOf({ autoConfirm: { enabled: true, days: 0 } }), { enabled: true, days: 0 })
})

Deno.test('วันนัดรับห่างจากวันนี้ตามปฏิทินเวลาไทย: นัดวันนี้ = 0 · ข้ามเที่ยงคืนไทยแล้วนับใหม่ · วันที่ไม่มีจริงหรือไม่มีวัน = null', () => {
  const at1000Th = Date.UTC(2026, 10, 11, 3, 0) // 11-11-2569 10:00 เวลาไทย
  assertEquals(daysUntilPickup('2026-11-11T18:00', at1000Th), 0)
  assertEquals(daysUntilPickup('2026-11-14T10:00', at1000Th), 3)
  assertEquals(daysUntilPickup('2026-11-10T23:00', at1000Th), -1)
  // 23:30 เวลาไทยวันที่ 10 = 16:30Z วันที่ 10 → วันนี้ยังเป็นวันที่ 10 ตามปฏิทินไทย
  assertEquals(daysUntilPickup('2026-11-11T09:00', Date.UTC(2026, 10, 10, 16, 30)), 1)
  // 00:30 เวลาไทยวันที่ 11 = 17:30Z วันที่ 10 → วันนี้เป็นวันที่ 11 ตามปฏิทินไทยแล้ว
  assertEquals(daysUntilPickup('2026-11-14T09:00', Date.UTC(2026, 10, 10, 17, 30)), 3)
  assertEquals(daysUntilPickup(undefined, at1000Th), null)
  assertEquals(daysUntilPickup('', at1000Th), null)
  assertEquals(daysUntilPickup('2026-02-31T10:00', at1000Th), null)
  assertEquals(daysUntilPickup('2026-13-01T10:00', at1000Th), null)
})
