import { corsWrap } from '../_shared/cors.ts'
import { isTokenShape, tallyAwards } from '../_shared/lucky.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

// ลุ้นโชคท้ายบิล (เฉพาะสมาชิกที่ล็อกอิน) · รับ token ของบิล และเซสชันสมาชิก (ถ้ามี)
// ดู (spin=false): ไม่ต้องล็อกอิน · ได้รายการรางวัล จำนวนที่ออกไปแล้วในช่วงเปิดลุ้น และผลการลุ้นของสมาชิกที่ล็อกอินอยู่ (ถ้ามี)
// ลุ้น (spin=true): ต้องมีเซสชันสมาชิก → punpang_lucky_spin เลือกรางวัลวนตามลำดับที่ร้านตั้ง แล้วสร้างคูปองในบัญชีสมาชิก
// token ของบิลสุ่ม 192 บิต เก็บเฉพาะ hash (punpang_records 'luckyTokens') · เซสชันเก็บเป็น hash เหมือน customer-loyalty
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const NOT_FOUND = { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' }

// ผลจากฐานข้อมูลที่ไม่ใช่การลุ้นสำเร็จ → สถานะและข้อความให้หน้าเว็บ
const SPIN_ERR: Record<string, { status: number; body: Record<string, string> }> = {
  not_found: { status: 404, body: NOT_FOUND },
  expired: { status: 410, body: { error: 'หมดเวลาลุ้นของบิลนี้แล้ว' } },
  done: { status: 409, body: { error: 'ลุ้นครบทุกใบของบิลนี้แล้ว' } },
  closed: { status: 409, body: { error: 'ยังไม่เปิดให้ลุ้น หรือปิดการลุ้นแล้ว' } },
  config_missing: { status: 500, body: { error: 'ตั้งค่าลุ้นโชคยังไม่ครบ กรุณาแจ้งร้าน' } },
  no_customer: { status: 401, body: { error: 'ไม่พบบัญชีสมาชิก กรุณาเข้าสู่ระบบใหม่', code: 'login' } },
}

// จำกัดลองผิด ต่อ IP ต่อ instance (เสริมจาก token ที่เดาไม่ได้)
const fails = new Map<string, number[]>()
const blocked = (ip: string) => { const now = Date.now(); const a = (fails.get(ip) || []).filter((t) => now - t < 300000); fails.set(ip, a); return a.length >= 20 }
const fail = (ip: string) => { fails.set(ip, [...(fails.get(ip) || []), Date.now()]); return json(NOT_FOUND, 404) }

Deno.serve(corsWrap(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (blocked(ip)) return json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' }, 429)
  let body: { token?: string; spin?: boolean; session?: string } = {}
  try { body = await req.json() } catch { return fail(ip) }
  const token = String(body.token ?? '')
  if (!isTokenShape(token)) return fail(ip)
  const spin = body.spin === true

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // เซสชันสมาชิก: ไม่บังคับตอนดู แต่บังคับตอนลุ้น
  let cid = ''
  const session = String(body.session ?? '')
  if (/^[a-f0-9]{64}$/.test(session)) {
    const s = (await sb.from('punpang_customer_sessions').select('customer_id,expires_at').eq('token_hash', await sha256Hex(`custsess:${session}`)).maybeSingle()).data
    if (s && new Date(s.expires_at).getTime() >= Date.now()) cid = String(s.customer_id)
  }
  if (spin && !cid) return json({ error: 'กรุณาเข้าสู่ระบบสมาชิกก่อนลุ้น', code: 'login' }, 401)

  const hash = await sha256Hex(`luckydraw:${token}`)
  const rec = await sb.from('punpang_records').select('id,data').eq('collection', 'luckyTokens').eq('data->>tokenHash', hash).maybeSingle()
  if (rec.error || !rec.data) return fail(ip)
  const data = rec.data.data as Record<string, any>
  if (!(Date.now() <= Date.parse(String(data.expiresAt)))) return json({ error: 'หมดเวลาลุ้นของบิลนี้แล้ว' }, 410)

  const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  const cfg = (shop.data?.data?.v?.luckyDraw || {}) as Record<string, any>

  // รางวัลที่ออกไปแล้วในช่วงเปิดลุ้น (ทุกบิล) · การลุ้นทุกครั้งเกิดก่อนหมดอายุของบิล จึงกรองแถวด้วย expiresAt ได้ · อ่านทีละ 1000 แถว (เพดานของ API)
  const awardsInWindow = async (): Promise<Record<string, number>> => {
    const fromMs = Date.parse(String(cfg.from || ''))
    const toMs = Date.parse(String(cfg.to || ''))
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return {}
    const spins: Record<string, any>[] = []
    for (let page = 0; ; page++) {
      const { data: rows, error } = await sb.from('punpang_records').select('data').eq('collection', 'luckyTokens')
        .gte('data->>expiresAt', new Date(fromMs).toISOString()).order('id').range(page * 1000, page * 1000 + 999)
      if (error) throw new Error(error.message)
      for (const r of rows ?? []) for (const s of Array.isArray(r.data?.spins) ? r.data.spins : []) spins.push(s)
      if ((rows ?? []).length < 1000) break
    }
    return tallyAwards(spins, fromMs, toMs)
  }

  // มุมมองที่ส่งให้หน้าเว็บ: ไม่มี tokenHash และไม่มีจำนวนรางวัลทั้งหมดที่ร้านตั้งไว้ · เห็นผลการลุ้นเฉพาะของสมาชิกที่ล็อกอินอยู่
  const viewOf = async (d: Record<string, any>) => {
    const draws = Math.max(0, Math.round(Number(d.draws) || 0))
    const spins: Record<string, any>[] = Array.isArray(d.spins) ? d.spins : []
    const prizes: Record<string, any>[] = Array.isArray(cfg.prizes) ? cfg.prizes : []
    const counts = await awardsInWindow().catch((e) => { console.error('awarded', e); return null })
    return {
      draws,
      remaining: Math.max(0, draws - spins.length),
      state: spins.length >= draws ? 'done' : 'ready',
      window: { from: String(cfg.from || ''), to: String(cfg.to || '') },
      prizes: prizes.map((p) => ({ id: String(p.id), name: String(p.name), kind: String(p.kind), amount: Number(p.amount) || 0 })),
      awarded: counts && prizes.map((p) => ({ id: String(p.id), name: String(p.name), count: counts[String(p.id)] ?? 0 })),
      spins: spins.filter((s) => cid && s.customerId === cid).map((s) => ({
        at: s.at,
        prize: s.prize ? { name: String(s.prize.name), kind: String(s.prize.kind), amount: Number(s.prize.amount) || 0 } : null,
        couponExpiresAt: s.couponExpiresAt || null,
      })),
    }
  }

  if (!spin) return json(await viewOf(data))

  const r = await sb.rpc('punpang_lucky_spin', { p_token_hash: hash, p_customer: cid })
  if (r.error) { console.error('punpang_lucky_spin', r.error); return json({ error: 'ลองใหม่อีกครั้ง' }, 500) }
  const out = (r.data || {}) as Record<string, any>
  if (out.error) {
    const e = SPIN_ERR[String(out.error)]
    return json(e?.body ?? { error: 'ทำรายการไม่ได้' }, e?.status ?? 400)
  }
  const fresh = await sb.from('punpang_records').select('data').eq('id', rec.data.id).maybeSingle()
  return json(await viewOf((fresh.data?.data as Record<string, any>) || data))
}))
