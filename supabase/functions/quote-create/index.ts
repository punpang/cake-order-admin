import { corsWrap } from '../_shared/cors.ts'
// Edge Function: ส่งใบเสนอ — เซิร์ฟเวอร์คิดราคาเองจากแคตาล็อก แล้วบันทึกใบเสนอ (แอปไม่ได้ส่งราคามาบันทึกตรง ๆ อีกแล้ว)
// - ตรวจสิทธิ์: พนักงานที่ active และมีสิทธิ์ chat + createOrder (เหมือน can() ของแอป และสิทธิ์เขียนใบเสนอใน RLS)
// - อ่านแคตาล็อก (punpang_kv config + punpang_items หน้าร้าน) ด้วยสิทธิ์เซิร์ฟเวอร์ แล้วคิดด้วย _shared/schedlib/quotePrice.js (ชุดเดียวกับแอป)
// - เลข QT ออกจาก punpang_alloc_numbers ด้วยโทเค็นของพนักงาน (ฟังก์ชันนั้นตรวจ auth.uid() ว่าเป็นพนักงานที่ active)
// - หลังบันทึกใบใหม่สำเร็จ ใบเก่าที่ยังรอของแชทเดียวกัน → superseded
// ดู docs/security.md (รอบ 2026-11-15) — ใช้ร่วมกับ migration 20261115080000 (ปิดการ INSERT ใบเสนอจากเครื่องพนักงาน)
import { buildQuotePayload, bkkWall } from '../_shared/schedlib/quotePrice.js'
import { ddmmyy, formatNo } from '../_shared/schedlib/docNo.js'
import { loadCatalog } from '../_shared/catalog.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } })

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const SERVICE_HEADERS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }

// พนักงานที่ล็อกอินอยู่ (โทเค็นจากแอป) และ active จริง
async function staffOf(token: string): Promise<{ id: string; perms: string[]; token: string } | null> {
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  if (!u.ok) return null
  const user = await u.json()
  if (!user?.id) return null
  const r = await fetch(`${SUPABASE_URL}/rest/v1/punpang_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,active,perms`, { headers: SERVICE_HEADERS })
  const rows = r.ok ? await r.json() : []
  const s = Array.isArray(rows) ? rows[0] : null
  if (!s || s.active !== true) return null
  return { id: s.user_id, perms: Array.isArray(s.perms) ? s.perms : [], token }
}

async function rest(path: string): Promise<any[] | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SERVICE_HEADERS })
  if (!r.ok) return null
  const rows = await r.json()
  return Array.isArray(rows) ? rows : null
}

// เลขใบเสนอ (QT-ddmmyy-xxxxx) จากตัวนับเดียวกับแอป · ใช้โทเค็นพนักงาน เพราะฟังก์ชันนับเลขตรวจ auth.uid()
async function allocQuoteSeq(token: string, day: string): Promise<number | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/punpang_alloc_numbers`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_prefix: 'QT', p_day: day, p_n: 1 }),
  })
  if (!r.ok) return null
  const n = Number(await r.json())
  return Number.isInteger(n) && n >= 1 ? n : null
}

const newQuoteId = () => 'qt' + Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => (b % 36).toString(36)).join('')

Deno.serve(corsWrap(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'ไม่รองรับคำขอนี้' }, 405)
  if (!SUPABASE_URL || !ANON || !SERVICE) return json({ error: 'เซิร์ฟเวอร์ยังตั้งค่าไม่ครบ' }, 500)

  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')
  const who = m ? await staffOf(m[1]) : null
  if (!who) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  if (!who.perms.includes('chat') || !who.perms.includes('createOrder')) return json({ error: 'บทบาทนี้ส่งใบเสนอไม่ได้' }, 403)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400) }
  const chatId = typeof body?.chatId === 'string' ? body.chatId : ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(chatId)) return json({ error: 'ไม่พบแชท' }, 404)
  const chats = await rest(`punpang_chats?id=eq.${chatId}&select=id,customer_id`)
  if (!chats) return json({ error: 'อ่านข้อมูลแชทไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)
  if (!chats.length) return json({ error: 'ไม่พบแชท' }, 404)
  const catalog = await loadCatalog(SUPABASE_URL, SERVICE_HEADERS)
  if (!catalog) return json({ error: 'อ่านแคตาล็อกไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)

  const now = Date.now()
  const built = buildQuotePayload({ draft: body?.draft, customerId: chats[0].customer_id ?? null, catalog, nowMs: now }) as { ok: boolean; error?: string; payload?: any }
  if (!built.ok) return json({ error: built.error }, 422)

  const day = ddmmyy(bkkWall(now))
  for (let tries = 0; tries < 3; tries++) {
    const seq = await allocQuoteSeq(who.token, day)
    if (seq == null) return json({ error: 'ออกเลขใบเสนอไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)
    const id = newQuoteId()
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/punpang_quotes`, {
      method: 'POST',
      headers: { ...SERVICE_HEADERS, 'content-type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify([{
        id,
        code: formatNo('QT', day, seq),
        chat_id: chatId,
        customer_id: built.payload.customerId,
        status: 'pending',
        order_id: null,
        data: { payload: built.payload, createdAt: new Date(now).toISOString(), respondedAt: null },
      }]),
    })
    if (ins.status === 409) continue // เลขซ้ำ → ออกเลขใหม่
    if (!ins.ok) return json({ error: 'บันทึกใบเสนอไม่สำเร็จ' }, 502)
    const rows = await ins.json()
    await fetch(`${SUPABASE_URL}/rest/v1/punpang_quotes?chat_id=eq.${chatId}&status=eq.pending&id=neq.${id}`, {
      method: 'PATCH',
      headers: { ...SERVICE_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'superseded' }),
    })
    return json({ quote: Array.isArray(rows) ? rows[0] : rows })
  }
  return json({ error: 'ออกเลขใบเสนอไม่สำเร็จ ลองใหม่อีกครั้ง' }, 502)
}))
