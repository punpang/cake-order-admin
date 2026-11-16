// ทดสอบประชาสัมพันธ์/โปรโมชั่น (ฝั่งเซิร์ฟเวอร์) ด้วยไคลเอนต์จำลองในหน่วยความจำ
// รัน: deno test -A supabase/functions/_shared/campaign.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { customerCardView } from './customerchat.ts'
import { audienceCount, cancelCampaign, dispatchDueCampaigns, getCampaign, resumeCampaign, runWithin, saveDraft, scheduleSend, sendChunk, startNow } from './campaign.ts'

// deno-lint-ignore no-explicit-any
type Any = any
// รหัสสถานะของผลลัพธ์ (สำเร็จ = 200)
const st = (r: Any): number => (r && 'error' in r ? r.status : 200)

// ไคลเอนต์จำลอง: รองรับ select/eq/in/not/gt/order/limit/maybeSingle/insert/update ที่ใช้จริง และตัวกรองแบบ data->>key
function fakeDb(seed: Record<string, Any[]>) {
  const tables: Record<string, Any[]> = structuredClone(seed)
  let tick = 0
  const val = (r: Any, c: string): Any => (c.includes('->>') ? r[c.split('->>')[0]]?.[c.split('->>')[1]] : r[c])
  const str = (v: Any) => (v == null ? '' : String(v))
  const from = (table: string): Any => {
    const filters: ((r: Any) => boolean)[] = []
    let order = ''
    let lim = Infinity
    let patch: Any = null
    const matched = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)))
    const rows = () => {
      let out = matched()
      if (order) out = [...out].sort((a, b) => (str(val(a, order)) < str(val(b, order)) ? -1 : 1))
      return out.slice(0, lim).map((r) => structuredClone(r))
    }
    const q: Any = {
      select() {
        if (patch) { // update ... select: เขียนจริงแล้วคืนรายการที่ถูกแก้
          const hit = matched()
          for (const r of hit) { Object.assign(r, patch); if (table === 'punpang_chats') r.updated_at = `t${++tick}` }
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
        }
        return q
      },
      eq(c: string, v: Any) { filters.push((r) => str(val(r, c)) === str(v)); return q },
      in(c: string, arr: Any[]) { const s = arr.map(str); filters.push((r) => s.includes(str(val(r, c)))); return q },
      not(c: string) { filters.push((r) => val(r, c) != null); return q },
      gt(c: string, v: Any) { filters.push((r) => str(val(r, c)) > str(v)); return q },
      order(c: string) { order = c; return q },
      limit(n: number) { lim = n; return q },
      update(p: Any) { patch = p; return q },
      insert(row: Any) {
        if (table === 'punpang_records' && (tables[table] || []).some((r) => r.collection === row.collection && r.id === row.id)) {
          return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
        }
        tables[table] = [...(tables[table] || []), table === 'punpang_chats' ? { ...row, updated_at: `t${++tick}` } : row]
        return Promise.resolve({ error: null })
      },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
      then(res: Any, rej: Any) { return Promise.resolve({ data: rows(), error: null }).then(res, rej) },
    }
    return q
  }
  return { from, tables }
}

const NOW = Date.parse('2026-11-16T10:00:00+07:00')
const iso = (ms: number) => new Date(ms).toISOString()
const OPT = '2026-11-01T00:00:00.000Z'
const customer = (id: string, data: Any = {}) => ({ id, name: `ลูกค้า ${id}`, data: { promoOptIn: true, promoConsentAt: OPT, ...data } })
const accounts = (...ids: string[]) => ids.map((customer_id) => ({ customer_id }))
const campaign = (over: Any = {}) => {
  const id = String(over.id ?? 'cmp1')
  const base = { type: 'promo', title: 'ลด 10%', body: 'ทุกเค้กวันศุกร์นี้', image: '', url: 'https://punpang.test/menu', status: 'draft', scheduledAt: null, createdAt: iso(NOW - 3600e3), createdBy: 'u1', updatedAt: iso(NOW - 3600e3), startedAt: null, progressAt: null, sentAt: null, cursor: '', stats: { targets: 0, sent: 0, failed: 0, skipped: 0 } }
  return { collection: 'campaigns', id, data: { ...base, id, ...over } }
}

Deno.test('ผู้รับ: เฉพาะคนที่มีบัญชีเว็บ + เปิดรับเอง (มีเวลายินยอม) + ไม่ถูกปิด/ลบ', async () => {
  const sb = fakeDb({
    punpang_customers: [customer('c1'), customer('c2'), customer('c3', { promoConsentAt: undefined }), customer('c4', { promoOptIn: false }), customer('c5', { deleted: true }), customer('c6', { active: false })],
    punpang_customer_auth: accounts('c1', 'c3', 'c4', 'c5', 'c6'),
  })
  assertEquals(await audienceCount(sb), 1)
})

Deno.test('ส่งเป็นการ์ดในแชทเว็บ: สร้างแชทให้ถ้ายังไม่มี · มีการ์ดโปรโมชั่นและบรรทัดปิดรับข่าวสาร', async () => {
  const sb = fakeDb({ punpang_customers: [customer('c1')], punpang_customer_auth: accounts('c1'), punpang_chats: [], punpang_records: [campaign({ status: 'sending' })] })
  const c = (await getCampaign(sb, 'cmp1'))!
  const r = await sendChunk(sb, c, iso(NOW))
  assertEquals([r.sent, r.failed, r.skipped, r.done], [1, 0, 0, true])
  const chat = sb.tables.punpang_chats[0]
  assertEquals(chat.customer_id, 'c1')
  const m = chat.data.messages[0]
  assertEquals([m.from, m.kind, m.card.kind, m.card.title, m.card.url, m.by, m.delivery], ['staff', 'card', 'promo', 'ลด 10%', 'https://punpang.test/menu', 'ร้าน', 'sent'])
  assertEquals(m.text.endsWith('ปิดรับข่าวสารได้ที่ บัญชี › รับข่าวสารและโปรโมชัน'), true)
})

Deno.test('กันส่งซ้ำ: ลูกค้าที่จองไว้แล้วถูกข้าม และไม่มีข้อความซ้ำในแชท', async () => {
  const sb = fakeDb({ punpang_customers: [customer('c1')], punpang_customer_auth: accounts('c1'), punpang_chats: [], punpang_records: [campaign({ status: 'sending' })] })
  const c = (await getCampaign(sb, 'cmp1'))!
  await sendChunk(sb, c, iso(NOW))
  const again = await sendChunk(sb, c, iso(NOW))
  assertEquals([again.sent, again.skipped], [0, 1])
  assertEquals(sb.tables.punpang_chats[0].data.messages.length, 1)
})

Deno.test('หมดเวลาแล้วทำต่อจากจุดเดิม: ครบทุกคนพอดี ไม่ส่งซ้ำ และจบสถานะ sent', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `c${String(i + 1).padStart(3, '0')}`)
  const sb = fakeDb({ punpang_customers: ids.map((id) => customer(id)), punpang_customer_auth: accounts(...ids), punpang_chats: [], punpang_records: [campaign({ status: 'sending', stats: { targets: 51, sent: 0, failed: 0, skipped: 0 } })] })
  const first = await runWithin(sb, (await getCampaign(sb, 'cmp1'))!, 0)
  assertEquals([first.status, first.stats.sent, first.cursor], ['sending', 50, 'c050'])
  const last = await runWithin(sb, first, 60e3)
  assertEquals([last.status, last.stats.sent], ['sent', 51])
  assertEquals(sb.tables.punpang_chats.reduce((n: number, ch: Any) => n + ch.data.messages.length, 0), 51)
})

Deno.test('รอบอัตโนมัติ: ถึงเวลาแล้วส่ง · ยังไม่ถึงเวลาไม่แตะต้อง', async () => {
  const sb = fakeDb({
    punpang_customers: [customer('c1')], punpang_customer_auth: accounts('c1'), punpang_chats: [],
    punpang_records: [campaign({ id: 'due', status: 'scheduled', scheduledAt: iso(NOW - 60e3) }), campaign({ id: 'later', status: 'scheduled', scheduledAt: iso(NOW + 3600e3) })],
  })
  assertEquals(await dispatchDueCampaigns(sb, NOW, 60e3), { started: 1, resumed: 0, completed: 1 })
  assertEquals([(await getCampaign(sb, 'due'))?.status, (await getCampaign(sb, 'later'))?.status], ['sent', 'scheduled'])
})

Deno.test('ส่งเลยแล้วนับผู้รับและส่งจนจบ', async () => {
  const sb = fakeDb({ punpang_customers: [customer('c1'), customer('c2')], punpang_customer_auth: accounts('c1', 'c2'), punpang_chats: [], punpang_records: [campaign()] })
  const r = await startNow(sb, 'cmp1', NOW, 60e3)
  if ('error' in r) throw new Error(r.error)
  assertEquals([r.campaign.status, r.campaign.stats.targets, r.campaign.stats.sent], ['sent', 2, 2])
})

Deno.test('ส่งเลยแต่ไม่มีผู้รับ → ไม่เริ่มส่ง และยังเป็นฉบับร่าง', async () => {
  const sb = fakeDb({ punpang_customers: [customer('c2', { promoConsentAt: undefined })], punpang_customer_auth: [], punpang_chats: [], punpang_records: [campaign()] })
  assertEquals(st(await startNow(sb, 'cmp1', NOW, 60e3)), 400)
  assertEquals((await getCampaign(sb, 'cmp1'))?.status, 'draft')
})

Deno.test('สถานะถูกต้อง: แก้/ยกเลิก/ส่งต่อ/ตั้งเวลาได้เฉพาะตามขั้นตอน และตรวจข้อมูลก่อนบันทึก', async () => {
  const sb = fakeDb({
    punpang_customers: [customer('c1')], punpang_customer_auth: accounts('c1'), punpang_chats: [],
    punpang_records: [campaign({ id: 'done', status: 'sent' }), campaign({ id: 'busy', status: 'sending', progressAt: iso(NOW) })],
  })
  assertEquals(st(await saveDraft(sb, { type: 'sms', title: 'x', body: 'y' }, 'u1', iso(NOW))), 400)
  assertEquals(st(await saveDraft(sb, { id: 'done', type: 'promo', title: 'x', body: 'y' }, 'u1', iso(NOW))), 409)
  assertEquals(st(await cancelCampaign(sb, 'busy', NOW)), 409)
  assertEquals(st(await resumeCampaign(sb, 'busy', NOW + 1000, 60e3)), 409)
  assertEquals(st(await scheduleSend(sb, 'done', iso(NOW + 3600e3), NOW)), 409)
})

Deno.test('มุมมองลูกค้า: การ์ดประชาสัมพันธ์คงชนิดและลิงก์ https ไว้ ส่วนลิงก์ http ถูกตัดทิ้ง', () => {
  const v = customerCardView({ id: 'm1', kind: 'card', text: 'ข้อความ', cardText: 'ข้อความ', at: iso(NOW), card: { kind: 'promo', title: 'ลด 10%', url: 'https://punpang.test/menu', image: 'http://insecure.test/x.jpg' } }) as Any
  assertEquals([v.card.kind, v.card.title, v.card.url, v.card.image], ['promo', 'ลด 10%', 'https://punpang.test/menu', null])
  const ad = customerCardView({ id: 'm2', kind: 'card', text: 'x', at: iso(NOW), card: { kind: 'ad', title: 'เปิดสาขา' } }) as Any
  assertEquals(ad.card.kind, 'ad')
})
