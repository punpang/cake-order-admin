import { filesEnv, isR2Ref, keyOfR2Ref, svcSign } from '../_shared/filesvc.ts'
import { publicPaymentOf } from '../_shared/shoppay.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

// ลิงก์ออร์เดอร์ของลูกค้า (ดูอย่างเดียว ไม่ต้องล็อกอิน): รับ token → คืนข้อมูลออร์เดอร์ที่ตัดข้อมูลภายในออกแล้ว
// token สุ่ม 192 บิต เก็บเฉพาะ hash ใน punpang_records('orderLinks') · หมดอายุ/เพิกถอนตามนโยบายร้าน · รูปส่วนตัวแปลงเป็นลิงก์ชั่วคราว 1 ชม.
// ตัดข้อมูลส่วนตัวที่ฝั่งเซิร์ฟเวอร์ (ที่อยู่/แผนที่/รายละเอียดจัดส่ง/วันเกิด/หมายเหตุสินค้า/เบอร์เต็ม) ไม่พึ่งการซ่อนที่หน้าเว็บ
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const DAY = 86400000
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const days = (v: unknown, d: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 1 && x <= 365 ? x : d }
const NOT_FOUND = { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' }
// หน้าเว็บแปลงเบอร์เป็น xxx-xxx-<3 ตัวท้าย> เอง (ต้องมีเลข ≥ 6 หลัก) จึงส่งเลขศูนย์นำหน้า + 3 ตัวท้ายเท่านั้น ไม่ส่งเบอร์จริง
const phoneHint = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 6 ? `0000000${d.slice(-3)}` : '' }

// จำกัดลองผิด (ต่อ IP ต่อ instance — เสริมจาก token 192 บิตที่เดาไม่ได้)
const fails = new Map<string, number[]>()
const blocked = (ip: string) => { const now = Date.now(); const a = (fails.get(ip) || []).filter((t) => now - t < 300000); fails.set(ip, a); return a.length >= 20 }
const fail = (ip: string) => { fails.set(ip, [...(fails.get(ip) || []), Date.now()]); return json(NOT_FOUND, 404) }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (blocked(ip)) return json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' }, 429)
  let body: { token?: string } = {}
  try { body = await req.json() } catch { return fail(ip) }
  const token = String(body.token ?? '')
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return fail(ip)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const hash = await sha256Hex(`orderlink:${token}`)
  const lr = await sb.from('punpang_records').select('id,data').eq('collection', 'orderLinks').eq('data->>tokenHash', hash).maybeSingle()
  if (lr.error || !lr.data) return fail(ip)
  const link = { ...lr.data.data, id: lr.data.id } as Record<string, any>
  const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  const pol = shop.data?.data?.v?.linkPolicy || {}
  const idle = days(pol.idleDays, 7), never = days(pol.neverOpenedDays, 30)
  const expires = link.lastOpenedAt ? new Date(link.lastOpenedAt).getTime() + idle * DAY : new Date(link.createdAt).getTime() + never * DAY
  if (link.revokedAt || !(Date.now() <= expires)) return fail(ip)
  const or = await sb.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data').eq('id', link.orderId).maybeSingle()
  if (or.error || !or.data) return fail(ip)
  const row = or.data
  const d: Record<string, any> = { ...(row.data || {}) }
  for (const k of ['history', 'approval', 'shiftId', 'chatId']) delete d[k] // ข้อมูลภายในร้าน
  // ข้อมูลส่วนตัว: ผู้ถือลิงก์ไม่ควรอ่านได้แม้เปิดดูผ่าน API (ลิงก์อาจถูกส่งต่อ) · ที่อยู่/แผนที่เห็นได้เฉพาะเจ้าของที่ล็อกอิน (customer-auth)
  for (const k of ['address', 'mapUrl', 'detail', 'birthday']) delete d[k]
  const sign = async (v: unknown) => {
    if (isR2Ref(v)) return (await svcSign(filesEnv(), keyOfR2Ref(v), 3600)) || ''
    const m = typeof v === 'string' ? /^sb:\/\/([a-z0-9-]+)\/(.+)$/.exec(v) : null
    if (!m) return v
    const r = await sb.storage.from(m[1]).createSignedUrl(m[2], 3600)
    return r.data?.signedUrl || ''
  }
  d.payments = (d.payments || []).map((p: any) => ({ ...p, slip: '' })) // ลูกค้าไม่ต้องเห็นรูปสลิปของร้าน
  for (const it of d.items || []) {
    delete it.note
    if (Array.isArray(it.workPhotos)) it.workPhotos = await Promise.all(it.workPhotos.map(async (w: any) => ({ ...w, image: await sign(w.image) })))
    if (Array.isArray(it.images)) it.images = await Promise.all(it.images.map(sign))
  }
  let customer = null
  if (row.customer_id) {
    const c = await sb.from('punpang_customers').select('id,name,phone,data').eq('id', row.customer_id).maybeSingle()
    if (c.data) customer = { id: c.data.id, name: String(c.data.name || '').trim().split(/\s+/)[0], phone: phoneHint(c.data.phone), deleted: !!c.data.data?.deleted }
  }
  const now = new Date().toISOString()
  const nextLink = { ...lr.data.data, lastOpenedAt: now, openCount: (Number(link.openCount) || 0) + 1 }
  // อัปเดตเฉพาะเมื่อลิงก์ยังไม่ถูกเพิกถอน (พนักงานเพิกถอนพร้อมกันแล้ว ห้ามเขียนทับกลับ)
  await sb.from('punpang_records').update({ data: nextLink }).eq('collection', 'orderLinks').eq('id', lr.data.id).filter('data->>revokedAt', 'is', null)
  return json({
    order: { id: row.id, code: row.code, customer_id: row.customer_id, status: row.status, fulfillment: row.fulfillment, channel: row.channel, data: d },
    customer,
    link: { ...nextLink, id: lr.data.id },
    shop: { name: shop.data?.data?.v?.name || '', payment: publicPaymentOf(shop.data?.data?.v) },
  })
})
