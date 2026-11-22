import { modeOf, refuseInTest } from '../_shared/mode.ts'
// Edge Function scheduled: ส่งเตือนตามเวลาแทนแอปพนักงาน (เรียกทุก 15 นาทีจาก pg_cron ด้วยคีย์ x-cron-key)
// ทำงานจริงเฉพาะเมื่อ punpang_kv (config/scheduled) มี {"server": true} · ค่าเริ่มต้น = แอปพนักงานยังทำเอง (ไม่มีการส่งซ้ำ)
// เนื้อหา: เตือนนัดรับ · เตือนชำระ · วันเกิด · คะแนนใกล้หมดอายุ (ลูกค้า) · ใกล้เวลาต้องเสร็จ · เกินกำหนดชำระ (ทีม) · ค่าใช้จ่ายประจำที่ยังไม่บันทึก · งวดผ่อนชำระใกล้/เลยกำหนด (ทีม)
// ยังไม่รวม: เตือน VAT และการบันทึกค่าใช้จ่ายประจำอัตโนมัติ (ต้องใช้ยอดขาย/เขียนบัญชี) และการลบคูปองหมดอายุ → ยังทำในแอปพนักงาน
import { createClient } from 'npm:@supabase/supabase-js@2'
import { planScheduled, todayBkk, prepareRules } from '../_shared/scheduled/plan.ts'
import { accountingPlans } from '../_shared/scheduled/accounting.ts'
import { runPlans, type Ctx } from '../_shared/scheduled/run.ts'
import { dispatchDueCampaigns } from '../_shared/campaign.ts'
import { lineRetentionDays, retentionCutoffIso } from '../_shared/linepush.ts'
import { SMS_GATEWAY_URL } from '../_shared/gwfetch.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// เทียบคีย์แบบคงที่เวลา (กันการเดาทีละตัวจากเวลาตอบ)
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// อ่านทั้งตาราง (PostgREST ตัดที่ 1,000 แถวต่อครั้ง ต้องแบ่งหน้า)
async function fetchAll(build: (from: number, to: number) => PromiseLike<Any>): Promise<Any[]> {
  const out: Any[] = []
  for (let from = 0; ; from += 1000) {
    const r = await build(from, from + 999)
    if (r.error) throw new Error(String(r.error.message || r.error))
    const rows: Any[] = r.data || []
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

// แผนเตือนบัญชี (อ่านอย่างเดียว): ค่าใช้จ่ายประจำที่ยังไม่บันทึก และงวดผ่อนชำระ · VAT และการบันทึกอัตโนมัติยังอยู่ในแอป
async function acctPlansOf(sb: Any, nowMs: number, installmentDays: number): Promise<Any[]> {
  const kv = await sb.from('punpang_kv').select('id,data').eq('collection', 'acct').in('id', ['recurring', 'recurringSkips', 'installments', 'vatFilings'])
  if (kv.error) throw new Error(kv.error.message)
  const acct: Record<string, Any> = {}
  for (const r of kv.data || []) acct[r.id] = r.data?.v
  const st = await sb.from('punpang_acct_state').select('closed_through').eq('id', 1).maybeSingle()
  if (st.error) throw new Error(st.error.message)
  const entries = await fetchAll((x, y) => sb.from('punpang_acct_entries').select('id,data').not('data->source', 'is', null).order('id').range(x, y))
  return accountingPlans({
    todayStr: todayBkk(nowMs),
    closedThrough: String(st.data?.closed_through || ''),
    installmentDays,
    recurring: acct.recurring || [],
    recurringSkips: acct.recurringSkips || [],
    installments: acct.installments || [],
    vatFilings: acct.vatFilings || {},
    postedRecurring: entries.map((r) => r.data || {}),
  })
}

Deno.serve(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused // โหมดทดสอบไม่ทำงานฟังก์ชันนี้ (ข้อมูลลูกค้า/งานตามเวลา/เว็บฮุกเป็นของจริงเท่านั้น)
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const key = (Deno.env.get('SCHEDULED_KEY') || '').trim()
  if (!key || !sameKey(key, req.headers.get('x-cron-key') || '')) return json({ error: 'forbidden' }, 403)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const nowMs = Date.now()
  try {
    // ประชาสัมพันธ์/โปรโมชั่นที่ตั้งเวลาไว้: ทำทุกรอบ (ไม่ขึ้นกับโหมดแอป/เซิร์ฟเวอร์ของร้าน) ใช้เวลาไม่เกิน 60 วินาที · ล้มเหลวไม่กระทบการแจ้งเตือนอื่น
    let campaigns: unknown = null
    try { campaigns = await dispatchDueCampaigns(sb, nowMs, 60_000) } catch (e) { campaigns = { error: String((e as Error)?.message || e).slice(0, 200) } }
    const kv = await sb.from('punpang_kv').select('id,data').eq('collection', 'config').in('id', ['shop', 'notifyRules', 'integrations', 'scheduled'])
    if (kv.error) throw new Error(kv.error.message)
    const cfg: Record<string, Any> = {}
    for (const r of kv.data || []) cfg[r.id] = r.data?.v
    // เก็บข้อความ LINE ตามระยะที่ร้านตั้ง (ค่าเริ่มต้น 180 วัน) · ทำทุกรอบ ไม่ขึ้นกับโหมดแอป · ล้มเหลวไม่กระทบงานอื่น (รอบถัดไปลบอีก)
    await sb.from('punpang_line_messages').delete().lt('created_at', retentionCutoffIso(lineRetentionDays(cfg.shop?.lineRetentionDays), nowMs))
    if (cfg.scheduled?.server !== true) return json({ ok: true, skipped: 'app-mode', campaigns })

    const orderCols = 'id,code,customer_id,status,fulfillment,channel,pickup_at,data'
    const active = await fetchAll((x, y) => sb.from('punpang_orders').select(orderCols).not('status', 'in', '(draft,delivered,cancelled)').order('id').range(x, y))
    const withBirthday = await fetchAll((x, y) => sb.from('punpang_orders').select(orderCols).neq('status', 'cancelled').not('data->birthday', 'is', null).order('id').range(x, y))
    const byId = new Map<string, Any>()
    for (const r of [...active, ...withBirthday]) byId.set(r.id, r)
    const orders = [...byId.values()].map((r) => ({ ...(r.data || {}), id: r.id, code: r.code, customerId: r.customer_id || '', status: r.status, fulfillment: r.fulfillment, ...(r.channel ? { channel: r.channel } : {}) }))

    const custRows = await fetchAll((x, y) => sb.from('punpang_customers').select('id,name,phone,note,data').order('id').range(x, y))
    const customers = custRows.map((r) => ({ ...(r.data || {}), id: r.id, name: r.name, phone: r.phone || '', note: r.note || '' }))

    const sentRows = await fetchAll((x, y) => sb.from('punpang_records').select('id').eq('collection', 'notifySent').order('id').range(x, y))
    const sent = new Set<string>(sentRows.map((r) => String(r.id)))

    const chats = await fetchAll((x, y) => sb.from('punpang_chats').select('id,channel,external_id,customer_id,data').in('channel', ['facebook']).order('id').range(x, y))
    const pg = await sb.from('punpang_fb_pages').select('token').limit(1).maybeSingle()

    const gwKey = (Deno.env.get('SMS_API_KEY') || '').trim()
    const tgToken = (Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim()
    const tgChat = (Deno.env.get('TELEGRAM_CHAT_ID') || '').trim()

    const planned = planScheduled({ nowMs, shop: cfg.shop || {}, rules: prepareRules(cfg.notifyRules || []), orders, customers, sent })
    // ถ้าอ่านข้อมูลบัญชีไม่ได้ ให้เตือนส่วนอื่นต่อไปตามปกติ (รอบถัดไปจะเตือนรายการที่ยังค้างอยู่เอง)
    let acctPlans: Any[] = []
    let acctError = ''
    try {
      acctPlans = await acctPlansOf(sb, nowMs, Number(cfg.shop?.installmentAlertDays ?? 1))
    } catch (e) {
      acctError = String((e as Error)?.message || e).slice(0, 200)
    }
    const plans = [...planned, ...acctPlans]
    const ctx: Ctx = {
      sb,
      nowMs,
      rules: prepareRules(cfg.notifyRules || []),
      integrations: cfg.integrations || {},
      chats,
      fb: pg.data?.token ? { token: String(pg.data.token), version: (Deno.env.get('FB_GRAPH_VERSION') || 'v24.0').trim() } : null,
      gw: gwKey ? { url: SMS_GATEWAY_URL, key: gwKey } : null,
      tg: /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(tgToken) && /^(-?\d{5,20}|@[A-Za-z0-9_]{4,64})$/.test(tgChat) ? { token: tgToken, chat: tgChat } : null,
      siteUrl: (Deno.env.get('SITE_URL') || 'https://cake-order-admin.pages.dev').trim().replace(/\/+$/, ''),
    }
    const res = await runPlans(ctx, plans)
    return json({ ok: true, planned: plans.length, done: res.done, skipped: res.skipped, errors: res.errors.slice(0, 20), acctError, campaigns })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})
