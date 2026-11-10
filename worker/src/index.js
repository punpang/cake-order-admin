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
const DEFAULT_MAX_MB = 5
const clampMb = (n, d) => { const x = Number(n); return Number.isFinite(x) && x >= 1 && x <= 20 ? Math.round(x * 10) / 10 : d }
const clampPx = (n, d) => { const x = Math.round(Number(n)); return Number.isFinite(x) && x >= 500 && x <= 4000 ? x : d }
// ค่าขนาดรูปที่ตั้งไว้ (kv config/imageLimits) · maxPx ใช้ฝั่งแอปย่อรูป (Worker ไม่อ่านพิกเซลได้)
async function getImageLimits(env) {
  const r = await sbFetch(env, '/rest/v1/punpang_kv?collection=eq.config&id=eq.imageLimits&select=data')
  const v = r.ok ? (await r.json())[0]?.data?.v : null
  return { maxMB: clampMb(v?.maxMB, DEFAULT_MAX_MB), maxPx: clampPx(v?.maxPx, 2000) }
}
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
      const lim = await getImageLimits(env)
      if (bytes.length === 0 || bytes.length > lim.maxMB * 1024 * 1024) return json(req, env, { error: `ไฟล์ว่างหรือใหญ่เกิน ${lim.maxMB} MB` }, 400)
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

    // ---- จัดการพื้นที่รูป (พนักงานที่มีสิทธิ์ manage) ----
    if (path.startsWith('/admin/')) {
      const staff = await staffOf(req, env)
      if (!staff || !(staff.perms || []).includes('manage')) return json(req, env, { error: 'ต้องมีสิทธิ์จัดการระบบ' }, 403)
      const body = await req.json().catch(() => ({}))
      if (path === '/admin/retention/get') return json(req, env, { ok: true, ...(await getRetention(env)) })
      if (path === '/admin/retention/set') {
        const cur = await getRetention(env)
        const next = { slipDays: clampDays(body.slipDays, cur.slipDays), refDays: clampDays(body.refDays, cur.refDays), trashDays: clampDays(body.trashDays, cur.trashDays) }
        await sbWrite(env, 'POST', '/rest/v1/punpang_kv?on_conflict=collection,id', [{ collection: 'config', id: 'fileRetention', data: { v: next } }], 'resolution=merge-duplicates,return=minimal')
        return json(req, env, { ok: true, ...next })
      }
      if (path === '/admin/limits/get') return json(req, env, { ok: true, ...(await getImageLimits(env)) })
      if (path === '/admin/limits/set') {
        const cur = await getImageLimits(env)
        const next = { maxMB: clampMb(body.maxMB, cur.maxMB), maxPx: clampPx(body.maxPx, cur.maxPx) }
        await sbWrite(env, 'POST', '/rest/v1/punpang_kv?on_conflict=collection,id', [{ collection: 'config', id: 'imageLimits', data: { v: next } }], 'resolution=merge-duplicates,return=minimal')
        return json(req, env, { ok: true, ...next })
      }
      if (path === '/admin/list') return json(req, env, await adminList(env, body, staff))
      if (path === '/admin/delete') return json(req, env, await adminDelete(env, body, staff))
      if (path === '/admin/trash/restore') return json(req, env, await trashAction(env, body, staff, 'restore'))
      if (path === '/admin/trash/purge') return json(req, env, await trashAction(env, body, staff, 'purge'))
    }

    return json(req, env, { error: 'ไม่พบเส้นทาง' }, 404)
  },

  // ลบอัตโนมัติรายวัน (Cron): เฉพาะสลิปและรูปอ้างอิงที่ออเดอร์ปิดเกินจำนวนวันที่ตั้งไว้ และไม่ถูกอ้างอิงแล้ว · รูปงานไม่ลบเด็ดขาด
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCleanup(env))
  },
}

// ---------- การลบไฟล์ ----------
const MAX_LIST_PAGES = 40
const DELETE_BATCH = 500
const clampDays = (n, d) => { const x = Math.round(Number(n)); return Number.isFinite(x) && x >= 30 && x <= 3650 ? x : d }
// ประเภทไฟล์จาก key: <orderId>/work/... = รูปงาน · <orderId>/ref/... = รูปอ้างอิง · <orderId>/<ไฟล์> = สลิป
export function fileTypeOf(key) {
  const parts = String(key).split('/')
  if (parts[0] === TRASH_DIR) return 'trash'
  if (parts.length < 2 || !parts[0]) return 'other'
  if (parts[1] === 'work') return 'work'
  if (parts[1] === 'ref') return 'ref'
  if (parts.length === 2) return 'slip'
  return 'other'
}
const ORDER_CLOSED = ['delivered', 'cancelled']
async function getRetention(env) {
  const r = await sbFetch(env, '/rest/v1/punpang_kv?collection=eq.config&id=eq.fileRetention&select=data')
  const v = r.ok ? (await r.json())[0]?.data?.v : null
  return { slipDays: clampDays(v?.slipDays, 180), refDays: clampDays(v?.refDays, 180), trashDays: clampDays(v?.trashDays, 30) }
}
async function sbWrite(env, method, path, rows, prefer) {
  return fetch(`${env.SUPABASE_URL}${path}`, { method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: prefer }, body: JSON.stringify(rows) })
}
// ดึงข้อมูลออเดอร์ของ key ทั้งหมดเป็นชุด → Map(orderId → {code, status, updated_at, data})
async function ordersById(env, ids) {
  const map = new Map()
  const uniq = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50).map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')
    const r = await sbFetch(env, `/rest/v1/punpang_orders?id=in.(${encodeURIComponent(chunk)})&select=id,code,status,updated_at,data`)
    for (const o of r.ok ? await r.json() : []) map.set(o.id, o)
  }
  return map
}
// ข้อความทั้งหมดที่อ้างถึงรูปสาธารณะ (สินค้า, ค่าตั้งค่า/หน้าร้าน, บันทึกต่าง ๆ) → ใช้ตรวจว่ารูปยังถูกใช้อยู่หรือไม่
async function publicRefText(env) {
  const parts = []
  for (const path of ['/rest/v1/punpang_items?select=data', '/rest/v1/punpang_kv?select=data', '/rest/v1/punpang_records?select=data', '/rest/v1/punpang_orders?select=data']) {
    const r = await sbFetch(env, path)
    if (r.ok) parts.push(JSON.stringify(await r.json()))
  }
  return parts.join('\n')
}
async function publicList(env, body) {
  const f = body.filter || {}
  const page = await env.FILES_PUBLIC.list({ cursor: body.cursor || undefined, limit: 200 })
  const objs = page.objects || []
  const refs = await publicRefText(env)
  const items = []
  for (const o of objs) {
    if (o.key.startsWith(TRASH)) continue
    const uploaded = o.uploaded ? new Date(o.uploaded).getTime() : 0
    if (f.uploadedFrom && uploaded < new Date(f.uploadedFrom).getTime()) continue
    if (f.uploadedTo && uploaded > new Date(f.uploadedTo).getTime() + DAY) continue
    items.push({ key: o.key, bucket: 'public', type: 'public', orderId: '', code: '', status: '', size: o.size, uploaded: o.uploaded, referenced: refs.includes(o.key), deletable: true })
  }
  return { ok: true, items, cursor: page.truncated ? page.cursor : null }
}

// ไฟล์ที่ยังถูกอ้างอิงในข้อมูลออเดอร์ (ค้นข้อความ key ในข้อมูลออเดอร์)
const referencedIn = (order, key) => !!order && JSON.stringify(order.data || {}).includes(key)
const isClosedFor = (order, days) => !!order && ORDER_CLOSED.includes(order.status) && Date.now() - new Date(order.updated_at).getTime() >= days * DAY

async function logDeletions(env, rows) {
  if (!rows.length) return
  await sbWrite(env, 'POST', '/rest/v1/punpang_records', rows.map((r) => ({ collection: 'fileDeletions', id: `fd${rand().slice(0, 12)}`, data: r })), 'return=minimal')
}

// รายการไฟล์ส่วนตัวตามตัวกรอง (ใช้หน้าจัดการ) · คืนหน้าละ ~200 รายการที่ผ่านกรอง
async function adminList(env, body, staff) {
  const f = body.filter || {}
  if (f.type === 'public') return publicList(env, body)
  if (f.type === 'trash') return trashList(env, body)
  const page = await env.FILES_PRIVATE.list({ cursor: body.cursor || undefined, limit: 200 })
  const objs = page.objects || []
  const ords = await ordersById(env, objs.map((o) => o.key.split('/')[0]))
  const items = []
  for (const o of objs) {
    const type = fileTypeOf(o.key)
    if (type === 'other' || type === 'trash') continue
    if (f.type && f.type !== 'all' && f.type !== type) continue
    const ord = ords.get(o.key.split('/')[0]) || null
    const uploaded = o.uploaded ? new Date(o.uploaded).getTime() : 0
    if (f.uploadedFrom && uploaded < new Date(f.uploadedFrom).getTime()) continue
    if (f.uploadedTo && uploaded > new Date(f.uploadedTo).getTime() + DAY) continue
    if (f.status && (!ord || ord.status !== f.status)) continue
    if (f.code && !(ord?.code || '').includes(String(f.code))) continue
    if (f.closedFrom || f.closedTo) {
      const closed = ord && ORDER_CLOSED.includes(ord.status) ? new Date(ord.updated_at).getTime() : 0
      if (!closed) continue
      if (f.closedFrom && closed < new Date(f.closedFrom).getTime()) continue
      if (f.closedTo && closed > new Date(f.closedTo).getTime() + DAY) continue
    }
    items.push({ key: o.key, type, orderId: o.key.split('/')[0], code: ord?.code || '', status: ord?.status || '', size: o.size, uploaded: o.uploaded, referenced: referencedIn(ord, o.key), deletable: type !== 'work' })
  }
  return { ok: true, items, cursor: page.truncated ? page.cursor : null }
}

// ลบแมนนวล: เฉพาะสลิป/รูปอ้างอิงที่ไม่ถูกอ้างอิงแล้ว · dryRun = แสดงรายการที่จะลบ โดยไม่ลบจริง
async function adminDelete(env, body, staff) {
  const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter((k) => k && !k.includes('..') && !k.startsWith('/')).slice(0, 500)
  if (body.bucket === 'public') {
    const refs = await publicRefText(env)
    const ok = [], refused = []
    for (const k of keys) {
      if (refs.includes(k)) refused.push({ key: k, reason: 'ยังถูกใช้อยู่ในสินค้า/หน้าร้าน' })
      else ok.push({ key: k, type: 'public', orderId: '' })
    }
    if (body.dryRun) return { ok: true, dryRun: true, wouldDelete: ok, refused }
    const done = []
    for (let i = 0; i < ok.length; i += DELETE_BATCH) {
      const batch = ok.slice(i, i + DELETE_BATCH)
      await moveToTrash(env.FILES_PUBLIC, batch, staff.user_id, 'manual')
      done.push(...batch)
    }
    await logDeletions(env, done.map((x) => ({ ...x, bucket: 'public', at: new Date().toISOString(), by: staff.user_id, reason: 'manual' })))
    return { ok: true, deleted: done.length, refused }
  }
  const ords = await ordersById(env, keys.map((k) => k.split('/')[0]))
  const ok = [], refused = []
  for (const k of keys) {
    const type = fileTypeOf(k)
    const ord = ords.get(k.split('/')[0]) || null
    if (type === 'work') refused.push({ key: k, reason: 'รูปงานลบไม่ได้' })
    else if (type === 'other') refused.push({ key: k, reason: 'ไม่รู้จักประเภทไฟล์' })
    else if (referencedIn(ord, k)) refused.push({ key: k, reason: 'ยังถูกอ้างอิงอยู่ในออเดอร์' })
    else ok.push({ key: k, type, orderId: k.split('/')[0] })
  }
  if (body.dryRun) return { ok: true, dryRun: true, wouldDelete: ok, refused }
  const done = []
  for (let i = 0; i < ok.length; i += DELETE_BATCH) {
    const batch = ok.slice(i, i + DELETE_BATCH)
    await moveToTrash(env.FILES_PRIVATE, batch, staff.user_id, 'manual')
    done.push(...batch)
  }
  await logDeletions(env, done.map((x) => ({ ...x, at: new Date().toISOString(), by: staff.user_id, reason: 'manual' })))
  return { ok: true, deleted: done.length, refused }
}

// ---------- ถังขยะ: ลบแบบย้ายไปถังก่อน (เก็บ _trash/<key>) แล้วลบถาวรเมื่อครบจำนวนวัน ----------
const TRASH_DIR = '_trash'
const TRASH = TRASH_DIR + '/'
const origOf = (k) => k.slice(TRASH.length)
async function moveToTrash(store, items, by, reason) {
  const now = new Date().toISOString()
  for (let i = 0; i < items.length; i += 10) {
    await Promise.all(items.slice(i, i + 10).map(async (x) => {
      const obj = await store.get(x.key)
      if (!obj) return
      await store.put(TRASH + x.key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: { deletedAt: now, by: String(by), reason: String(reason) } })
      await store.delete(x.key)
    }))
  }
}
async function trashList(env, body) {
  const store = body.bucket === 'public' ? env.FILES_PUBLIC : env.FILES_PRIVATE
  const page = await store.list({ prefix: TRASH, include: ['customMetadata'], cursor: body.cursor || undefined, limit: 200 })
  const items = (page.objects || []).map((o) => ({ key: o.key, orig: origOf(o.key), bucket: body.bucket === 'public' ? 'public' : 'private', type: 'trash', size: o.size, uploaded: o.uploaded, deletedAt: o.customMetadata?.deletedAt || '', deletable: true, referenced: false }))
  return { ok: true, items, cursor: page.truncated ? page.cursor : null }
}
async function trashAction(env, body, staff, action) {
  const store = body.bucket === 'public' ? env.FILES_PUBLIC : env.FILES_PRIVATE
  const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter((k) => k.startsWith(TRASH) && !k.includes('..')).slice(0, 500)
  let done = 0
  const skipped = []
  for (const k of keys) {
    const obj = await store.get(k)
    if (!obj) continue
    if (action === 'restore') {
      const dst = origOf(k)
      if (await store.head(dst)) { skipped.push({ key: k, reason: 'มีไฟล์เดิมอยู่แล้ว' }); continue }
      await store.put(dst, obj.body, { httpMetadata: obj.httpMetadata })
    }
    await store.delete(k)
    done++
  }
  await logDeletions(env, keys.slice(0, done).map((k) => ({ key: origOf(k), type: action === 'restore' ? 'restore' : 'purge', bucket: body.bucket || 'private', at: new Date().toISOString(), by: staff.user_id, reason: action === 'restore' ? 'restore' : 'purge-manual' })))
  return { ok: true, done, skipped }
}
// ลบถาวรเฉพาะรายการในถังที่ครบจำนวนวัน (ดูจาก customMetadata.deletedAt)
async function purgeTrash(store, days) {
  const cut = Date.now() - days * DAY
  let cursor = undefined
  let pages = 0
  do {
    const page = await store.list({ prefix: TRASH, include: ['customMetadata'], cursor, limit: 500 })
    const old = (page.objects || []).filter((o) => new Date(o.customMetadata?.deletedAt || 0).getTime() <= cut).map((o) => o.key)
    for (let i = 0; i < old.length; i += DELETE_BATCH) await store.delete(old.slice(i, i + DELETE_BATCH))
    cursor = page.truncated ? page.cursor : undefined
    pages++
  } while (cursor && pages < MAX_LIST_PAGES)
}

// ลบอัตโนมัติ: ตรวจทุกไฟล์ (จำกัดจำนวนหน้า) แล้วลบเฉพาะที่เข้าเกณฑ์
async function runCleanup(env) {
  const days = await getRetention(env)
  let cursor = undefined
  let pages = 0
  let total = 0
  do {
    const page = await env.FILES_PRIVATE.list({ cursor, limit: 500 })
    const cands = (page.objects || []).filter((o) => ['slip', 'ref'].includes(fileTypeOf(o.key)))
    const ords = await ordersById(env, cands.map((o) => o.key.split('/')[0]))
    const doomed = []
    for (const o of cands) {
      const type = fileTypeOf(o.key)
      const ord = ords.get(o.key.split('/')[0]) || null
      const limit = type === 'slip' ? days.slipDays : days.refDays
      if (isClosedFor(ord, limit) && !referencedIn(ord, o.key)) doomed.push({ key: o.key, type, orderId: o.key.split('/')[0] })
    }
    for (let i = 0; i < doomed.length; i += DELETE_BATCH) {
      const batch = doomed.slice(i, i + DELETE_BATCH)
      await moveToTrash(env.FILES_PRIVATE, batch, 'auto', 'retention')
      await logDeletions(env, batch.map((x) => ({ ...x, at: new Date().toISOString(), by: 'auto', reason: 'retention' })))
      total += batch.length
    }
    cursor = page.truncated ? page.cursor : undefined
    pages++
  } while (cursor && pages < MAX_LIST_PAGES)
  await purgeTrash(env.FILES_PRIVATE, days.trashDays)
  await purgeTrash(env.FILES_PUBLIC, days.trashDays)
  return total
}
