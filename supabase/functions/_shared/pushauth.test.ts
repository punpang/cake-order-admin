import { assertEquals } from 'jsr:@std/assert@1'
import { checkPushKey } from './pushauth.ts'

Deno.test('push-send: ไม่ได้ตั้งคีย์ไว้ = ปฏิเสธทุกคำขอ', () => {
  assertEquals(checkPushKey('', 'anything'), 'not-configured')
  assertEquals(checkPushKey('   ', null), 'not-configured')
})

Deno.test('push-send: ไม่มีคีย์หรือคีย์ไม่ตรง (ยาว/สั้นกว่า/ต่างตัว) = ปฏิเสธ', () => {
  assertEquals(checkPushKey('secret-key-123', null), 'forbidden')
  assertEquals(checkPushKey('secret-key-123', ''), 'forbidden')
  assertEquals(checkPushKey('secret-key-123', 'secret-key-124'), 'forbidden')
  assertEquals(checkPushKey('secret-key-123', 'secret-key-1234'), 'forbidden')
  assertEquals(checkPushKey('secret-key-123', 'secret-key-12'), 'forbidden')
})

Deno.test('push-send: คีย์ตรงเท่านั้นที่ผ่าน', () => {
  assertEquals(checkPushKey('secret-key-123', 'secret-key-123'), 'ok')
})
