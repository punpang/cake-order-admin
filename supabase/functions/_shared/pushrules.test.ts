// ทดสอบกติกาแจ้งเตือนพนักงาน (push): ทุกประเภทของกระดิ่งพนักงานต้องมีกติกาเดียวกัน (ประเภท + สิทธิ์) เพื่อไม่ให้ push กับกระดิ่งเพี้ยนกัน
import { assertEquals } from 'jsr:@std/assert@1'
import { BELL_STAFF } from './schedlib/bell.js'
import { ruleOf, STAFF_PUSH_RULES } from './pushrules.ts'

Deno.test('pushrules: ประเภทของกระดิ่งพนักงานทุกชนิดมีกติกา push (และไม่มีเกิน)', () => {
  assertEquals(Object.keys(STAFF_PUSH_RULES).sort(), Object.keys(BELL_STAFF).sort())
})

Deno.test('pushrules: สิทธิ์ของแต่ละประเภทตรงกับกระดิ่งในแอป', () => {
  for (const [ev, def] of Object.entries(BELL_STAFF) as [string, { perms: string[] }][]) {
    assertEquals(STAFF_PUSH_RULES[ev].perms, def.perms, ev)
  }
})

Deno.test('pushrules: ปลายทางขึ้นต้นด้วย /admin และพาไปหน้าที่ถูก', () => {
  assertEquals(ruleOf('team_new_order')?.path({ orderId: 'o1' }), '/admin/orders/o1')
  assertEquals(ruleOf('team_customer_message')?.path({ chatId: 'c1' }), '/admin/chat/c1')
  assertEquals(ruleOf('team_customer_message')?.path({}), '/admin/chat')
  for (const ev of Object.keys(STAFF_PUSH_RULES)) assertEquals(ruleOf(ev)?.path({}).startsWith('/admin'), true, ev)
})

Deno.test('pushrules: ชื่อประเภทที่ไม่มีอยู่ (รวมชื่อใน prototype) ไม่มีกติกา', () => {
  assertEquals(ruleOf('some_other_event'), null)
  assertEquals(ruleOf('constructor'), null)
  assertEquals(ruleOf('__proto__'), null)
})
