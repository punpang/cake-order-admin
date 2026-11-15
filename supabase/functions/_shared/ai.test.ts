// ทดสอบอะแดปเตอร์ AI: Workers AI (รูปแบบผลลัพธ์ การเรียกเส้นทางบัญชี และการจำแนกโควตา) · ใช้ fetch จำลอง ไม่เรียกระบบจริง
import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { complete, isQuotaError, normalizeMessages } from './ai.ts'

const REQ = { provider: 'workers', model: '@cf/openai/gpt-oss-120b', key: 'tok', accountId: 'acc1', system: 'ระบบ', messages: [{ role: 'user' as const, content: 'สวัสดี' }], maxTokens: 200 }

// แทน fetch ชั่วคราวระหว่างทดสอบ และคืนค่าเดิมเสมอ
async function withFetch(stub: (url: string, init: RequestInit) => Response, fn: (calls: Array<{ url: string; init: RequestInit }>) => Promise<void>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), init })
    return stub(String(input), init)
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = orig
  }
}

Deno.test('Workers AI: เรียกเส้นทางของบัญชี ส่งข้อความระบบเป็นข้อความแรก และอ่าน result.response', async () => {
  await withFetch(() => new Response(JSON.stringify({ success: true, result: { response: 'ร้านเปิด 9:00 น.' } }), { status: 200 }), async (calls) => {
    assertEquals(await complete(REQ), 'ร้านเปิด 9:00 น.')
    assertEquals(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc1/ai/run/@cf/openai/gpt-oss-120b')
    assertEquals((calls[0].init.headers as Record<string, string>).authorization, 'Bearer tok')
    const body = JSON.parse(String(calls[0].init.body))
    assertEquals(body.messages, [{ role: 'system', content: 'ระบบ' }, { role: 'user', content: 'สวัสดี' }])
    assertEquals(body.max_tokens, 200)
  })
})

Deno.test('Workers AI: รองรับรูปแบบ result.choices[0].message.content', async () => {
  await withFetch(() => new Response(JSON.stringify({ success: true, result: { choices: [{ message: { content: 'ตอบแล้ว' } }] } }), { status: 200 }), async () => {
    assertEquals(await complete(REQ), 'ตอบแล้ว')
  })
})

Deno.test('Workers AI: 429 หรือข้อความโควตาหมด → เป็น AiQuotaError เพื่อส่งต่อ Claude', async () => {
  await withFetch(() => new Response('{}', { status: 429 }), async () => {
    assertEquals(isQuotaError(await complete(REQ).catch((x) => x)), true)
  })
  await withFetch(() => new Response('daily free allocation exceeded', { status: 403 }), async () => {
    assertEquals(isQuotaError(await complete(REQ).catch((x) => x)), true)
  })
})

Deno.test('Workers AI: ข้อผิดพลาดอื่นไม่ถือเป็นโควตา (ไม่ส่งต่ออัตโนมัติ)', async () => {
  await withFetch(() => new Response('internal', { status: 500 }), async () => {
    const e = await complete(REQ).catch((x) => x)
    assertEquals([e instanceof Error, isQuotaError(e)], [true, false])
  })
})

Deno.test('Workers AI: ไม่มีรหัสบัญชีหรือโทเค็น → ไม่เรียกระบบ', async () => {
  await withFetch(() => new Response('{}'), async (calls) => {
    await assertRejects(() => complete({ ...REQ, accountId: undefined }))
    await assertRejects(() => complete({ ...REQ, key: '' }))
    assertEquals(calls.length, 0)
  })
})

Deno.test('normalizeMessages: ตัดข้อความนำหน้าที่ไม่ใช่ user และรวมข้อความ role เดียวกันติดกัน', () => {
  assertEquals(normalizeMessages([{ role: 'assistant', content: 'x' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), [{ role: 'user', content: 'a\nb' }])
})
