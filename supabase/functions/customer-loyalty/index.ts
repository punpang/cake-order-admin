import { corsWrap } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { smsConsentPatch } from '../_shared/schedlib/memberNotify.js'

// แลกของ/หมุนกาชาของลูกค้า (โหมด Supabase): ตรวจเซสชันลูกค้าก่อน แล้วเรียก RPC ฝั่งฐานข้อมูลด้วย service role
// action: redeem { rewardId } · spin { usePoints } · make_coupon { amount } · set_birth { month, consent } · clear_birth (สร้างคูปองลดเป็นบาทจากคะแนน)
// ตอบ { ok, customer, coupons, result } (ข้อมูลลูกค้าชุดเดียวกับ customer-auth · ไม่ส่งหมายเหตุพนักงาน) หรือ { error, code }
// เซสชันเก็บเป็น hash ในตาราง punpang_customer_sessions (เหมือน customer-auth)
const CORS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

const MSG: Record<string, string> = {
  no_customer: 'ไม่พบบัญชี',
  no_reward: 'ไม่พบของรางวัลนี้ หรือปิดให้แลกแล้ว',
  invalid: 'ข้อมูลไม่ถูกต้อง',
  insufficient: 'คะแนนไม่พอ',
  no_spin: 'ไม่มีสิทธิ์หมุนเหลือ',
  no_prize: 'ยังไม่มีรางวัลกาชาที่เปิดใช้',
  config_missing: 'ตั้งค่าของแลก/กาชายังไม่ครบ กรุณาแจ้งร้าน',
  not_divisible: 'มูลค่านี้แปลงเป็นคะแนนไม่ลงตัว กรุณาเลือกมูลค่าอื่น',
}

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const t = String(b.session ?? '')
  if (!/^[a-f0-9]{64}$/.test(t)) return json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, 401)
  const s = (await sb.from('punpang_customer_sessions').select('customer_id,expires_at')
    .eq('token_hash', await sha256Hex(`custsess:${t}`)).maybeSingle()).data
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401)
  const cid: string = s.customer_id

  const action = String(b.action || '')
  // ยินยอมรับ SMS สิทธิ์สมาชิก (แยกจากโปรโมชัน) · เขียนเฉพาะฟิลด์ smsOptIn/smsConsentAt และกันเขียนทับด้วย updated_at
  if (action === 'set_sms') {
    if (typeof b.optIn !== 'boolean') return json({ error: 'ข้อมูลไม่ถูกต้อง', code: 'invalid' }, 400)
    const before = (await sb.from('punpang_customers').select('id,name,phone,data,updated_at').eq('id', cid).maybeSingle()).data
    if (!before) return json({ error: 'ไม่พบบัญชี' }, 401)
    const next = smsConsentPatch(before.data || {}, b.optIn, new Date().toISOString())
    const u = await sb.from('punpang_customers').update({ data: next }).eq('id', cid).eq('updated_at', before.updated_at).select('id')
    if (u.error || !u.data?.length) return json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' }, 409)
    const cu = (await sb.from('punpang_customers').select('id,name,phone,data').eq('id', cid).maybeSingle()).data
    if (!cu) return json({ error: 'ไม่พบบัญชี' }, 401)
    const cp = await sb.from('punpang_records').select('id,data').eq('collection', 'coupons').eq('data->>customerId', cid)
    const coupons = (cp.data || []).map((x: any) => ({ ...(x.data || {}), id: x.id }))
    return json({ ok: true, customer: { ...(cu.data || {}), id: cu.id, name: cu.name, phone: cu.phone || '' }, coupons, result: { ok: true } })
  }
  let r
  if (action === 'redeem') r = await sb.rpc('punpang_cust_redeem', { p_customer: cid, p_reward: String(b.rewardId ?? '') })
  else if (action === 'spin') r = await sb.rpc('punpang_cust_spin', { p_customer: cid, p_use_points: b.usePoints === true })
  else if (action === 'make_coupon') {
    const amt = Number(b.amount)
    r = await sb.rpc('punpang_cust_make_coupon', { p_customer: cid, p_amount: Number.isFinite(amt) ? amt : null })
  }
  else if (action === 'set_birth') {
    const m = Number(b.month)
    r = await sb.rpc('punpang_cust_set_birth', { p_customer: cid, p_month: Number.isInteger(m) ? m : null, p_consent: b.consent === true })
  }
  else if (action === 'clear_birth') r = await sb.rpc('punpang_cust_clear_birth', { p_customer: cid })
  else return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)
  if (r.error) return json({ error: 'ทำรายการไม่สำเร็จ กรุณาลองใหม่' }, 500)

  const d = (r.data || {}) as Record<string, any>
  if (d.error) return json({ error: MSG[d.error] || 'ทำรายการไม่ได้', code: d.error }, 400)
  if (d.ok === false) return json({ error: 'ข้อมูลไม่ถูกต้อง กรุณาเลือกเดือนเกิดและยินยอมก่อนบันทึก', code: d.error || 'invalid' }, 400)

  const cu = (await sb.from('punpang_customers').select('id,name,phone,data').eq('id', cid).maybeSingle()).data
  if (!cu) return json({ error: 'ไม่พบบัญชี' }, 401)
  const customer = { ...(cu.data || {}), id: cu.id, name: cu.name, phone: cu.phone || '' }
  const cp = await sb.from('punpang_records').select('id,data').eq('collection', 'coupons').eq('data->>customerId', cid)
  const coupons = (cp.data || []).map((x: any) => ({ ...(x.data || {}), id: x.id }))
  return json({ ok: true, customer, coupons, result: d })
}))
