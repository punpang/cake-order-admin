import { runFbBot, offWindowStartMs, scrubPII, decide, learnedMatch } from './bot.ts'
import { normalizeMessages } from '../_shared/ai.ts'

// ---- ฐานข้อมูลจำลองแบบ CAS (updated_at) ----
type Row = { id: string; data: any; updated_at: string }
function makeSb(tables: { chats: Row[]; kv: any[]; records: any[]; items?: any[]; orders?: any[] }) {
  let ver = 0
  const bump = () => new Date(Date.now() + ++ver).toISOString()
  const counts: Record<string, number> = {} // ตัวนับ punpang_ai_take ต่อวัน (จำลองฟังก์ชันอะตอมิก)
  return {
    records: tables.records,
    chats: tables.chats,
    rpc(name: string, args: any) {
      if (name !== 'punpang_ai_take') return Promise.resolve({ data: null, error: { message: 'unknown rpc' } })
      const n = counts[args.p_day] || 0
      if (n < args.p_limit) { counts[args.p_day] = n + 1; return Promise.resolve({ data: true, error: null }) }
      return Promise.resolve({ data: false, error: null })
    },
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
        order() { return q },
        maybeSingle() { single = true; return q },
        update(p: any) { mode = 'update'; payload = p; return q },
        insert(p: any) { mode = 'insert'; payload = p; return q },
        then(res: any, rej: any) {
          const run = async () => {
            if (table === 'punpang_items') return { data: tables.items ?? [], error: null }
            if (table === 'punpang_orders') {
              const rows = (tables.orders ?? []).filter((r) => (f.code === undefined || r.code === f.code) && (f.customer_id === undefined || r.customer_id === f.customer_id))
              return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
            }
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

let fetchCalls: any[] = [] // ข้อความที่ส่งผ่าน Graph (ถึงลูกค้า)
let aiCalls: any[] = [] // คำขอไปยัง Claude API
let aiReply = 'ร้านมีบริการจัดส่งในพื้นที่ค่ะ'
let aiThrow = false
let onDelay: (() => void) | null = null
globalThis.fetch = (async (url: any, opts: any) => {
  if (String(url).includes('api.anthropic.com')) {
    aiCalls.push({ headers: opts.headers, body: JSON.parse(opts.body) })
    if (aiThrow) throw new Error('network')
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: aiReply }] }) }
  }
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

// ---- บอท AI ----
// ร้านเปิดตลอดวัน (ไม่ขึ้นกับเวลาที่รันเทส) → ข้อความที่กฎเดิมตอบไม่ได้จะตกมาเป็น "ไม่แน่ใจ"
const shopAlways = { id: 'shop', collection: 'config', data: { v: { name: 'ร้านทดสอบ', open: '00:00', close: '23:59', closures: {} } } }
const optRow = { id: 'optionGroups', collection: 'shop_public', data: { v: [{ key: 'type', options: [{ name: 'ชีฟฟ่อน' }] }, { key: 'flavor', options: [{ name: 'ช็อกโกแลต' }] }] } }
const retailRow = { id: 'rt1', kind: 'retail', name: 'ชาเขียวเค้กโรล', price: 99, active: true, data: { showOnStore: true, stock: 5, description: 'หอมชาเขียว' } }
const aiOn = (extra: any = {}) => ({ id: 'bot', collection: 'config', data: { v: { ...botCfg.data.v, ai: { enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', mode: 'auto', dailyLimit: 5, maxTokens: 400, ...extra } } } })
function mkAi(text: string, mid: string, botVal: any = aiOn(), messages?: any[], extraChat: any = {}) {
  const chats = [chatWith(messages ?? [inbound(mid, text)], extraChat)]
  const records: any[] = []
  const sb = makeSb({ chats, kv: [shopAlways, botVal, sfRow, optRow], records, items: [retailRow] })
  return { sb, chats, records }
}
const resetAi = () => { fetchCalls = []; aiCalls = []; aiThrow = false; aiReply = 'ร้านมีบริการจัดส่งในพื้นที่ค่ะ'; onDelay = null }
const aiLogs = (records: any[]) => records.filter((r) => r.collection === 'aiLog').map((r) => r.data.status)

// 9) AI ปิด (ค่าเริ่มต้น) → ไม่เรียก AI · พฤติกรรมส่งต่อเดิม
{
  resetAi()
  const { sb, chats } = mkAi('มีบริการจัดส่งไหมคะ', 'a1', aiOn({ enabled: false }))
  await runFbBot({ ...base, sb, mid: 'a1', text: 'มีบริการจัดส่งไหมคะ', aiKey: 'key-x' })
  check('AI ปิด: ไม่เรียก AI', aiCalls.length === 0)
  check('AI ปิด: ส่งต่อพนักงานเหมือนเดิม', chats[0].data.botHandoff === true && fetchCalls.length === 0)
}

// 10) AI เปิด + ไม่แน่ใจ + โหมดส่งเอง → เรียก AI 1 ครั้ง · ส่งผ่าน Graph และบันทึกลงแชท
{
  resetAi()
  const { sb, chats, records } = mkAi('มีบริการจัดส่งไหมคะ', 'a2')
  await runFbBot({ ...base, sb, mid: 'a2', text: 'มีบริการจัดส่งไหมคะ', aiKey: 'key-x' })
  check('AI ไม่แน่ใจ: เรียก Claude 1 ครั้ง', aiCalls.length === 1)
  check('AI: ใช้คีย์ใน header เท่านั้น (ไม่อยู่ในเนื้อหา)', aiCalls[0]?.headers['x-api-key'] === 'key-x' && !JSON.stringify(aiCalls[0].body).includes('key-x'))
  check('AI: ส่งคำตอบถึงลูกค้า 1 ครั้ง', fetchCalls.length === 1 && fetchCalls[0].message.text === aiReply)
  check('AI: บันทึกข้อความบอท source=ai', chats[0].data.messages.some((x: any) => x.by === 'บอท' && x.botSource === 'ai' && x.delivery === 'sent'))
  check('AI: บันทึก log ผลลัพธ์ ok', aiLogs(records).join() === 'ok')
  check('AI: system prompt มีเวลาทำการ แต่ไม่มีข้อมูลออร์เดอร์', aiCalls[0]?.body.system.includes('เวลาทำการ') && !aiCalls[0].body.system.includes('OR-'))
}

// 11) เรื่องเงิน / เลขออร์เดอร์ → ไม่เรียก AI เด็ดขาด
{
  resetAi()
  const a = mkAi('ขอคืนเงินหน่อย', 'a3'); await runFbBot({ ...base, sb: a.sb, mid: 'a3', text: 'ขอคืนเงินหน่อย', aiKey: 'key-x' })
  const b = mkAi('เช็คออร์เดอร์ OR-000123-000001', 'a4'); await runFbBot({ ...base, sb: b.sb, mid: 'a4', text: 'เช็คออร์เดอร์ OR-000123-000001', aiKey: 'key-x' })
  check('เรื่องเงิน/ออร์เดอร์: ไม่เรียก AI', aiCalls.length === 0)
  check('เรื่องเงิน/ออร์เดอร์: ยังส่งต่อพนักงาน', a.chats[0].data.botHandoff === true && b.chats[0].data.botHandoff === true)
}

// 12) AI ตอบ [HANDOFF] → ส่งต่อพนักงาน ไม่ส่งข้อความถึงลูกค้า · log เป็น handoff
{
  resetAi(); aiReply = '[HANDOFF]'
  const { sb, chats, records } = mkAi('ทำเค้กแต่งงาน 3 ชั้นได้ไหม', 'a5')
  await runFbBot({ ...base, sb, mid: 'a5', text: 'ทำเค้กแต่งงาน 3 ชั้นได้ไหม', aiKey: 'key-x' })
  check('[HANDOFF]: เรียก AI แล้วไม่ส่งถึงลูกค้า', aiCalls.length === 1 && fetchCalls.length === 0)
  check('[HANDOFF]: ธงส่งต่อ + log handoff', chats[0].data.botHandoff === true && aiLogs(records).join() === 'handoff')
}

// 13) เกินเพดานต่อวัน → ไม่เรียก AI และ log เป็น limit
{
  resetAi()
  const { sb, chats, records } = mkAi('มีบริการจัดส่งไหมคะ', 'a6', aiOn({ dailyLimit: 0 }))
  await runFbBot({ ...base, sb, mid: 'a6', text: 'มีบริการจัดส่งไหมคะ', aiKey: 'key-x' })
  check('เพดานเป็น 0: ไม่เรียก AI', aiCalls.length === 0)
  check('เพดานเป็น 0: ส่งต่อ + log limit', chats[0].data.botHandoff === true && aiLogs(records).join() === 'limit')
}

// 14) ไม่มีคีย์ AI → ไม่เรียก และส่งต่อพนักงาน
{
  resetAi()
  const { sb, chats } = mkAi('มีบริการจัดส่งไหมคะ', 'a7')
  await runFbBot({ ...base, sb, mid: 'a7', text: 'มีบริการจัดส่งไหมคะ' })
  check('ไม่มีคีย์: ไม่เรียก AI', aiCalls.length === 0)
  check('ไม่มีคีย์: ส่งต่อพนักงาน', chats[0].data.botHandoff === true)
}

// 15) โหมดแนะนำ (suggest) → ไม่ส่งเอง · เก็บเป็นร่างในแชท (botDraft) ให้พนักงานกดส่ง
{
  resetAi()
  const { sb, chats } = mkAi('มีบริการจัดส่งไหมคะ', 'a8', aiOn({ mode: 'suggest' }))
  await runFbBot({ ...base, sb, mid: 'a8', text: 'มีบริการจัดส่งไหมคะ', aiKey: 'key-x' })
  const dr = chats[0].data.botDraft
  check('โหมดร่าง: ไม่ส่งถึงลูกค้าเอง', fetchCalls.length === 0 && aiCalls.length === 1)
  check('โหมดร่าง: เก็บร่างคำตอบ source=ai และผูกกับข้อความ', dr?.text === aiReply && dr?.source === 'ai' && dr?.aiFor === 'a8' && chats[0].data.botHandoff === false)
  // Meta ส่งซ้ำ → ไม่เรียก AI ซ้ำ (ไม่เสียเงินซ้ำ)
  await runFbBot({ ...base, sb, mid: 'a8', text: 'มีบริการจัดส่งไหมคะ', aiKey: 'key-x' })
  check('โหมดร่าง: ข้อความซ้ำไม่เรียก AI ซ้ำ', aiCalls.length === 1)
}

// 16) AI ล้มเหลว (เครือข่าย) → ส่งต่อพนักงาน และ log เป็น error
{
  resetAi(); aiThrow = true
  const { sb, chats, records } = mkAi('มีบริการจัดส่งไหมคะ', 'a9')
  await runFbBot({ ...base, sb, mid: 'a9', text: 'มีบริการจัดส่งไหมคะ', aiKey: 'key-x' })
  check('AI ล้มเหลว: ส่งต่อพนักงาน ไม่ส่งถึงลูกค้า', chats[0].data.botHandoff === true && fetchCalls.length === 0 && aiLogs(records).join() === 'error')
}

// 17) ตัดข้อมูลส่วนบุคคลก่อนส่ง
{
  const s = scrubPII('โทร 0812345678 อีเมล a.b@mail.com ออร์เดอร์ OR-000123-000001 ชื่อ สมชาย', ['สมชาย'])
  check('ตัด PII: เบอร์/อีเมล/ออร์เดอร์/ชื่อ', s.includes('{เบอร์}') && s.includes('{อีเมล}') && s.includes('{เลขออร์เดอร์}') && s.includes('{ชื่อ}') && !s.includes('0812345678') && !s.includes('สมชาย'))
}

// 17ข) ส่งให้ AI เฉพาะข้อความปัจจุบัน · ไม่มีประวัติแชท/ชื่อลูกค้า · มีราคาสินค้าจากฐานข้อมูล
{
  resetAi()
  const prior = [inbound('p0', 'สวัสดีค่ะ'), { id: 'st1', from: 'staff', kind: 'text', text: 'ยินดีค่ะ', by: 'พนักงาน' }, inbound('a10', 'ชาเขียวเค้กโรลราคาเท่าไหร่')]
  const { sb } = mkAi('ชาเขียวเค้กโรลราคาเท่าไหร่', 'a10', aiOn({ mode: 'suggest' }), prior)
  await runFbBot({ ...base, sb, mid: 'a10', text: 'ชาเขียวเค้กโรลราคาเท่าไหร่', aiKey: 'key-x' })
  const body = aiCalls[0]?.body
  check('AI: ส่งเฉพาะข้อความปัจจุบัน (ไม่มีประวัติ/ข้อความพนักงาน)', body?.messages?.length === 1 && body.messages[0].role === 'user' && body.messages[0].content === 'ชาเขียวเค้กโรลราคาเท่าไหร่')
  check('AI: system มีราคาสินค้าจากฐานข้อมูล', body?.system.includes('ชาเขียวเค้กโรล 99 บาท') && body.system.includes('ชีฟฟ่อน'))
}

// 17ค) ข้อความที่มีข้อมูลส่วนตัว → ไม่เรียก AI เลย และส่งต่อพนักงาน
{
  resetAi()
  const a = mkAi('ช่วยโทร 0812345678 กลับหน่อย', 'a11'); await runFbBot({ ...base, sb: a.sb, mid: 'a11', text: 'ช่วยโทร 0812345678 กลับหน่อย', aiKey: 'key-x' })
  const b = mkAi('ฉันคือลูกค้าทดสอบ มีบริการจัดส่งไหม', 'a12'); await runFbBot({ ...base, sb: b.sb, mid: 'a12', text: 'ฉันคือลูกค้าทดสอบ มีบริการจัดส่งไหม', aiKey: 'key-x' })
  check('มีเบอร์/ชื่อลูกค้า: ไม่เรียก AI', aiCalls.length === 0)
  check('มีเบอร์/ชื่อลูกค้า: ส่งต่อพนักงาน', a.chats[0].data.botHandoff === true && b.chats[0].data.botHandoff === true)
}

// 17ง) สถานะออร์เดอร์: ตอบจากกฎ ไม่เรียก AI · เฉพาะแชทที่ผูกลูกค้าและออร์เดอร์เป็นของลูกค้าคนนั้น
{
  const orders = [
    { code: 'OR-260101-000001', customer_id: 'cu1', status: 'preparing', fulfillment: 'pickup', pickup_at: '2026-11-12T03:00:00Z', balance: 150 },
    { code: 'OR-260101-000002', customer_id: 'cu2', status: 'shipping', fulfillment: 'delivery', pickup_at: '2026-11-12T05:00:00Z', balance: 0 },
  ]
  const mkOrd = (text: string, mid: string, customerId: string | null) => {
    const chats = [{ ...chatWith([inbound(mid, text)]), customer_id: customerId }]
    const records: any[] = []
    return { sb: makeSb({ chats, kv: [shopAlways, botCfg, sfRow], records, orders }), chats }
  }
  // ออร์เดอร์ของตัวเอง (ผูกแชทแล้ว) → ตอบสถานะ นัดรับ ยอดคงค้าง ไม่เรียก AI
  resetAi()
  const a = mkOrd('เช็คออร์เดอร์ OR-260101-000001 หน่อยค่ะ', 'o1', 'cu1')
  await runFbBot({ ...base, sb: a.sb, mid: 'o1', text: 'เช็คออร์เดอร์ OR-260101-000001 หน่อยค่ะ', aiKey: 'key-x' })
  const sent = fetchCalls[0]?.message?.text || ''
  check('สถานะออร์เดอร์: ตอบของตัวเองด้วยสถานะ', fetchCalls.length === 1 && sent.includes('OR-260101-000001') && sent.includes('สถานะ: กำลังเตรียม'))
  check('สถานะออร์เดอร์: มีวันนัดรับและยอดคงค้าง', sent.includes('นัดรับ') && sent.includes('ยอดคงค้าง 150.00 ฿'))
  check('สถานะออร์เดอร์: ไม่ส่งข้อมูลให้ AI', aiCalls.length === 0)

  // ออร์เดอร์ของคนอื่น → ไม่เปิดเผย ส่งต่อพนักงาน
  resetAi()
  const b = mkOrd('เช็คออร์เดอร์ OR-260101-000002', 'o2', 'cu1')
  await runFbBot({ ...base, sb: b.sb, mid: 'o2', text: 'เช็คออร์เดอร์ OR-260101-000002', aiKey: 'key-x' })
  check('ออร์เดอร์คนอื่น: ไม่ตอบสถานะ และส่งต่อพนักงาน', fetchCalls.length === 0 && b.chats[0].data.botHandoff === true)

  // แชทยังไม่ผูกลูกค้า → ไม่ตอบสถานะ
  resetAi()
  const c = mkOrd('เช็คออร์เดอร์ OR-260101-000001', 'o3', null)
  await runFbBot({ ...base, sb: c.sb, mid: 'o3', text: 'เช็คออร์เดอร์ OR-260101-000001', aiKey: 'key-x' })
  check('แชทไม่ผูกลูกค้า: ไม่ตอบสถานะ', fetchCalls.length === 0 && c.chats[0].data.botHandoff === true)

  // ถามสถานะโดยไม่มีเลขออร์เดอร์ → ตอบออร์เดอร์ที่ผูกกับแชท
  resetAi()
  const d = mkOrd('ออร์เดอร์ของฉันถึงไหนแล้วคะ', 'o4', 'cu1')
  await runFbBot({ ...base, sb: d.sb, mid: 'o4', text: 'ออร์เดอร์ของฉันถึงไหนแล้วคะ', aiKey: 'key-x' })
  check('ถามสถานะไม่มีเลข: ตอบออร์เดอร์ของลูกค้าคนนี้', fetchCalls.length === 1 && fetchCalls[0].message.text.includes('OR-260101-000001') && !fetchCalls[0].message.text.includes('OR-260101-000002'))

  // เรื่องเงินที่พูดถึงออร์เดอร์ → ไม่ตอบจากกฎสถานะ ส่งต่อพนักงาน
  resetAi()
  const e = mkOrd('ขอคืนเงินออร์เดอร์ OR-260101-000001', 'o5', 'cu1')
  await runFbBot({ ...base, sb: e.sb, mid: 'o5', text: 'ขอคืนเงินออร์เดอร์ OR-260101-000001', aiKey: 'key-x' })
  check('เรื่องเงิน+ออร์เดอร์: ส่งต่อพนักงาน ไม่ตอบสถานะ', fetchCalls.length === 0 && e.chats[0].data.botHandoff === true)
}

// 18) จัดลำดับข้อความให้ตรงกติกาของ Messages API (เริ่มด้วย user · สลับ role)
{
  const n = normalizeMessages([
    { role: 'assistant', content: 'สวัสดี' },
    { role: 'user', content: 'ราคา' },
    { role: 'user', content: 'เท่าไหร่' },
    { role: 'assistant', content: 'ตอบ' },
  ])
  check('normalize: ตัด assistant นำหน้า และรวม user ติดกัน', n.length === 2 && n[0].role === 'user' && n[0].content.includes('เท่าไหร่') && n[1].role === 'assistant')
}

// 19) คำตอบที่พนักงานเคยตอบ (learned): จับคู่ · ข้ามข้อมูลส่วนตัว/ตัวแปร/เรื่องเงิน · ไม่ซ้ำข้อความล่าสุด
{
  const at = new Date('2026-11-11T03:00:00Z') // 10:00 น. เวลาไทย (ช่วงเปิดร้าน)
  const shop = { open: '09:00', close: '18:00', closures: {} }
  const L = (rows: any[]) => ({ learned: rows, offHours: { enabled: true } })
  const good = L([{ id: 'bl1', q: 'ร้านอยู่ตรงไหนคะ', a: 'ร้านอยู่ซอยลาดพร้าว 5 ค่ะ' }])
  const d1 = decide('ร้านอยู่ตรงไหนคะ', good, shop, { faq: [] }, at)
  check('learned: คำถามคล้ายที่เคยเรียน → ใช้คำตอบนั้น (source=learned)', d1.source === 'learned' && d1.reply === 'ร้านอยู่ซอยลาดพร้าว 5 ค่ะ' && d1.learnedId === 'bl1')
  const d2 = decide('โทร 0812345678 ร้านอยู่ตรงไหนคะ', good, shop, { faq: [] }, at)
  check('learned: ข้อความมีเบอร์ → ไม่ใช้คู่ที่เรียน', d2.source !== 'learned' && learnedMatch('โทร 0812345678 ร้านอยู่ตรงไหนคะ', good) === null)
  const ph = L([{ id: 'bl2', q: 'ติดต่อยังไงคะ', a: 'โทร {เบอร์} ค่ะ' }])
  check('learned: คำตอบมีตัวแทนข้อมูล {…} → ข้าม', learnedMatch('ติดต่อยังไงคะ', ph) === null)
  const money = L([{ id: 'bl3', q: 'คืนเงินได้ไหมคะ', a: 'คืนเงินได้ค่ะ' }])
  check('learned: คำตอบเรื่องเงิน → ข้าม (ส่งต่อพนักงานตามเดิม)', decide('คืนเงินได้ไหมคะ', money, shop, { faq: [] }, at).source === 'handoff')
  check('learned: ไม่ซ้ำกับข้อความบอทล่าสุด', decide('ร้านอยู่ตรงไหนคะ', good, shop, { faq: [] }, at, 'ร้านอยู่ซอยลาดพร้าว 5 ค่ะ').source !== 'learned')
  check('learned: ไม่มีคู่ที่คล้าย → ไม่ใช้', learnedMatch('ทำเค้กรูปการ์ตูนได้ไหม', good) === null)
}

// 19ข) แชทจริง: คู่ที่เรียนในโหมดค่าเริ่มต้น → เก็บเป็นร่างให้พนักงานกดส่ง (ไม่ส่งเอง)
{
  fetchCalls = []; onDelay = null
  const rows = [{ id: 'bl1', q: 'ร้านอยู่ตรงไหนคะ', a: 'ร้านอยู่ซอยลาดพร้าว 5 ค่ะ' }]
  const kv = [shopCfg, { id: 'bot', collection: 'config', data: { v: { enabled: true, mode: 'auto', channels: { facebook: true }, rules: [], offHours: { enabled: true }, learned: rows } } }, sfRow]
  const chats = [chatWith([inbound('L1', 'ร้านอยู่ตรงไหนคะ')])]
  const sb = makeSb({ chats, kv, records: [] })
  await runFbBot({ ...base, sb, mid: 'L1', text: 'ร้านอยู่ตรงไหนคะ' })
  check('learned แชทจริง (ค่าเริ่มต้น): ไม่ส่งเอง · เก็บร่าง source=learned', fetchCalls.length === 0 && chats[0].data.botDraft?.source === 'learned' && chats[0].data.botDraft?.text === 'ร้านอยู่ซอยลาดพร้าว 5 ค่ะ')
}

// 19ค) แชทจริง: ตั้งโหมด learned เป็นอัตโนมัติ → ส่งผ่าน Graph
{
  fetchCalls = []; onDelay = null
  const rows = [{ id: 'bl1', q: 'ร้านอยู่ตรงไหนคะ', a: 'ร้านอยู่ซอยลาดพร้าว 5 ค่ะ' }]
  const kv = [shopCfg, { id: 'bot', collection: 'config', data: { v: { enabled: true, mode: 'suggest', channels: { facebook: true }, sourceModes: { learned: 'auto' }, rules: [], offHours: { enabled: true }, learned: rows } } }, sfRow]
  const chats = [chatWith([inbound('L2', 'ร้านอยู่ตรงไหนคะ')])]
  const sb = makeSb({ chats, kv, records: [] })
  await runFbBot({ ...base, sb, mid: 'L2', text: 'ร้านอยู่ตรงไหนคะ' })
  check('learned แชทจริง (ตั้ง auto): ส่งผ่าน Graph 1 ครั้ง', fetchCalls.length === 1)
}

// 13) Instagram: ช่องทางปิดอยู่ → บอทไม่ตอบ / เปิดแล้ว → ตอบ 1 ครั้ง
{
  const igOff = { ...botCfg, data: { v: { ...botCfg.data.v, channels: { facebook: true, instagram: false } } } }
  fetchCalls = []; onDelay = null
  const chats = [chatWith([inbound('I1', 'เปิดกี่โมงคะ')])]
  const sb = makeSb({ chats, kv: [shopCfg, igOff, sfRow], records: [] })
  await runFbBot({ ...base, sb, mid: 'I1', text: 'เปิดกี่โมงคะ', channel: 'instagram' })
  check('IG ปิดช่องทาง: ไม่ตอบ', fetchCalls.length === 0)
}
{
  const igOn = { ...botCfg, data: { v: { ...botCfg.data.v, channels: { facebook: true, instagram: true } } } }
  fetchCalls = []; onDelay = null
  const chats = [chatWith([inbound('I2', 'เปิดกี่โมงคะ')])]
  const sb = makeSb({ chats, kv: [shopCfg, igOn, sfRow], records: [] })
  await runFbBot({ ...base, sb, mid: 'I2', text: 'เปิดกี่โมงคะ', channel: 'instagram' })
  check('IG เปิดช่องทาง: ตอบ 1 ครั้ง', fetchCalls.length === 1)
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILED`)
process.exit(fail ? 1 : 0)
