// ประชาสัมพันธ์/โปรโมชั่นถึงลูกค้าเว็บ/แอป (ฝั่งเซิร์ฟเวอร์)
// ส่งเป็นการ์ดในแชทเว็บของลูกค้าทีละคน (push เด้งตามระบบเดิม) · กันส่งซ้ำด้วยการจองคีย์ต่อ (แคมเปญ × ลูกค้า)
// ทำเป็นชุดภายในเวลาที่กำหนด ถ้าไม่จบจะทำต่อจากจุดเดิมในรอบถัดไป (cron) หรือกด "ส่งต่อ"
import { campaignCard, campaignMessageText, isCampaignEligible, validateCampaign } from './schedlib/campaigns.js'
import { appendWebMessage, webChatFor } from './webchat.ts'

// deno-lint-ignore no-explicit-any
type Any = any

export const CAMPAIGNS = 'campaigns'
export const CAMPAIGN_SENT = 'campaignSent'
export const CHUNK = 50 // ลูกค้าต่อการอ่านหนึ่งรอบ
export const STALE_MS = 3 * 60e3 // แคมเปญที่ไม่มีความคืบหน้าเกินนี้ถือว่าค้าง (ให้รอบอื่นทำต่อได้)
export const MIN_SCHEDULE_AHEAD_MS = 60e3

export type Stats = { targets: number; sent: number; failed: number; skipped: number }
export type Campaign = {
  id: string; type: string; title: string; body: string; image: string; url: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  scheduledAt: string | null; createdAt: string; createdBy: string; updatedAt: string
  startedAt: string | null; progressAt: string | null; sentAt: string | null; cursor: string; stats: Stats
}

const emptyStats = (): Stats => ({ targets: 0, sent: 0, failed: 0, skipped: 0 })
const rowOf = (row: Any): Campaign | null => (row?.data && typeof row.data === 'object' ? { ...row.data, id: String(row.id) } as Campaign : null)

export async function listCampaigns(sb: Any): Promise<Campaign[]> {
  const r = await sb.from('punpang_records').select('id,data').eq('collection', CAMPAIGNS).limit(500)
  if (r?.error) throw new Error(r.error.message)
  return ((r?.data || []) as Any[]).map(rowOf).filter((c): c is Campaign => !!c).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function getCampaign(sb: Any, id: string): Promise<Campaign | null> {
  const r = await sb.from('punpang_records').select('id,data').eq('collection', CAMPAIGNS).eq('id', id).maybeSingle()
  if (r?.error) return null
  return rowOf(r?.data)
}

// เปลี่ยนสถานะแบบมีเงื่อนไข: ทำได้เฉพาะตอนสถานะยังเป็นค่าเดิม (กันชนกับพนักงานและรอบอัตโนมัติ) · คืน null เมื่อชนกัน
export async function moveCampaign(sb: Any, cur: Campaign, from: string[], patch: Partial<Campaign>): Promise<Campaign | null> {
  if (!from.includes(cur.status)) return null
  const next: Campaign = { ...cur, ...patch }
  const { id, ...data } = next
  const up = await sb.from('punpang_records').update({ data }).eq('collection', CAMPAIGNS).eq('id', id).eq('data->>status', cur.status).select('id')
  if (up?.error || !(up?.data || []).length) return null
  return next
}

// ลูกค้าที่มีสิทธิ์รับ ตั้งแต่รหัสที่ระบุ (เรียงตามรหัส) · raw = แถวที่อ่านมาทั้งหมด (ใช้เลื่อนเคอร์เซอร์แม้ไม่มีสิทธิ์)
export async function recipientsAfter(sb: Any, after: string, limit: number): Promise<{ raw: Any[]; eligible: Any[] }> {
  const q = await sb.from('punpang_customers').select('id,name,data').eq('data->>promoOptIn', 'true').not('data->>promoConsentAt', 'is', null).gt('id', after).order('id').limit(limit)
  if (q?.error) throw new Error(q.error.message)
  const raw: Any[] = q?.data || []
  if (!raw.length) return { raw, eligible: [] }
  const acc = await sb.from('punpang_customer_auth').select('customer_id').in('customer_id', raw.map((r) => r.id))
  if (acc?.error) throw new Error(acc.error.message)
  const withAccount = new Set(((acc?.data || []) as Any[]).map((a) => String(a.customer_id)))
  const eligible = raw.filter((r) => isCampaignEligible({ ...(r.data || {}), id: r.id }, withAccount.has(String(r.id))))
  return { raw, eligible }
}

// จำนวนผู้รับในขณะนี้ (สำหรับหน้ายืนยันก่อนส่ง)
export async function audienceCount(sb: Any): Promise<number> {
  let after = ''
  let n = 0
  for (let i = 0; i < 200; i++) {
    const { raw, eligible } = await recipientsAfter(sb, after, 500)
    n += eligible.length
    if (raw.length < 500) break
    after = String(raw[raw.length - 1].id)
  }
  return n
}

function messageOf(c: Campaign, nowIso: string): Record<string, unknown> {
  const text = campaignMessageText(c)
  return {
    id: `cm${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, from: 'staff', kind: 'card', text, card: campaignCard(c), cardText: text,
    orderId: null, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, at: nowIso, by: 'ร้าน', delivery: 'sent', campaignId: c.id,
  }
}

// ส่งหนึ่งชุด · จองคีย์ก่อนส่งทุกราย (ส่งซ้ำไม่ได้) · คืนผลนับและเคอร์เซอร์ใหม่
export async function sendChunk(sb: Any, c: Campaign, nowIso: string): Promise<{ sent: number; failed: number; skipped: number; last: string | null; done: boolean }> {
  const { raw, eligible } = await recipientsAfter(sb, c.cursor || '', CHUNK)
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const r of eligible) {
    const claim = await sb.from('punpang_records').insert({ collection: CAMPAIGN_SENT, id: `${c.id}|${r.id}`, data: { at: nowIso } })
    if (claim?.error) { skipped++; continue } // จองไว้แล้ว = เคยส่งหรือกำลังส่งอยู่
    const chat = await webChatFor(sb, String(r.id), String(r.name || r.data?.name || ''), nowIso)
    if (!chat) { failed++; continue }
    if (await appendWebMessage(sb, chat.id, messageOf(c, nowIso))) sent++
    else failed++
  }
  return { sent, failed, skipped, last: raw.length ? String(raw[raw.length - 1].id) : null, done: raw.length < CHUNK }
}

// ทำต่อจนจบหรือหมดเวลาที่ให้ไว้ · เมื่อจบ → สถานะ sent · ระหว่างทาง → บันทึกความคืบหน้าทุกชุด
export async function runWithin(sb: Any, cur: Campaign, budgetMs: number, nowFn: () => number = Date.now): Promise<Campaign> {
  const start = nowFn()
  let c = cur
  for (;;) {
    const nowIso = new Date(nowFn()).toISOString()
    const step = await sendChunk(sb, c, nowIso)
    const stats = { targets: c.stats.targets, sent: c.stats.sent + step.sent, failed: c.stats.failed + step.failed, skipped: c.stats.skipped + step.skipped }
    const patch: Partial<Campaign> = step.done
      ? { status: 'sent', sentAt: nowIso, progressAt: nowIso, stats, cursor: step.last ?? c.cursor }
      : { progressAt: nowIso, stats, cursor: step.last ?? c.cursor }
    const next = await moveCampaign(sb, c, ['sending'], patch)
    if (!next) return c // ถูกเปลี่ยนสถานะจากที่อื่นระหว่างทาง → หยุด
    c = next
    if (step.done) return c
    if (nowFn() - start >= budgetMs) return c
  }
}

// สร้างหรือแก้ไขฉบับร่าง (แก้ได้เฉพาะฉบับร่าง)
export async function saveDraft(sb: Any, input: Any, by: string, nowIso: string): Promise<{ campaign: Campaign } | { error: string; status: number }> {
  const v: Any = validateCampaign(input) // โมดูล JS ที่ใช้ร่วมกับแอป จึงไม่ระบุชนิดตายตัว
  if (!v.ok) return { error: v.error, status: 400 }
  const id = input?.id ? String(input.id) : ''
  if (id) {
    const cur = await getCampaign(sb, id)
    if (!cur) return { error: 'ไม่พบแคมเปญ', status: 404 }
    const next = await moveCampaign(sb, cur, ['draft'], { type: v.value.type, title: v.value.title, body: v.value.body, image: v.value.image, url: v.value.url, updatedAt: nowIso })
    if (!next) return { error: 'แก้ไขได้เฉพาะฉบับร่าง', status: 409 }
    return { campaign: next }
  }
  const fresh: Campaign = { id: `cmp${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, type: v.value.type, title: v.value.title, body: v.value.body, image: v.value.image, url: v.value.url, status: 'draft', scheduledAt: null, createdAt: nowIso, createdBy: by, updatedAt: nowIso, startedAt: null, progressAt: null, sentAt: null, cursor: '', stats: emptyStats() }
  const { id: rid, ...data } = fresh
  const ins = await sb.from('punpang_records').insert({ collection: CAMPAIGNS, id: rid, data })
  if (ins?.error) return { error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่', status: 500 }
  return { campaign: fresh }
}

// ส่งเลย: ฉบับร่าง → กำลังส่ง (นับผู้รับ แล้วส่งภายในเวลาที่ให้)
export async function startNow(sb: Any, id: string, nowMs: number, budgetMs: number): Promise<{ campaign: Campaign } | { error: string; status: number }> {
  const cur = await getCampaign(sb, id)
  if (!cur) return { error: 'ไม่พบแคมเปญ', status: 404 }
  const nowIso = new Date(nowMs).toISOString()
  const targets = await audienceCount(sb)
  if (targets === 0) return { error: 'ไม่มีผู้รับที่เปิดรับข่าวสารและมีบัญชีเว็บ', status: 400 }
  const started = await moveCampaign(sb, cur, ['draft'], { status: 'sending', startedAt: nowIso, progressAt: nowIso, cursor: '', stats: { ...emptyStats(), targets } })
  if (!started) return { error: 'แคมเปญนี้ถูกส่งหรือแก้ไขไปแล้ว', status: 409 }
  return { campaign: await runWithin(sb, started, budgetMs) }
}

// ตั้งเวลาส่ง: ฉบับร่าง → ตั้งเวลา (รอบอัตโนมัติจะส่งเมื่อถึงเวลา)
export async function scheduleSend(sb: Any, id: string, scheduledAt: string, nowMs: number): Promise<{ campaign: Campaign } | { error: string; status: number }> {
  const at = Date.parse(scheduledAt)
  if (Number.isNaN(at) || at < nowMs + MIN_SCHEDULE_AHEAD_MS) return { error: 'เวลาส่งต้องอยู่ข้างหน้าอย่างน้อย 1 นาที', status: 400 }
  const cur = await getCampaign(sb, id)
  if (!cur) return { error: 'ไม่พบแคมเปญ', status: 404 }
  const targets = await audienceCount(sb)
  if (targets === 0) return { error: 'ไม่มีผู้รับที่เปิดรับข่าวสารและมีบัญชีเว็บ', status: 400 }
  const next = await moveCampaign(sb, cur, ['draft'], { status: 'scheduled', scheduledAt: new Date(at).toISOString(), updatedAt: new Date(nowMs).toISOString(), stats: { ...emptyStats(), targets } })
  if (!next) return { error: 'แคมเปญนี้ถูกส่งหรือแก้ไขไปแล้ว', status: 409 }
  return { campaign: next }
}

// ส่งต่อ: แคมเปญที่กำลังส่งแต่ค้างนานเกิน STALE_MS
export async function resumeCampaign(sb: Any, id: string, nowMs: number, budgetMs: number): Promise<{ campaign: Campaign } | { error: string; status: number }> {
  const cur = await getCampaign(sb, id)
  if (!cur) return { error: 'ไม่พบแคมเปญ', status: 404 }
  if (cur.status !== 'sending') return { error: 'แคมเปญนี้ไม่ได้อยู่ระหว่างส่ง', status: 409 }
  if (cur.progressAt && nowMs - Date.parse(cur.progressAt) < STALE_MS) return { error: 'กำลังส่งอยู่ ลองใหม่อีกครั้งในไม่กี่นาที', status: 409 }
  return { campaign: await runWithin(sb, cur, budgetMs) }
}

// ยกเลิกได้เฉพาะฉบับร่างหรือที่ตั้งเวลาไว้ (ยังไม่เริ่มส่ง)
export async function cancelCampaign(sb: Any, id: string, nowMs: number): Promise<{ campaign: Campaign } | { error: string; status: number }> {
  const cur = await getCampaign(sb, id)
  if (!cur) return { error: 'ไม่พบแคมเปญ', status: 404 }
  const next = await moveCampaign(sb, cur, ['draft', 'scheduled'], { status: 'cancelled', updatedAt: new Date(nowMs).toISOString() })
  if (!next) return { error: 'ยกเลิกได้เฉพาะตอนยังไม่เริ่มส่ง', status: 409 }
  return { campaign: next }
}

// รอบอัตโนมัติ (cron): ถึงเวลาแล้ว → เริ่มส่ง · กำลังส่งแต่ค้าง → ทำต่อ · ใช้เวลาไม่เกิน budgetMs
export async function dispatchDueCampaigns(sb: Any, nowMs: number, budgetMs: number): Promise<{ started: number; resumed: number; completed: number }> {
  const r = await sb.from('punpang_records').select('id,data').eq('collection', CAMPAIGNS).in('data->>status', ['scheduled', 'sending'])
  if (r?.error) throw new Error(r.error.message)
  const list = ((r?.data || []) as Any[]).map(rowOf).filter((c): c is Campaign => !!c)
  const t0 = Date.now() // งบเวลานับจากเวลาจริงตอนเริ่มงาน (nowMs ใช้เฉพาะเทียบเวลาที่ตั้งไว้)
  const left = () => budgetMs - (Date.now() - t0)
  let started = 0
  let resumed = 0
  let completed = 0
  for (const c of list) {
    if (left() <= 0) break
    const nowIso = new Date(nowMs).toISOString()
    if (c.status === 'scheduled' && c.scheduledAt && Date.parse(c.scheduledAt) <= nowMs) {
      const s = await moveCampaign(sb, c, ['scheduled'], { status: 'sending', startedAt: nowIso, progressAt: nowIso, cursor: '' })
      if (!s) continue
      started++
      const done = await runWithin(sb, s, left())
      if (done.status === 'sent') completed++
    } else if (c.status === 'sending' && (!c.progressAt || nowMs - Date.parse(c.progressAt) >= STALE_MS)) {
      resumed++
      const done = await runWithin(sb, c, left())
      if (done.status === 'sent') completed++
    }
  }
  return { started, resumed, completed }
}
