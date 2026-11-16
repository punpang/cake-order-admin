// ทดสอบการผูกบัญชี LINE (LIFF) และคำตอบลิงก์ของบอท · รัน: deno test supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import { ACCOUNT_URL, lineLinkReply, lineUserIdOk, liffTokenOk, MENU_URL, parseLinkRequest } from './lineliff.ts'

const SESSION = 'a'.repeat(64)

Deno.test('คำขอผูกบัญชี: รับเฉพาะโทเค็น LIFF และเซสชัน hex 64 ตัว', () => {
  assertEquals(parseLinkRequest({ accessToken: 'abcdefghijklmnopqrstuv_-.', session: SESSION }), { accessToken: 'abcdefghijklmnopqrstuv_-.', session: SESSION })
  assertEquals(parseLinkRequest({ accessToken: 'short', session: SESSION }), null)
  assertEquals(parseLinkRequest({ accessToken: 'abcdefghijklmnopqrstuv', session: 'xyz' }), null)
  assertEquals(parseLinkRequest({ accessToken: 'abcdefghijklmnopqrstuv <script>', session: SESSION }), null)
  assertEquals(parseLinkRequest(null), null)
})

Deno.test('โทเค็น LIFF: ต้องเป็นช่อง LINE Login ของร้าน และยังไม่หมดอายุ', () => {
  assertEquals(liffTokenOk({ client_id: '2012641404', expires_in: 2591000 }), true)
  assertEquals(liffTokenOk({ client_id: '9999999999', expires_in: 2591000 }), false)
  assertEquals(liffTokenOk({ client_id: '2012641404', expires_in: 0 }), false)
  assertEquals(liffTokenOk(null), false)
})

Deno.test('userId ของ LINE: รูปแบบ U + hex 32 ตัว', () => {
  assertEquals(lineUserIdOk('U7d5e00ac071ac807830fc480b3794a05'), true)
  assertEquals(lineUserIdOk('X7d5e00ac071ac807830fc480b3794a05'), false)
  assertEquals(lineUserIdOk(''), false)
})

Deno.test('คำตอบลิงก์: สั่งเค้ก และคะแนน/บัญชีสมาชิก ตอบลิงก์ ส่วนบัญชีโอนเงินและคำถามทั่วไปไม่ตอบ', () => {
  assertEquals(lineLinkReply('อยากสั่งเค้กวันเกิด'), `สั่งเค้กออนไลน์ได้ที่นี่ค่ะ ${MENU_URL}`)
  assertEquals(lineLinkReply('ดูคะแนนหน่อย')?.endsWith(ACCOUNT_URL), true)
  assertEquals(lineLinkReply('เลขบัญชีโอนเงินเท่าไหร่'), null)
  assertEquals(lineLinkReply('มีเค้กช็อกโกแลตไหม'), null)
})
