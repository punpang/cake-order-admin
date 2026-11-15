import { corsWrap } from '../_shared/cors.ts'
import { codeFromBytes, isTokenShape, percentFromBytes, pickPrize, type LuckyPrize } from '../_shared/lucky.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

// หน้าลุ้นโชคของบิล (ไม่ต้องล็อกอิน): รับ token → ลุ้นได้ครั้งเดียวต่อบิล → คืนผลและรหัสรางวัล
// token สุ่ม 192 บิต เก็บเฉพาะ hash ใน punpang_records('luckyTokens') · ผลลุ้นเขียนครั้งเดียว (เงื่อนไข spunAt ว่าง)
// รายการรางวัลและโอกาสอ่านจากตั้งค่าร้าน (punpang_kv config/shop → v.luckyDraw) ตอนลุ้น
const DAY = 86400000
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const NOT_FOUND = { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' }

// จำกัดลองผิด ต่อ IP ต่อ instance (เสริมจาก token ที่เดาไม่ได้)
const fails = new Map<string, number[]>()
const blocked = (ip: string) => { const now = Date.now(); const a = (fails.get(ip) || []).filter((t) => now - t < 300000); fails.set(ip, a); return a.length >= 20 }
const fail = (ip: string) => { fails.set(ip, [...(fails.get(ip) || []), Date.now()]); return json(NOT_FOUND, 404) }

// ผลที่ส่งให้หน้าเว็บ (ไม่ส่ง tokenHash หรือข้อมูลส่วนตัวของลูกค้า)
// state: ready = ยังไม่ได้ลุ้น · done = ลุ้นแล้ว (ดูรางวัลและรหัสได้)
const resultOf = (d: Record<string, any>) => ({
  state: d.spunAt ? 'done' : 'ready',
  won: !!d.prize,
  prize: d.prize || null,
  code: d.code || null,
  codeExpiresAt: d.codeExpiresAt || null,
  redeemed: !!d.redeemedAt,
  spunAt: d.spunAt || null,
})

Deno.serve(corsWrap(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (blocked(ip)) return json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' }, 429)
  let body: { token?: string; spin?: boolean } = {}
  try { body = await req.json() } catch { return fail(ip) }
  const token = String(body.token ?? '')
  const spin = body.spin === true // spin=false = เปิดดูสถานะเฉย ๆ (ไม่ลุ้น)
  if (!isTokenShape(token)) return fail(ip)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const hash = await sha256Hex(`luckydraw:${token}`)
  const rec = await sb.from('punpang_records').select('id,data').eq('collection', 'luckyTokens').eq('data->>tokenHash', hash).maybeSingle()
  if (rec.error || !rec.data) return fail(ip)
  const data = rec.data.data as Record<string, any>
  const now = Date.now()
  if (!(now <= Date.parse(String(data.expiresAt)))) return json({ error: 'หมดเวลาลุ้นของบิลนี้แล้ว' }, 410)
  if (data.spunAt || !spin) return json(resultOf(data)) // ลุ้นไปแล้ว: คืนผลเดิม ไม่สุ่มซ้ำ · ยังไม่ลุ้นและไม่ได้ขอให้ลุ้น: คืนสถานะ

  const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  const cfg = (shop.data?.data?.v?.luckyDraw || {}) as { prizes?: LuckyPrize[]; prizeDays?: number }
  const prizes: LuckyPrize[] = Array.isArray(cfg.prizes) ? cfg.prizes : []
  const rnd = crypto.getRandomValues(new Uint8Array(10))
  const won = pickPrize(prizes, percentFromBytes(rnd.subarray(0, 4)))
  const days = Math.min(365, Math.max(1, Math.round(Number(cfg.prizeDays) || 30)))
  const next = {
    ...data,
    spunAt: new Date(now).toISOString(),
    prize: won ? { id: won.id, name: won.name, kind: won.kind, amount: Number(won.amount) || 0 } : null,
    code: won ? codeFromBytes(rnd.subarray(4, 10)) : null,
    codeExpiresAt: won ? new Date(now + days * DAY).toISOString() : null,
    redeemedAt: null,
  }
  // เขียนได้ครั้งเดียว: ถ้ามีการลุ้นพร้อมกัน แถวนี้จะอัปเดตได้เพียงครั้งเดียว
  const up = await sb.from('punpang_records').update({ data: next }).eq('id', rec.data.id).filter('data->>spunAt', 'is', null).select('id')
  if (up.error) return json({ error: 'ลองใหม่อีกครั้ง' }, 500)
  if (!up.data?.length) { // มีการลุ้นพร้อมกันไปแล้ว → อ่านผลที่บันทึกไว้
    const again = await sb.from('punpang_records').select('data').eq('id', rec.data.id).maybeSingle()
    return json(resultOf((again.data?.data as Record<string, any>) || data))
  }
  return json(resultOf(next))
}))
