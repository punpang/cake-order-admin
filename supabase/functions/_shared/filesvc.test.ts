// ทดสอบตัวเรียกเซิร์ฟเวอร์ไฟล์ (Worker): ส่งคีย์ลับ · คืน key/ref · ผิดพลาดแล้วไม่ทำให้ระบบล่ม
import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { isR2Ref, keyOfR2Ref, svcDelete, svcSign, svcUpload, type FilesEnv } from './filesvc.ts'

const fenv = (fetchImpl: typeof fetch): FilesEnv => ({ url: 'https://files.test', key: 'svc-key', fetchImpl })

Deno.test('svcUpload: ส่งคีย์ลับและ prefix แล้วคืน key กับ ref', async () => {
  const seen: Array<{ url: string; auth: string | null; len: number }> = []
  const f = fenv((async (input: any, init: any) => {
    seen.push({ url: String(input), auth: new Headers(init.headers).get('Authorization'), len: init.body.length })
    return new Response(JSON.stringify({ key: 'o1/x.png', ref: 'r2://private/o1/x.png' }), { status: 200 })
  }) as typeof fetch)
  assertEquals(await svcUpload(f, new Uint8Array([1, 2, 3]), 'o1'), { key: 'o1/x.png', ref: 'r2://private/o1/x.png' })
  assertEquals(seen[0], { url: 'https://files.test/svc/upload?bucket=private&prefix=o1', auth: 'Bearer svc-key', len: 3 })
})

Deno.test('svcUpload: ตอบผิดพลาดหรือไม่ได้ตั้งค่าไว้ → โยน error', async () => {
  await assertRejects(() => svcUpload(fenv((async () => new Response('{"error":"x"}', { status: 400 })) as typeof fetch), new Uint8Array([1]), 'o1'))
  await assertRejects(() => svcUpload({ url: '', key: '' }, new Uint8Array([1]), 'o1'))
})

Deno.test('svcSign คืนลิงก์หรือ null · svcDelete คืน true/false', async () => {
  const ok = fenv((async () => new Response(JSON.stringify({ url: 'https://files.test/f/x?exp=1&sig=s' }), { status: 200 })) as typeof fetch)
  assertEquals(await svcSign(ok, 'o1/x.png'), 'https://files.test/f/x?exp=1&sig=s')
  assertEquals(await svcSign(fenv((async () => new Response('{}', { status: 403 })) as typeof fetch), 'o1/x.png'), null)
  assertEquals(await svcDelete(ok, ['o1/x.png']), true)
  assertEquals(await svcDelete(fenv((async () => { throw new Error('net') }) as typeof fetch), ['o1/x.png']), false)
  assertEquals(await svcDelete(ok, []), false)
})

Deno.test('isR2Ref / keyOfR2Ref', () => {
  assertEquals(isR2Ref('r2://private/o1/x.png'), true)
  assertEquals(isR2Ref('sb://punpang-slips/o1/x.png'), false)
  assertEquals(keyOfR2Ref('r2://private/o1/x.png'), 'o1/x.png')
})
