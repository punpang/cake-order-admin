// ทดสอบการตรวจ Turnstile ฝั่งเซิร์ฟเวอร์ (supabase/functions/_shared/turnstile.ts) · ล้มเหลวปิด: ไม่มี token/ตรวจไม่ได้ = ไม่ผ่าน
import { assertEquals } from 'jsr:@std/assert@1'
import { verifyTurnstile } from '../../../functions/_shared/turnstile.ts'

const okFetch = (body: unknown, calls: { body?: string }[] = []) => (async (_u: string, init?: RequestInit) => {
  calls.push({ body: String(init?.body ?? '') })
  return new Response(JSON.stringify(body), { status: 200 })
}) as typeof fetch

Deno.test('ไม่มี token → ไม่ผ่าน และไม่เรียกเครือข่าย', async () => {
  const calls: { body?: string }[] = []
  assertEquals(await verifyTurnstile('', '1.2.3.4', 'secret', okFetch({ success: true }, calls)), false)
  assertEquals(calls.length, 0)
})
Deno.test('ไม่มี secret → ไม่ผ่าน (ตั้งค่าไม่ครบ)', async () => {
  assertEquals(await verifyTurnstile('tok', '1.2.3.4', '', okFetch({ success: true })), false)
})
Deno.test('ตอบ success=true → ผ่าน และส่ง secret/response/remoteip', async () => {
  const calls: { body?: string }[] = []
  assertEquals(await verifyTurnstile('tok', '1.2.3.4', 'sec', okFetch({ success: true }, calls)), true)
  const sent = new URLSearchParams(calls[0].body)
  assertEquals(sent.get('secret'), 'sec')
  assertEquals(sent.get('response'), 'tok')
  assertEquals(sent.get('remoteip'), '1.2.3.4')
})
Deno.test('ตอบ success=false → ไม่ผ่าน', async () => {
  assertEquals(await verifyTurnstile('tok', '1.2.3.4', 'sec', okFetch({ success: false, 'error-codes': ['invalid-input-response'] })), false)
})
Deno.test('เครือข่ายล้มเหลว → ไม่ผ่าน (ล้มเหลวปิด)', async () => {
  const failing = (async () => { throw new Error('network') }) as typeof fetch
  assertEquals(await verifyTurnstile('tok', '1.2.3.4', 'sec', failing), false)
})
Deno.test('ตอบ HTTP 500 → ไม่ผ่าน', async () => {
  const bad = (async () => new Response('x', { status: 500 })) as typeof fetch
  assertEquals(await verifyTurnstile('tok', '1.2.3.4', 'sec', bad), false)
})
