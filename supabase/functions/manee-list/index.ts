import { createClient } from 'npm:@supabase/supabase-js@2'

// รายการรับเงินแม่มณีที่ตรงกับ QR หนึ่งใบ (ยอดเท่ากัน และเวลาอยู่ในช่วง from..to) · เฉพาะพนักงานที่ active
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active').eq('user_id', uid).maybeSingle()
  if (!st.data?.active) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์' }, 403)
  let b: { amount?: unknown; from?: unknown; to?: unknown } = {}
  try { b = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const amount = Math.round(Number(b.amount) * 100) / 100
  const from = new Date(String(b.from)).getTime()
  const to = new Date(String(b.to)).getTime()
  if (!(amount > 0) || !Number.isFinite(from) || !Number.isFinite(to) || to < from) return json({ error: 'คำขอไม่ถูกต้อง' }, 400)
  const { data, error } = await sb.from('manee_transfers')
    .select('id,amount,received_at,text')
    .eq('amount', amount)
    .gt('received_at', new Date(from).toISOString())
    .lte('received_at', new Date(to).toISOString())
    .order('received_at', { ascending: true })
    .limit(20)
  if (error) return json({ error: 'อ่านข้อมูลไม่สำเร็จ' }, 500)
  return json({ rows: data ?? [] })
})
