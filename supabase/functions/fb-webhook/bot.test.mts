import { runFbBot, offWindowStartMs, scrubPII } from './bot.ts'
import { normalizeMessages } from '../_shared/ai.ts'

// ---- ฐานข้อมูลจำลองแบบ CAS (updated_at) ----
type Row = { id: string; data: any; updated_at: string }
function makeSb(tables: { chats: Row[]; kv: any[]; records: any[] }) {
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
const aiOn = (extra: any = {}) => ({ id: 'bot', collection: 'config', data: { v: { ...botCfg.data.v, ai: { enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', mode: 'auto', dailyLimit: 5, maxTokens: 400, ...extra } } } })
function mkAi(text: string, mid: string, botVal: any = aiOn(), messages?: any[], extraChat: any = {}) {
  const chats = [chatWith(messages ?? [inbound(mid, text)], extraChat)]
  const records: any[] = []
  const sb = makeSb({ chats, kv: [shopAlways, botVal, sfRow], records })
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

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILED`)
process.exit(fail ? 1 : 0)
