// ลบรูปสลิปชุดเทรนที่เก่าเกิน 30 วัน · pg_cron เรียกทุกวันผ่าน pg_net (ดู migration 20261113110000) · รับเฉพาะคีย์ service role ของโปรเจกต์นี้
import { createClient } from 'npm:@supabase/supabase-js@2'
import { bearerMatches, pruneTrainSlips } from '../_shared/slipprune.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!bearerMatches(req.headers.get('authorization'), serviceKey)) return json({ error: 'unauthorized' }, 401)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } })
  const r = await pruneTrainSlips(sb)
  return json(r, r.ok ? 200 : 500)
})
