import { corsWrap } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isRefShape } from '../_shared/maneeforward.ts'

// รายการรับเงินถุงเงินที่ตรงกับรหัสธุรกรรม (ORD/POS) ของ QR หนึ่งใบ · เฉพาะพนักงานที่ active
const CORS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active').eq('user_id', uid).maybeSingle()
  if (!st.data?.active) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์' }, 403)
  let b: { ref?: unknown; amount?: unknown } = {}
  try { b = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const ref = String(b.ref ?? '').trim()
  const amount = Math.round(Number(b.amount) * 100) / 100
  if (!isRefShape(ref) || !(amount > 0)) return json({ error: 'คำขอไม่ถูกต้อง' }, 400)
  // ต้องตรงทั้งรหัสธุรกรรม (Ref2) และยอดเงิน · แจ้งเตือนที่ไม่มียอดจะไม่ถูกจับคู่
  const { data, error } = await sb.from('tungngern_transfers')
    .select('id,received_at,amount')
    .eq('ref', ref)
    .eq('amount', amount)
    .order('received_at', { ascending: true })
    .limit(20)
  if (error) return json({ error: 'อ่านข้อมูลไม่สำเร็จ' }, 500)
  return json({ rows: data ?? [] })
}))
