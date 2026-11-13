// ทดสอบการตรวจยินยอมก่อนชำระ: ชนิดที่ยังไม่ยินยอมเวอร์ชันปัจจุบัน
import { assertEquals } from 'jsr:@std/assert@1'
import { consentNeededFor } from './consent.ts'

// ตัวจำลองของ supabase-js ที่ใช้เฉพาะ select/eq/maybeSingle และ await
// deno-lint-ignore no-explicit-any
const sbWith = (legalDocs: Record<string, { version: number }>, records: Array<{ kind: string; version: number }>): any => ({
  from(table: string) {
    const result = table === 'punpang_kv' ? { data: { data: { v: { docs: legalDocs } } } } : { data: records.map((r) => ({ data: { customerId: 'c1', ...r } })) }
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => result,
      then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok),
    }
    return chain
  },
})

const DOCS = { privacy: { version: 2 }, terms: { version: 1 }, cookie: { version: 1 } }

Deno.test('ยังไม่เคยยินยอม → ต้องยินยอมทั้ง 3 ข้อ', async () => {
  assertEquals(await consentNeededFor(sbWith(DOCS, []), 'c1'), ['privacy', 'terms', 'cookie'])
})

Deno.test('ยินยอมเวอร์ชันปัจจุบันแล้ว → ไม่ต้องถามซ้ำ', async () => {
  assertEquals(await consentNeededFor(sbWith(DOCS, [{ kind: 'privacy', version: 2 }, { kind: 'terms', version: 1 }, { kind: 'cookie', version: 1 }]), 'c1'), [])
})

Deno.test('เวอร์ชันนโยบายเปลี่ยน → ถามเฉพาะข้อที่เวอร์ชันใหม่กว่าที่เคยยินยอม', async () => {
  assertEquals(await consentNeededFor(sbWith(DOCS, [{ kind: 'privacy', version: 1 }, { kind: 'terms', version: 1 }, { kind: 'cookie', version: 1 }]), 'c1'), ['privacy'])
})

Deno.test('ไม่มีลูกค้าผูกกับออร์เดอร์ → ไม่ต้องยินยอม', async () => {
  assertEquals(await consentNeededFor(sbWith(DOCS, []), null), [])
})
