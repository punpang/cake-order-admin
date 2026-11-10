import { runFbBot, offWindowStartMs } from './bot.ts'

// ---- ฐานข้อมูลจำลองแบบ CAS (updated_at) ----
type Row = { id: string; data: any; updated_at: string }
function makeSb(tables: { chats: Row[]; kv: any[]; records: any[] }) {
  let ver = 0
  const bump = () => new Date(Date.now() + ++ver).toISOString()
  return {
    records: tables.records,
    chats: tables.chats,
    from(table: string) {
      const f: Record<string, any> = {}
      let mode: 'select' | 'update' | 'insert' = 'select'
      let payload: any = null
      let single = false
      const q: any = {
        select() { return q },
        eq(c: string, v: any) { f[c] = v; return q },
        in(c: string, vs: any[]) { f[c + '_in'] = vs; return q },
        limit() { return q },
        maybeSingle() { single = true; return q },
        update(p: any) { mode = 'update'; payload = p; return q },
        insert(p: any) { mode = 'insert'; payload = p; return q },
        then(res: any, rej: any) {
          const run = async () => {
            if (table === 'punpang_kv') {
              const rows = tables.kv.filter((r) => (!f.collection || r.collection === f.collection) && (!f.id || r.id === f.id) && (!f.id_in || f.id_in.includes(r.id)))
              return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
            }
            if (table === 'punpang_records') {
              tables.records.push(payload)
              return { error: null }
            }
            // punpang_chats
            if (mode === 'select') {
              const rows = tables.chats.filter((r) => (!f.id || r.id === f.id))
              return single ? { data: rows[0] ? structuredClone(rows[0]) : null, error: null } : { data: rows, error: null }
            }
            if (mode === 'update') {
              const row = tables.chats.find((r) => r.id === f.id && r.updated_at === f.updated_at)
              if (!row) return { data: [], error: null }
              row.data = structuredClone(payload.data)
              row.updated_at = bump()
              return { data: [{ id: row.id }], error: null }
            }
            return { error: null }
          }
          return run().then(res, rej)
        },
      }
      return q
    },
  }
}

const shopCfg = { id: 'shop', collection: 'config', data: { v: { open: '09:00', close: '18:00', closures: {} } } }
const botCfg = { id: 'bot', collection: 'config', data: { v: { enabled: true, mode: 'auto', channels: { facebook: true }, sourceModes: { hours: 'auto', offhours: 'auto', faq: 'auto', rule: 'auto' }, rules: [], offHours: { enabled: true } } } }
const sfRow = { id: 'storefront', collection: 'storefront', data: { v: { faq: [] } } }

// เวลาในแอป: 10:00 น. ไทย = 03:00 UTC (เปิดร้าน)
const OPEN_AT = new Date().toISOString()
const NOW_MS = Date.now()

let fetchCalls: any[] = []
let onDelay: (() => void) | null = null
globalThis.fetch = (async (_url: any, opts: any) => {
  fetchCalls.push(JSON.parse(opts.body))
  return { ok: true }
}) as any
;(globalThis as any).setTimeout = (fn: any) => { onDelay?.(); setImmediate(fn); return 0 }

function chatWith(messages: any[], extra: any = {}): Row {
  return { id: 'ch1', data: { profileName: 'ลูกค้าทดสอบ', messages, ...extra }, updated_at: 'v0' }
}
const inbound = (mid: string, text: string) => ({ id: 'cmA', from: 'customer', kind: 'text', text, fbMid: mid, at: OPEN_AT, by: 'ลูกค้า' })
const base = { token: 't', ver: 'v24.0', psid: '123', chatId: 'ch1', at: OPEN_AT }
let fail = 0
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) fail++ }

function mk(messages: any[], extra: any = {}) {
  const chats = [chatWith(messages, extra)]
  const kv = [shopCfg, botCfg, sfRow]
  const records: any[] = []
  return { sb: makeSb({ chats, kv, records }), chats, records }
}

// 1) ตอบเวลาเปิดปกติ · ตอบ 1 ครั้ง · ปล่อยสิทธิ์จองแล้ว
{
  fetchCalls = []; onDelay = null
  const { sb, chats } = mk([inbound('m1', 'เปิดกี่โมงคะ')])
  await runFbBot({ ...base, sb, mid: 'm1', text: 'เปิดกี่โมงคะ' })
  const msgs = chats[0].data.messages
  check('ตอบเวลาเปิด: ส่ง Graph 1 ครั้ง', fetchCalls.length === 1)
  check('ตอบเวลาเปิด: บันทึกข้อความบอทลงแชท', msgs.some((x: any) => x.by === 'บอท' && x.botFor === 'm1' && x.delivery === 'sent'))
  check('ตอบเสร็จ: ปล่อย botClaim', chats[0].data.botClaim === null)
}

// 2) Meta ส่งข้อความเดิมซ้ำหลังตอบแล้ว → ไม่ตอบซ้ำ
{
  fetchCalls = []; onDelay = null
  const { sb } = mk([inbound('m2', 'เปิดกี่โมง')])
  await runFbBot({ ...base, sb, mid: 'm2', text: 'เปิดกี่โมง' })
  await runFbBot({ ...base, sb, mid: 'm2', text: 'เปิดกี่โมง' })
  check('ซ้ำหลังตอบแล้ว: ส่งแค่ 1 ครั้ง', fetchCalls.length === 1)
}

// 3) Meta ส่งซ้ำระหว่างรอหน่วงเวลา (สองการทำงานพร้อมกัน) → ตอบแค่ 1 ครั้ง
{
  fetchCalls = []; onDelay = null
  const { sb } = mk([inbound('m3', 'เปิดกี่โมง')])
  await Promise.all([
    runFbBot({ ...base, sb, mid: 'm3', text: 'เปิดกี่โมง' }),
    runFbBot({ ...base, sb, mid: 'm3', text: 'เปิดกี่โมง' }),
  ])
  check('ซ้ำพร้อมกัน: ส่งแค่ 1 ครั้ง', fetchCalls.length === 1)
}

// 4) พนักงานตอบระหว่างรอหน่วงเวลา → บอทไม่ส่ง และคืนสิทธิ์จอง
{
  fetchCalls = []
  const { sb, chats } = mk([inbound('m4', 'เปิดกี่โมง')])
  onDelay = () => {
    const row = chats[0]
    row.data = { ...row.data, messages: [...row.data.messages, { id: 'st', from: 'staff', text: 'ร้านเปิด 9 โมงค่ะ', by: 'พนักงาน' }] }
    row.updated_at = new Date(Date.now() + 999999).toISOString()
  }
  await runFbBot({ ...base, sb, mid: 'm4', text: 'เปิดกี่โมง' })
  onDelay = null
  check('พนักงานตอบระหว่างหน่วง: ไม่ส่ง', fetchCalls.length === 0)
  check('พนักงานตอบระหว่างหน่วง: คืนสิทธิ์จอง', chats[0].data.botClaim === null)
}

// 5) ส่งต่อ (เรื่องเงิน) → ไม่ส่งข้อความ ไม่สร้างกระดิ่งจากบอท, มีเหตุผลในแชท
{
  fetchCalls = []; onDelay = null
  const { sb, chats, records } = mk([inbound('m5', 'ขอคืนเงินหน่อย')])
  await runFbBot({ ...base, sb, mid: 'm5', text: 'ขอคืนเงินหน่อย' })
  check('ส่งต่อ: ไม่ส่งข้อความถึงลูกค้า', fetchCalls.length === 0)
  check('ส่งต่อ: ไม่สร้างกระดิ่งซ้ำจากบอท', records.length === 0)
  check('ส่งต่อ: ธง botHandoff + เหตุผล', chats[0].data.botHandoff === true && /เงิน/.test(chats[0].data.botHandoffReason || ''))
}

// 6) ปิดบอทในแชท → ไม่ทำอะไร
{
  fetchCalls = []; onDelay = null
  const { sb } = mk([inbound('m6', 'เปิดกี่โมง')], { botOff: true })
  await runFbBot({ ...base, sb, mid: 'm6', text: 'เปิดกี่โมง' })
  check('botOff: ไม่ส่ง', fetchCalls.length === 0)
}

// 7) นอกเวลาทำการ: ตอบครั้งเดียวต่อช่วงปิด (ข้อความที่สองของลูกค้าในช่วงเดียวกันไม่ตอบซ้ำ)
{
  fetchCalls = []; onDelay = null
  const alwaysClosed = { id: 'shop', collection: 'config', data: { v: { open: '00:00', close: '00:00', closures: {} } } }
  const chats = [chatWith([inbound('m7', 'สวัสดีค่ะ')])]
  const sb = makeSb({ chats, kv: [alwaysClosed, botCfg, sfRow], records: [] })
  await runFbBot({ ...base, sb, mid: 'm7', text: 'สวัสดีค่ะ' })
  chats[0].data.messages.push(inbound('m7b', 'มีใครอยู่ไหมคะ'))
  await runFbBot({ ...base, sb, mid: 'm7b', text: 'มีใครอยู่ไหมคะ' })
  check('นอกเวลาซ้ำในช่วงเดียวกัน: ตอบแค่ 1 ครั้ง', fetchCalls.length === 1)
}

// 8) คำนวณช่วงปิดปัจจุบัน (เวลาไทย)
{
  const shop = { open: '09:00', close: '18:00' }
  const bkk = (iso: string) => new Date(iso) // ใส่เวลา UTC ตรง ๆ
  const evening = bkk('2026-11-10T13:00:00Z') // 20:00 น. ไทย → ช่วงปิดเริ่ม 18:00 วันนี้
  const morning = bkk('2026-11-10T00:00:00Z') // 07:00 น. ไทย → ช่วงปิดเริ่ม 18:00 เมื่อวาน
  check('ช่วงปิดตอนเย็น: เริ่ม 18:00 น. ไทยของวันนี้', offWindowStartMs(evening, shop) === Date.parse('2026-11-10T11:00:00Z'))
  check('ช่วงปิดตอนเช้า: เริ่ม 18:00 น. ไทยของเมื่อวาน', offWindowStartMs(morning, shop) === Date.parse('2026-11-09T11:00:00Z'))
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILED`)
process.exit(fail ? 1 : 0)
