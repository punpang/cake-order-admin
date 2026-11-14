// ทดสอบการรับโทเค็นแจ้งเตือนของลูกค้า และผลการลงทะเบียน (ไม่แตะฐานข้อมูลจริง ใช้ตัวปลอม)
import { assertEquals } from 'jsr:@std/assert@1'
import { cleanPushToken, customerPushRegister } from './customerpush.ts'

const TOKEN = 'dK3xY9:APA91b' + 'Q'.repeat(140)

Deno.test('โทเค็นรูปแบบถูกต้องผ่าน · ตัดช่องว่างหัวท้าย · ว่าง/มีช่องว่าง/สั้น/ยาวเกินไปไม่ผ่าน', () => {
  assertEquals(cleanPushToken(TOKEN), TOKEN)
  assertEquals(cleanPushToken('  ' + TOKEN + '  '), TOKEN)
  assertEquals(cleanPushToken(''), null)
  assertEquals(cleanPushToken(undefined), null)
  assertEquals(cleanPushToken('short-token'), null)
  assertEquals(cleanPushToken(TOKEN.slice(0, 60) + ' ' + TOKEN.slice(60)), null)
  assertEquals(cleanPushToken('a'.repeat(4096)), 'a'.repeat(4096))
  assertEquals(cleanPushToken('a'.repeat(4097)), null)
})

// ตัวปลอมของ upsert: คืนผลตามที่กำหนด
const fakeDb = (res: { error: { code: string; message: string } | null }) => ({
  from: () => ({ upsert: async () => res }),
})

Deno.test('ลงทะเบียน: โทเค็นผิด → 400 · สำเร็จ → 200 · เซสชันถูกลบระหว่างทาง → 401 · ข้อผิดพลาดอื่น → 500', async () => {
  assertEquals((await customerPushRegister(fakeDb({ error: null }), 'c1', 'h1', 'สั้น')).status, 400)
  assertEquals((await customerPushRegister(fakeDb({ error: null }), 'c1', 'h1', TOKEN)).status, 200)
  assertEquals((await customerPushRegister(fakeDb({ error: { code: '23503', message: 'fk' } }), 'c1', 'h1', TOKEN)).status, 401)
  assertEquals((await customerPushRegister(fakeDb({ error: { code: 'XX', message: 'db' } }), 'c1', 'h1', TOKEN)).status, 500)
})
