// ทดสอบ CORS แบบจำกัดต้นทาง · รัน: deno test supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import { allowedOrigin, corsWrap } from './cors.ts'

const PAGES = 'https://cake-order-admin.pages.dev'

Deno.test('ต้นทางที่อนุญาต: หน้าเว็บ แอป Android/iOS และพัฒนาในเครื่อง', () => {
  for (const o of [PAGES, 'https://localhost', 'capacitor://localhost', 'http://localhost:5173']) assertEquals(allowedOrigin(o), o)
})
Deno.test('ต้นทางอื่น ต้นทางที่หลอกชื่อ และค่าว่างไม่ได้รับ', () => {
  for (const o of ['https://evil.example', `${PAGES}.evil.example`, 'null', 'http://localhost', '', null]) assertEquals(allowedOrigin(o), null)
})
Deno.test('corsWrap: ตอบ ACAO เฉพาะต้นทางที่อนุญาต และไม่คงค่า * เดิม', async () => {
  const h = corsWrap(() => new Response('{}', { headers: { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' } }))
  const ok = await h(new Request('https://x.test/', { method: 'POST', headers: { origin: PAGES } }))
  assertEquals(ok.headers.get('access-control-allow-origin'), PAGES)
  assertEquals(ok.headers.get('vary'), 'Origin')
  const bad = await h(new Request('https://x.test/', { method: 'POST', headers: { origin: 'https://evil.example' } }))
  assertEquals(bad.headers.get('access-control-allow-origin'), null)
  const server = await h(new Request('https://x.test/', { method: 'POST' }))
  assertEquals(server.headers.get('access-control-allow-origin'), null)
  assertEquals(await server.text(), '{}')
})
Deno.test('corsWrap: preflight OPTIONS ตอบ 200 โดยไม่เรียก handler', async () => {
  let called = false
  const h = corsWrap(() => { called = true; return new Response('x') })
  const r = await h(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: PAGES } }))
  assertEquals(called, false)
  assertEquals(r.status, 200)
  assertEquals(r.headers.get('access-control-allow-origin'), PAGES)
  assertEquals(r.headers.get('access-control-allow-headers'), 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version, x-punpang-mode')
  assertEquals(r.headers.get('access-control-allow-methods')?.includes('POST'), true)
})
