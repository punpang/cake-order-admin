// ทดสอบรอบตามเวลาของสิทธิ์สมาชิกทั้งเส้น: ข้อมูลลูกค้า → planLoyalty → runPlans (ฝั่ง IO จำลอง)
// ยืนยัน 3 อย่าง: SMS ไม่ไปหาลูกค้าที่ยังไม่ยินยอม · ลูกค้าที่ยินยอมเข้าคิว · รอบซ้ำไม่ส่งซ้ำ (คีย์ notifySent)
import { assertEquals } from 'jsr:@std/assert@1'
import { runPlans, type Ctx } from './run.ts'
import { planLoyalty } from '../schedlib/memberNotify.js'

// deno-lint-ignore no-explicit-any
type Any = any

const NOW = Date.parse('2026-11-23T10:00:00.000Z')
const RECENT = '2026-11-23T09:00:00.000Z'

// ไคลเอนต์จำลอง: เก็บ insert และปฏิเสธ insert ซ้ำของ punpang_records (จำลองคีย์ซ้ำ)
function fakeSb() {
  const inserts: { table: string; row: Any }[] = []
  const seen = new Set<string>()
  const from = (table: string): Any => {
    const q: Any = {
      eq() { return q }, select() { return q }, order() { return q }, range() { return q },
      maybeSingle() { return Promise.resolve({ data: null, error: null }) },
      insert(row: Any) {
        const key = `${table}|${row.collection ?? ''}|${row.id ?? ''}`
        if (table === 'punpang_records' && seen.has(key)) return Promise.resolve({ error: { message: 'duplicate key' } })
        seen.add(key)
        inserts.push({ table, row })
        return Promise.resolve({ error: null })
      },
      update() { const u: Any = { eq() { return u }, select() { return Promise.resolve({ data: [{ id: 'x' }], error: null }) } }; return u },
    }
    return q
  }
  return { from, inserts }
}

const outboxOf = (sb: Any) => sb.inserts.filter((i: Any) => i.table === 'punpang_records' && i.row.collection === 'outbox').map((i: Any) => i.row.data)

const RULE = { event: 'tier_up', channels: ['sms'], template: 'ยินดีด้วยค่ะ {ชื่อลูกค้า} เป็น {ระดับ}', enabled: true }
const customers = [
  // ยังไม่ยินยอม SMS
  { id: 'c1', name: 'ก', phone: '0812345678', ledger: [{ id: 'l1', at: RECENT, delta: 50, reason: 'โบนัสเลื่อนเป็น LV2' }] },
  // ยินยอม SMS แล้ว
  { id: 'c2', name: 'ข', phone: '0823456789', smsOptIn: true, smsConsentAt: '2026-11-20T00:00:00.000Z', ledger: [{ id: 'l2', at: RECENT, delta: 50, reason: 'โบนัสเลื่อนเป็น LV2' }] },
]

const ctxOf = (sb: Any): Ctx => ({
  sb, nowMs: NOW, rules: [RULE], integrations: { sms: { enabled: true } }, chats: [], fb: null, gw: null, tg: null, siteUrl: 'https://site.test',
} as Any)

Deno.test('สิทธิ์สมาชิก: SMS ไม่ไปถึงลูกค้าที่ยังไม่ยินยอม · ลูกค้าที่ยินยอมเข้าคิว', async () => {
  const sb = fakeSb()
  const plans = (planLoyalty({ nowMs: NOW, customers }) as Any)
  const res = await runPlans(ctxOf(sb), plans)
  assertEquals(res.done, 2)
  const ob = outboxOf(sb).filter((o: Any) => o.channel === 'sms')
  assertEquals(ob.map((o: Any) => o.to.split(':')[1].trim().split(' ')[0]), ['ข'])
})

Deno.test('สิทธิ์สมาชิก: รอบซ้ำไม่ส่งซ้ำ (คีย์ notifySent กันไว้)', async () => {
  const sb = fakeSb()
  const plans = (planLoyalty({ nowMs: NOW, customers }) as Any)
  await runPlans(ctxOf(sb), plans)
  const before = outboxOf(sb).length
  const second = await runPlans(ctxOf(sb), (planLoyalty({ nowMs: NOW, customers }) as Any))
  assertEquals([second.done, second.skipped], [0, 2])
  assertEquals(outboxOf(sb).length, before)
})
