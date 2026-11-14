import { assert, assertEquals } from 'jsr:@std/assert@1'
import { clientIp, createLimiter } from './ratelimit.ts'

const T0 = 1_700_000_000_000

Deno.test('ตัวจำกัด: คำขอที่เกินจำนวนในหน้าต่างเวลาถูกจำกัด และคีย์ต่างกันไม่กระทบกัน', () => {
  const limited = createLimiter()
  for (let i = 0; i < 5; i++) assertEquals(limited('a', 5, 60_000, T0 + i), false)
  assertEquals(limited('a', 5, 60_000, T0 + 10), true)
  assertEquals(limited('b', 5, 60_000, T0 + 10), false)
})

Deno.test('ตัวจำกัด: คำขอที่ถูกปฏิเสธไม่ต่อเวลาล็อก (กลับมาใช้ได้เมื่อคำขอที่ผ่านพ้นหน้าต่างเวลา)', () => {
  const limited = createLimiter()
  for (let i = 0; i < 3; i++) limited('k', 3, 60_000, T0) // เต็ม 3/3 ที่เวลา T0
  for (let s = 1; s < 60; s++) assertEquals(limited('k', 3, 60_000, T0 + s * 1000), true) // ถูกปฏิเสธรัว ๆ ตลอดหน้าต่าง
  assertEquals(limited('k', 3, 60_000, T0 + 60_000), false) // ครบหน้าต่างแล้วต้องผ่าน (ของเดิมจะยังติดเพราะนับคำขอที่ถูกปฏิเสธด้วย)
})

Deno.test('ตัวจำกัด: หน้าแชทโพลล์ทุก 3 วินาทีต่อเนื่อง 1 ชั่วโมง ต้องไม่ถูกจำกัดเลย (เพดาน 40 ครั้ง/นาที)', () => {
  const limited = createLimiter()
  let blocked = 0
  for (let sec = 0; sec <= 3600; sec += 3) if (limited('cl:cust1', 40, 60_000, T0 + sec * 1000)) blocked++
  assertEquals(blocked, 0)
})

Deno.test('ตัวจำกัด: ตัวจำกัดเดิม (40 ครั้ง/5 นาที ต่อ IP) ยังกันการยิงถี่จริง', () => {
  const limited = createLimiter()
  let ok = 0
  for (let i = 0; i < 100; i++) if (!limited('ip', 40, 300_000, T0 + i * 100)) ok++
  assertEquals(ok, 40)
})

Deno.test('ตัวจำกัด: จำนวนคีย์มีเพดาน (ยิงด้วย IP ปลอมจำนวนมากแล้วหน่วยความจำไม่โตไม่จำกัด)', () => {
  const limited = createLimiter(100)
  for (let i = 0; i < 1000; i++) limited(`ip${i}`, 5, 60_000, T0 + i)
  // เรียกอีกครั้งหลังพ้นชั่วโมง: คีย์เก่าถูกเก็บกวาด ไม่ผิดพลาด และยังจำกัดตามปกติ
  for (let i = 0; i < 5; i++) assertEquals(limited('late', 5, 60_000, T0 + 2 * 3_600_000 + i), false)
  assertEquals(limited('late', 5, 60_000, T0 + 2 * 3_600_000 + 10), true)
})

Deno.test('clientIp: ใช้ cf-connecting-ip ก่อน · ไม่มีใช้ค่าท้ายสุดของ x-forwarded-for · ไม่มีเลย = unknown', () => {
  assertEquals(clientIp(new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 5.6.7.8' })), '1.2.3.4')
  // ค่าซ้ายสุดของ x-forwarded-for ผู้เรียกใส่เองได้ จึงไม่ใช้
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7' })), '7.7.7.7')
  assertEquals(clientIp(new Headers()), 'unknown')
  assert(clientIp(new Headers({ 'x-forwarded-for': '  ' })) === 'unknown')
})
