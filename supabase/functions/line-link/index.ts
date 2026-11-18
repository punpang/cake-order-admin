import { modeOf, refuseInTest } from '../_shared/mode.ts'
import { corsWrap } from '../_shared/cors.ts'
import { lineUserIdOk, liffTokenOk, parseLinkRequest } from '../_shared/lineliff.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

// ผูกบัญชี LINE กับลูกค้า: ยืนยันว่าเป็นผู้ใช้ LINE คนนี้ (โทเค็น LIFF) + ลูกค้าเข้าสู่ระบบแล้ว (เซสชัน เบอร์+PIN)
// ตอบ { ok: true } หรือ { error }
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

// ฝั่งลูกค้า (ใช้เซสชันเดียวกับหน้าบัญชี ไม่ต้องใช้โทเค็น LINE):
// status = ดูว่าเชื่อม LINE แล้วหรือยัง · unlink = ยกเลิกการเชื่อม แล้วลบชื่อ LINE และประวัติข้อความของบัญชีนี้ทันที
async function manageLink(session: unknown, action: 'status' | 'unlink'): Promise<Response> {
  if (typeof session !== 'string' || !session) return json({ error: 'กรุณาเข้าสู่ระบบบัญชีก่อน' }, 401)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const s = (await sb.from('punpang_customer_sessions').select('customer_id, expires_at')
    .eq('token_hash', await sha256Hex(`custsess:${session}`)).maybeSingle()).data
  if (!s || new Date(s.expires_at).getTime() <= Date.now()) return json({ error: 'กรุณาเข้าสู่ระบบบัญชีก่อน' }, 401)

  const rows = await sb.from('punpang_line_users').select('line_user_id, display_name').eq('customer_id', s.customer_id)
  if (rows.error) return json({ error: 'อ่านข้อมูลการเชื่อม LINE ไม่สำเร็จ' }, 500)
  const list = rows.data || []
  if (action === 'status') {
    return json({ linked: list.length > 0, displayName: String(list[0]?.display_name || '') })
  }
  const ids: string[] = list.map((r: { line_user_id: string }) => r.line_user_id)
  if (ids.length) {
    const m = await sb.from('punpang_line_messages').delete().in('line_user_id', ids)
    if (m.error) return json({ error: 'ยกเลิกการเชื่อมไม่สำเร็จ กรุณาลองใหม่' }, 500)
    const u = await sb.from('punpang_line_users').delete().in('line_user_id', ids)
    if (u.error) return json({ error: 'ยกเลิกการเชื่อมไม่สำเร็จ กรุณาลองใหม่' }, 500)
  }
  return json({ ok: true, unlinked: ids.length })
}

Deno.serve(corsWrap(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused // โหมดทดสอบไม่เชื่อมบัญชี LINE จริง
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let body: unknown = null
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const act = (body as { action?: unknown } | null)?.action
  if (act === 'status' || act === 'unlink') return manageLink((body as { session?: unknown }).session, act)
  const r = parseLinkRequest(body)
  if (!r) return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)

  // 1) โทเค็น LIFF ต้องเป็นของช่อง LINE Login ของร้านและยังใช้ได้
  const vr = await fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(r.accessToken))
  const verify = vr.ok ? await vr.json().catch(() => null) : null
  if (!liffTokenOk(verify)) return json({ error: 'ยืนยันตัวกับ LINE ไม่สำเร็จ กรุณาเปิดหน้านี้ใหม่จาก LINE' }, 401)

  // 2) userId ของผู้ใช้ LINE
  const pr = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${r.accessToken}` } })
  const prof = pr.ok ? await pr.json().catch(() => null) : null
  const lineUserId = prof?.userId
  if (!lineUserIdOk(lineUserId)) return json({ error: 'ยืนยันตัวกับ LINE ไม่สำเร็จ' }, 401)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // 3) เซสชันลูกค้าที่ยังไม่หมดอายุ
  const s = (await sb.from('punpang_customer_sessions').select('customer_id, expires_at')
    .eq('token_hash', await sha256Hex(`custsess:${r.session}`)).maybeSingle()).data
  if (!s || new Date(s.expires_at).getTime() <= Date.now()) return json({ error: 'กรุณาเข้าสู่ระบบบัญชีก่อน' }, 401)

  // 4) บันทึกการผูก (ไม่แตะสถานะติดตามของ LINE)
  const up = await sb.from('punpang_line_users').upsert(
    { line_user_id: lineUserId, display_name: String(prof?.displayName ?? '').slice(0, 100), customer_id: s.customer_id, updated_at: new Date().toISOString() },
    { onConflict: 'line_user_id' },
  )
  if (up.error) return json({ error: 'บันทึกการผูกไม่สำเร็จ กรุณาลองใหม่' }, 500)
  return json({ ok: true })
}))
