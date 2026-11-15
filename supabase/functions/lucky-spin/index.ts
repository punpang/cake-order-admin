import { corsWrap } from '../_shared/cors.ts'
import { isTokenShape, nextSpin, type LuckyPrize } from '../_shared/lucky.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

// หน้าลุ้นโชคของบิล (ไม่ต้องล็อกอิน): รับ token → คืนสถานะ (พร้อมรายการรางวัลที่ลุ้นได้) หรือลุ้นทีละครั้งจนครบจำนวนที่บิลมี
// token สุ่ม 192 บิต เก็บเฉพาะ hash ใน punpang_records('luckyTokens') · ทุกครั้งที่ลุ้นเขียนด้วยเงื่อนไข spinCount เดิม (กันลุ้นซ้อน)
// รายการรางวัลและโอกาสอ่านจากตั้งค่าร้าน (punpang_kv config/shop → v.luckyDraw) · หน้าเว็บเห็นเฉพาะชื่อ ประเภท และจำนวนของรางวัล (ไม่เห็นโอกาส)
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const NOT_FOUND = { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' }

// จำกัดลองผิด ต่อ IP ต่อ instance (เสริมจาก token ที่เดาไม่ได้)
const fails = new Map<string, number[]>()
const blocked = (ip: string) => { const now = Date.now(); const a = (fails.get(ip) || []).filter((t) => now - t < 300000); fails.set(ip, a); return a.length >= 20 }
const fail = (ip: string) => { fails.set(ip, [...(fails.get(ip) || []), Date.now()]); return json(NOT_FOUND, 404) }

// สถานะที่ส่งให้หน้าเว็บ (ไม่ส่ง tokenHash หรือข้อมูลส่วนตัวของลูกค้า)
// state: ready = ยังลุ้นได้ · done = ลุ้นครบแล้ว · prizes = รางวัลที่ลุ้นได้ (แสดงก่อนลุ้น)
const resultOf = (d: Record<string, any>, prizes: LuckyPrize[]) => {
  const draws = Math.max(0, Math.round(Number(d.draws) || 0))
  const spins: Record<string, any>[] = Array.isArray(d.spins) ? d.spins : []
  return {
    draws,
    remaining: Math.max(0, draws - spins.length),
    state: spins.length >= draws ? 'done' : 'ready',
    prizes: prizes.map((p) => ({ name: String(p.name), kind: p.kind, amount: Number(p.amount) || 0 })),
    spins: spins.map((s) => ({ at: s.at, prize: s.prize || null, code: s.code || null, codeExpiresAt: s.codeExpiresAt || null, redeemed: !!s.redeemedAt })),
  }
}

Deno.serve(corsWrap(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (blocked(ip)) return json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' }, 429)
  let body: { token?: string; spin?: boolean } = {}
  try { body = await req.json() } catch { return fail(ip) }
  const token = String(body.token ?? '')
  const spin = body.spin === true // spin=false = ดูสถานะเฉย ๆ (ไม่ลุ้น)
  if (!isTokenShape(token)) return fail(ip)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const hash = await sha256Hex(`luckydraw:${token}`)
  const rec = await sb.from('punpang_records').select('id,data').eq('collection', 'luckyTokens').eq('data->>tokenHash', hash).maybeSingle()
  if (rec.error || !rec.data) return fail(ip)
  const data = rec.data.data as Record<string, any>
  const now = Date.now()
  if (!(now <= Date.parse(String(data.expiresAt)))) return json({ error: 'หมดเวลาลุ้นของบิลนี้แล้ว' }, 410)

  const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  const cfg = (shop.data?.data?.v?.luckyDraw || {}) as { prizes?: LuckyPrize[]; prizeDays?: number }
  const prizes: LuckyPrize[] = Array.isArray(cfg.prizes) ? cfg.prizes : []
  const spins: Record<string, any>[] = Array.isArray(data.spins) ? data.spins : []
  if (!spin || spins.length >= (Number(data.draws) || 0)) return json(resultOf(data, prizes)) // ไม่ได้ขอให้ลุ้น หรือลุ้นครบแล้ว

  const cur = Number(data.spinCount ?? spins.length)
  const one = nextSpin({
    draws: Number(data.draws) || 0, spinCount: spins.length, prizes, rnd: crypto.getRandomValues(new Uint8Array(10)),
    nowIso: new Date(now).toISOString(), prizeDays: Number(cfg.prizeDays) || 30,
  })
  if (!one) return json(resultOf(data, prizes))
  const next = { ...data, spins: [...spins, one], spinCount: spins.length + 1 }
  // เขียนได้เมื่อยังเป็นจำนวนครั้งเดิม: ถ้ามีการลุ้นพร้อมกัน แถวนี้จะไม่ตรงเงื่อนไขและไม่ถูกเขียนซ้ำ
  const up = await sb.from('punpang_records').update({ data: next }).eq('id', rec.data.id).filter('data->>spinCount', 'eq', String(cur)).select('id')
  if (up.error) return json({ error: 'ลองใหม่อีกครั้ง' }, 500)
  if (!up.data?.length) { // มีการลุ้นพร้อมกันไปแล้ว → อ่านสถานะล่าสุด
    const again = await sb.from('punpang_records').select('data').eq('id', rec.data.id).maybeSingle()
    return json(resultOf((again.data?.data as Record<string, any>) || data, prizes))
  }
  return json(resultOf(next, prizes))
}))
