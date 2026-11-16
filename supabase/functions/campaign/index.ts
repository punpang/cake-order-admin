import { corsWrap } from '../_shared/cors.ts'
import { serviceDb } from '../_shared/db.ts'
import { audienceCount, cancelCampaign, listCampaigns, resumeCampaign, saveDraft, scheduleSend, startNow } from '../_shared/campaign.ts'

// ประชาสัมพันธ์/โปรโมชั่นถึงลูกค้าเว็บ/แอป · เฉพาะผู้ดูแลระบบ (สิทธิ์ manage)
// การกระทำ: list · audience · save · send_now · schedule · resume · cancel
const CORS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
// งบเวลาต่อการเรียกหนึ่งครั้ง · ส่วนที่เหลือทำต่อในรอบอัตโนมัติ หรือกด "ส่งต่อ"
const BUDGET_MS = 40_000

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const sb = serviceDb(req) // สคีมาตามโหมดของคำขอ (ทดสอบ/จริง)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active,perms').eq('user_id', uid).maybeSingle()
  if (!st.data?.active || !(Array.isArray(st.data.perms) && st.data.perms.includes('manage'))) return json({ error: 'เฉพาะผู้ดูแลระบบ (admin) เท่านั้น' }, 403)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const action = String(body.action ?? '')
  const id = String(body.id ?? '')
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  try {
    if (action === 'list') return json({ items: await listCampaigns(sb), audience: await audienceCount(sb) })
    if (action === 'audience') return json({ count: await audienceCount(sb) })
    if (action === 'save') {
      const r = await saveDraft(sb, body.campaign ?? {}, uid, nowIso)
      return 'error' in r ? json({ error: r.error }, r.status) : json({ campaign: r.campaign })
    }
    if (action === 'send_now') {
      const r = await startNow(sb, id, nowMs, BUDGET_MS)
      return 'error' in r ? json({ error: r.error }, r.status) : json({ campaign: r.campaign })
    }
    if (action === 'schedule') {
      const r = await scheduleSend(sb, id, String(body.scheduledAt ?? ''), nowMs)
      return 'error' in r ? json({ error: r.error }, r.status) : json({ campaign: r.campaign })
    }
    if (action === 'resume') {
      const r = await resumeCampaign(sb, id, nowMs, BUDGET_MS)
      return 'error' in r ? json({ error: r.error }, r.status) : json({ campaign: r.campaign })
    }
    if (action === 'cancel') {
      const r = await cancelCampaign(sb, id, nowMs)
      return 'error' in r ? json({ error: r.error }, r.status) : json({ campaign: r.campaign })
    }
    return json({ error: 'ไม่รู้จักคำสั่งนี้' }, 400)
  } catch (e) {
    console.error('campaign', String((e as Error)?.message || e).slice(0, 200))
    return json({ error: 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่' }, 500)
  }
}))
