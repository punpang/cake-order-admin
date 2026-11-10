// punpang-files: เก็บ/เสิร์ฟไฟล์ใน R2
//  - รูปสาธารณะ (สินค้า/หน้าร้าน): GET /p/<key> จาก FILES_PUBLIC (แคชได้)
//  - รูปส่วนตัว (สลิป/รูปงาน/ไฟล์แนบแชท): เสิร์ฟด้วยลิงก์ลงลายเซ็นที่มีวันหมดอายุ GET /f/<key>?exp&sig จาก FILES_PRIVATE
//  - POST /sign   : ตรวจสิทธิ์ แล้วออกลิงก์ชั่วคราว (พนักงาน / ลูกค้าเจ้าของออร์เดอร์ / ลิงก์ออร์เดอร์)
//  - POST /upload : พนักงานที่ล็อกอินอัปโหลดรูป (ตรวจชนิดจากไบต์จริง ≤ 5 MB)
//  - POST /delete : พนักงานลบไฟล์ส่วนตัวที่ไม่มีข้อมูลอ้างถึงแล้ว
// คีย์ลับ (SIGN_KEY, SUPABASE_SERVICE_ROLE_KEY) อยู่ใน Secrets เท่านั้น

const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
const safeEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
const rand = () => hex(crypto.getRandomValues(new Uint8Array(12)))
const MAX_BYTES = 5 * 1024 * 1024
const SIGN_TTL = 3600
const DAY = 86400000

function corsHeaders(req, env) {
  const o = req.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return { 'Access-Control-Allow-Origin': allowed.includes(o) ? o : allowed[0] || '*', Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
}
const json = (req, env, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req, env), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// เรียก Supabase REST ด้วยคีย์ service role (ฝั่งเซิร์ฟเวอร์เท่านั้น)
const sbFetch = (env, path) => fetch(`${env.SUPABASE_URL}${path}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } })

// พนักงาน: ตรวจ Supabase access token แล้วดูว่ายัง active อยู่
async function staffOf(req, env) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '')
  if (!m) return null
  const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` } })
  if (!u.ok) return null
  const user = await u.json().catch(() => null)
  if (!user?.id) return null
  const r = await sbFetch(env, `/rest/v1/punpang_staff?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,active,perms`)
  const s = r.ok ? (await r.json())[0] : null
  return s && s.active !== false ? s : null
}

// ลูกค้า: เซสชันที่ยังไม่หมดอายุ → customer_id
async function customerOf(env, session) {
  const t = String(session ?? '')
  if (!/^[a-f0-9]{64}$/.test(t)) return null
  const r = await sbFetch(env, `/rest/v1/punpang_customer_sessions?token_hash=eq.${await sha256Hex(`custsess:${t}`)}&select=customer_id,expires_at`)
  const s = r.ok ? (await r.json())[0] : null
  return s && new Date(s.expires_at).getTime() >= Date.now() ? s.customer_id : null
}

// ลิงก์ออร์เดอร์: token → orderId (ยังไม่ถูกเพิกถอนและยังไม่หมดอายุตามนโยบายร้าน)
async function orderOfLink(env, token) {
  const t = String(token ?? '')
  if (!/^[A-Za-z0-9_-]{32}$/.test(t)) return null
  const r = await sbFetch(env, `/rest/v1/punpang_records?collection=eq.orderLinks&data->>tokenHash=eq.${await sha256Hex(`orderlink:${t}`)}&select=data`)
  const link = r.ok ? (await r.json())[0]?.data : null
  if (!link || link.revokedAt) return null
  const shop = await (await sbFetch(env, '/rest/v1/punpang_kv?collection=eq.config&id=eq.shop&select=data')).json().catch(() => [])
  const pol = shop[0]?.data?.v?.linkPolicy || {}
  const idle = Number(pol.idleDays) || 7
  const never = Number(pol.neverOpenedDays) || 30
  const expires = link.lastOpenedAt ? new Date(link.lastOpenedAt).getTime() + idle * DAY : new Date(link.createdAt).getTime() + never * DAY
  return Date.now() <= expires ? link.orderId : null
}

// สิทธิ์เห็นไฟล์: ไฟล์แชท (chat/...) → พนักงานที่มีสิทธิ์แชท · ไฟล์ของออร์เดอร์ (<orderId>/...) → พนักงาน active / ลูกค้าเจ้าของ / ลิงก์ออร์เดอร์
async function allowedToSee(req, env, key, body) {
  const staff = await staffOf(req, env)
  if (key.startsWith('chat/')) return !!staff && (staff.perms || []).some((p) => p === 'chat' || p === 'manage')
  if (staff) return true
  const orderId = key.split('/')[0]
  if (!orderId) return false
  const cid = await customerOf(env, body.session)
  if (cid) {
    const r = await sbFetch(env, `/rest/v1/punpang_orders?id=eq.${encodeURIComponent(orderId)}&select=customer_id,status`)
    const o = r.ok ? (await r.json())[0] : null
    return !!o && o.customer_id === cid && o.status !== 'draft'
  }
  return (await orderOfLink(env, body.token)) === orderId
}

// ลายเซ็นของลิงก์: HMAC(key|exp)
async function verifySig(env, key, exp, sig) {
  if (!env.SIGN_KEY || !Number.isFinite(exp) || exp * 1000 < Date.now()) return false
  return safeEq(await hmacHex(env.SIGN_KEY, `${key}|${exp}`), String(sig || ''))
}

const extOf = (b) => {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' }
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', type: 'image/webp' }
  return null
}
const safePrefix = (p) => (/^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,60})?$/.test(p) ? p : null)

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req, env) })
    const url = new URL(req.url)
    const path = url.pathname

    // ---- ไฟล์สาธารณะ ----
    if (req.method === 'GET' && path.startsWith('/p/')) {
      const key = decodeURIComponent(path.slice(3))
      const obj = await env.FILES_PUBLIC.get(key)
      if (!obj) return new Response('ไม่พบไฟล์', { status: 404, headers: corsHeaders(req, env) })
      return new Response(obj.body, { headers: { ...corsHeaders(req, env), 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' } })
    }

    // ---- ไฟล์ส่วนตัวด้วยลิงก์ลงลายเซ็น ----
    if (req.method === 'GET' && path.startsWith('/f/')) {
      const key = decodeURIComponent(path.slice(3))
      const exp = Number(url.searchParams.get('exp'))
      if (!(await verifySig(env, key, exp, url.searchParams.get('sig')))) return new Response('ลิงก์หมดอายุหรือไม่ถูกต้อง', { status: 403, headers: corsHeaders(req, env) })
      const obj = await env.FILES_PRIVATE.get(key)
      if (!obj) return new Response('ไม่พบไฟล์', { status: 404, headers: corsHeaders(req, env) })
      return new Response(obj.body, { headers: { ...corsHeaders(req, env), 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, max-age=300' } })
    }

    if (req.method !== 'POST') return json(req, env, { error: 'method' }, 405)

    // ---- ออกลิงก์ชั่วคราว ----
    if (path === '/sign') {
      const body = await req.json().catch(() => ({}))
      const key = String(body.key || '')
      if (!key || key.includes('..') || key.startsWith('/')) return json(req, env, { error: 'key ไม่ถูกต้อง' }, 400)
      if (!(await allowedToSee(req, env, key, body))) return json(req, env, { error: 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้' }, 403)
      const exp = Math.floor(Date.now() / 1000) + SIGN_TTL
      const sig = await hmacHex(env.SIGN_KEY, `${key}|${exp}`)
      return json(req, env, { url: `${url.origin}/f/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`, exp })
    }

    // ---- อัปโหลด (พนักงานเท่านั้น) ----
    if (path === '/upload') {
      const staff = await staffOf(req, env)
      if (!staff) return json(req, env, { error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
      const bucket = url.searchParams.get('bucket')
      const prefix = safePrefix(url.searchParams.get('prefix') || '')
      if (!prefix || !['public', 'private'].includes(bucket)) return json(req, env, { error: 'พารามิเตอร์ไม่ถูกต้อง' }, 400)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_BYTES) return json(req, env, { error: 'ไฟล์ว่างหรือใหญ่เกิน 5 MB' }, 400)
      const kind = extOf(bytes)
      if (!kind) return json(req, env, { error: 'ไฟล์ไม่ใช่รูปภาพที่รองรับ (PNG / JPG / WEBP)' }, 400)
      const key = `${prefix}/${rand()}.${kind.ext}`
      const store = bucket === 'public' ? env.FILES_PUBLIC : env.FILES_PRIVATE
      await store.put(key, bytes, { httpMetadata: { contentType: kind.type } })
      if (bucket === 'public') return json(req, env, { key, url: `${url.origin}/p/${key}` })
      return json(req, env, { key, ref: `r2://private/${key}` })
    }

    // ---- ลบไฟล์ส่วนตัว (พนักงานเท่านั้น) ----
    if (path === '/delete') {
      const staff = await staffOf(req, env)
      if (!staff) return json(req, env, { error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
      const body = await req.json().catch(() => ({}))
      const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter((k) => k && !k.includes('..') && !k.startsWith('/')).slice(0, 100)
      if (keys.length) await env.FILES_PRIVATE.delete(keys)
      return json(req, env, { ok: true, deleted: keys.length })
    }

    return json(req, env, { error: 'ไม่พบเส้นทาง' }, 404)
  },
}
