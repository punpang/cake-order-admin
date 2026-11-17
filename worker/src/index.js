// punpang-files: เก็บ/เสิร์ฟไฟล์ใน R2
//  - รูปสาธารณะ (สินค้า/หน้าร้าน): GET /p/<key> จาก FILES_PUBLIC (แคชได้)
//  - รูปส่วนตัว (สลิป/รูปงาน/ไฟล์แนบแชท): เสิร์ฟด้วยลิงก์ลงลายเซ็นที่มีวันหมดอายุ GET /f/<key>?exp&sig จาก FILES_PRIVATE
//  - POST /sign   : ตรวจสิทธิ์ แล้วออกลิงก์ชั่วคราว (พนักงาน / ลูกค้าเจ้าของออร์เดอร์ / ลิงก์ออร์เดอร์)
//  - POST /upload : พนักงานที่ล็อกอินอัปโหลดรูป (ตรวจชนิดจากไบต์จริง ≤ 5 MB) · วิดีโอสื่อโฆษณา MP4/WebM ≤ 30 MB เฉพาะสาธารณะ/displayAds
//  - GET /p/<key> รองรับขอเป็นช่วง (Range) สำหรับเล่นวิดีโอ
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
// ---- เรียกจากฟังก์ชันของ Supabase (Bearer = คีย์ลับ FILES_SERVICE_KEY) ----
const serviceOk = (req, env) => { const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || ''); return !!env.FILES_SERVICE_KEY && !!m && safeEq(m[1], env.FILES_SERVICE_KEY) }
const validKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 200 && /^[A-Za-z0-9_\-\/]+\.(png|jpg|webp)$/.test(k) && !k.includes('..') && !k.includes('//') && !k.startsWith('/')
const clampTtl = (n) => { const x = Math.round(Number(n)); return Number.isFinite(x) && x >= 60 && x <= 3600 ? x : SIGN_TTL }

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
  return s && s.active === true ? s : null
}

// สิทธิ์ที่ต้องมีเพื่อเขียน/ลบไฟล์ (ตรงกับ storage policy ใน Supabase): manage ทำได้ทุกอย่าง
const hasAnyPerm = (staff, need) => (staff.perms || []).some((p) => p === 'manage' || need.includes(p))
// ไฟล์ส่วนตัว: <orderId>/work/… รูปงาน · <orderId>/ref/… รูปตัวอย่าง · นอกนั้น (<orderId>/…) สลิป
const needForPrivateKey = (key) => (/^[^/]+\/work(\/|$)/.test(key) ? ['workPhoto'] : /^[^/]+\/ref(\/|$)/.test(key) ? ['createOrder', 'editItems'] : ['reportPayment', 'confirmPayment'])
// กติกาการลบ: รูปงาน/รูปตัวอย่างตามเดิม · สลิปและไฟล์อื่น ลบได้เฉพาะผู้ยืนยันชำระ (ตรงกับ storage policy เดิม) · ผู้แจ้งชำระแก้/เพิ่มได้อย่างเดียว
const needForDelete = (key) => (/^[^/]+\/(work|ref)(\/|$)/.test(key) ? needForPrivateKey(key) : ['confirmPayment'])

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

// ไฟล์ส่วนตัวที่ "ไม่ใช่ไฟล์ของออร์เดอร์": ต้องมีสิทธิ์ตามประเภท (manage ได้ทุกอย่าง) · ไฟล์ของออร์เดอร์ (<orderId>/…) พนักงาน active ทุกคนยังดูได้เหมือนเดิม
//   chat/ staff/ = ไฟล์แชท · webchat/ = รูปที่ลูกค้าส่งในแชทของหน้าเว็บ/แอป · manual/ = สลิปที่เก็บไว้รอพนักงานผูกออร์เดอร์ · pay-qr/ = รูป QR รับเงินที่ส่งให้ลูกค้า
//   train/ = รูปชุดเทรนตัวอ่านสลิป (มีข้อมูลบัญชีผู้รับ) → เฉพาะ manage
const STAFF_PREFIX_PERMS = [
  ['chat/', ['chat']],
  ['staff/', ['chat']],
  ['webchat/', ['chat']],
  ['manual/', ['chat', 'reportPayment', 'confirmPayment']],
  ['pay-qr/', ['chat', 'reportPayment', 'confirmPayment']],
  ['train/', []],
]
const needForStaffPrefix = (key) => STAFF_PREFIX_PERMS.find(([p]) => key.startsWith(p))?.[1] ?? null

// สิทธิ์เห็นไฟล์: ไฟล์นอกออร์เดอร์ → พนักงานที่มีสิทธิ์ตามประเภท · ไฟล์ของออร์เดอร์ (<orderId>/...) → พนักงานที่มีสิทธิ์ตามประเภทไฟล์ (เหมือนตอนอัปโหลด) / ลูกค้าเจ้าของ / ลิงก์ออร์เดอร์
async function allowedToSee(req, env, key, body) {
  const staff = await staffOf(req, env)
  const need = needForStaffPrefix(key)
  if (need) return !!staff && hasAnyPerm(staff, need)
  if (staff) return hasAnyPerm(staff, needForPrivateKey(key))
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
// วิดีโอสื่อโฆษณาบนจอลูกค้า (เฉพาะบักเก็ตสาธารณะ โฟลเดอร์ displayAds): MP4 (กล่อง ftyp) · WebM (EBML)
const VIDEO_PREFIX = 'displayAds'
const VIDEO_MAX_MB = 30
const videoOf = (b) => {
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return { ext: 'mp4', type: 'video/mp4' }
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', type: 'video/webm' }
  return null
}
// ขอไฟล์เป็นช่วง (Range: bytes=a-b | a- | -n) → { offset, length } หรือ { suffix } · รูปแบบอื่น = null (ส่งทั้งไฟล์)
export function parseRange(h) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h || '').trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') return { suffix: Number(m[2]) }
  const offset = Number(m[1])
  if (m[2] === '') return { offset }
  const end = Number(m[2])
  return end >= offset ? { offset, length: end - offset + 1 } : null
}
const safePrefix = (p) => (/^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,60})?$/.test(p) ? p : null)
// ถอดรหัส %xx ใน path · เสีย (เช่น %E0%A4%A) คืน null แทนโยนข้อผิดพลาด (ไม่ให้ Worker ล้มเป็น 500)
const safeDecode = (v) => { try { return decodeURIComponent(v) } catch { return null } }

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req, env) })
    const url = new URL(req.url)
    const path = url.pathname

    // ---- ไฟล์สาธารณะ ----
    if (req.method === 'GET' && path.startsWith('/p/')) {
      const key = safeDecode(path.slice(3))
      // ถังขยะ (_trash/) ไม่เสิร์ฟทาง /p/ แม้ไฟล์ยังอยู่ในบักเก็ต (กู้คืนได้เฉพาะพนักงาน)
      if (key === null || key.startsWith('_trash/')) return new Response('ไม่พบไฟล์', { status: 404, headers: corsHeaders(req, env) })
      // วิดีโอเล่นแบบขอเป็นช่วง (Range) · ตอบ 206 + Content-Range · ช่วงเกินไฟล์ = 416
      const range = parseRange(req.headers.get('Range'))
      let obj
      try { obj = await env.FILES_PUBLIC.get(key, range ? { range } : undefined) } catch { obj = undefined }
      if (obj === undefined) {
        const head = await env.FILES_PUBLIC.head(key)
        return new Response('ช่วงไฟล์ไม่ถูกต้อง', { status: head ? 416 : 404, headers: { ...corsHeaders(req, env), ...(head ? { 'Content-Range': `bytes */${head.size}` } : {}) } })
      }
      if (!obj) return new Response('ไม่พบไฟล์', { status: 404, headers: corsHeaders(req, env) })
      const base = { ...corsHeaders(req, env), 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes' }
      if (range && obj.range) {
        const size = obj.size
        const start = 'suffix' in obj.range ? Math.max(0, size - obj.range.suffix) : obj.range.offset
        const len = 'suffix' in obj.range ? size - start : Math.min(obj.range.length ?? size - start, size - start)
        if (start >= size || len <= 0) return new Response('ช่วงไฟล์ไม่ถูกต้อง', { status: 416, headers: { ...corsHeaders(req, env), 'Content-Range': `bytes */${size}` } })
        return new Response(obj.body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${start + len - 1}/${size}`, 'Content-Length': String(len) } })
      }
      return new Response(obj.body, { headers: base })
    }

    // ---- ไฟล์ส่วนตัวด้วยลิงก์ลงลายเซ็น ----
    if (req.method === 'GET' && path.startsWith('/f/')) {
      const key = safeDecode(path.slice(3))
      const exp = Number(url.searchParams.get('exp'))
      if (key === null || !(await verifySig(env, key, exp, url.searchParams.get('sig')))) return new Response('ลิงก์หมดอายุหรือไม่ถูกต้อง', { status: 403, headers: corsHeaders(req, env) })
      const obj = await env.FILES_PRIVATE.get(key)
      if (!obj) return new Response('ไม่พบไฟล์', { status: 404, headers: corsHeaders(req, env) })
      return new Response(obj.body, { headers: { ...corsHeaders(req, env), 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' } })
    }

    if (req.method !== 'POST') return json(req, env, { error: 'method' }, 405)

    // ---- เรียกจากฟังก์ชันของ Supabase (คีย์ลับ) ----
    if (path.startsWith('/svc/')) return serviceOk(req, env) ? svcRoute(req, env, url, path) : json(req, env, { error: 'unauthorized' }, 401)

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
      const need = bucket === 'public' ? ['editItems'] : prefix.startsWith('staff/') ? ['chat'] : needForPrivateKey(`${prefix}/x`)
      if (!hasAnyPerm(staff, need)) return json(req, env, { error: 'ไม่มีสิทธิ์อัปโหลดไฟล์ประเภทนี้' }, 403)
      // ไม่อ่านไฟล์ที่ใหญ่เกินเพดานสูงสุด (กันหน่วยความจำ Worker) · ตรวจละเอียดตามชนิดอีกชั้นหลังอ่าน
      const declared = Number(req.headers.get('Content-Length') || 0)
      if (declared > VIDEO_MAX_MB * 1024 * 1024) return json(req, env, { error: `ไฟล์ใหญ่เกิน ${VIDEO_MAX_MB} MB` }, 413)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (bytes.length === 0) return json(req, env, { error: 'ไฟล์ว่าง' }, 400)
      const video = bucket === 'public' && prefix === VIDEO_PREFIX ? videoOf(bytes) : null
      const kind = video || extOf(bytes)
      if (!kind) return json(req, env, { error: prefix === VIDEO_PREFIX ? 'ไฟล์ไม่ใช่รูปหรือวิดีโอที่รองรับ (PNG / JPG / WEBP / MP4 / WebM)' : 'ไฟล์ไม่ใช่รูปภาพที่รองรับ (PNG / JPG / WEBP)' }, 400)
      const maxMB = video ? VIDEO_MAX_MB : (await getImageLimits(env)).maxMB
      if (bytes.length > maxMB * 1024 * 1024) return json(req, env, { error: `ไฟล์ใหญ่เกิน ${maxMB} MB` }, 400)
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
      if (keys.some((k) => !hasAnyPerm(staff, needForDelete(k)))) return json(req, env, { error: 'ไม่มีสิทธิ์ลบไฟล์ประเภทนี้' }, 403)
      // ทุกการลบต้องผ่านถังขยะก่อน (กู้คืนได้จนกว่าจะครบจำนวนวันในถัง)
      if (keys.length) await moveToTrash(env.FILES_PRIVATE, keys.map((key) => ({ key })), staff.user_id, 'app')
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
    ctx.waitUntil(Promise.allSettled([runCleanup(env), runTrainPrune(env), runLegacyPrune(env)]))
  },
}

// ---------- เรียกจากฟังก์ชันของ Supabase (svc) ----------
async function svcRoute(req, env, url, path) {
  if (path === '/svc/upload') {
    const prefix = safePrefix(url.searchParams.get('prefix') || '')
    if (!prefix || url.searchParams.get('bucket') !== 'private') return json(req, env, { error: 'พารามิเตอร์ไม่ถูกต้อง' }, 400)
    const bytes = new Uint8Array(await req.arrayBuffer())
    const lim = await getImageLimits(env)
    if (bytes.length === 0 || bytes.length > lim.maxMB * 1024 * 1024) return json(req, env, { error: `ไฟล์ว่างหรือใหญ่เกิน ${lim.maxMB} MB` }, 400)
    const kind = extOf(bytes)
    if (!kind) return json(req, env, { error: 'ไฟล์ไม่ใช่รูปภาพที่รองรับ (PNG / JPG / WEBP)' }, 400)
    const key = `${prefix}/${rand()}.${kind.ext}`
    await env.FILES_PRIVATE.put(key, bytes, { httpMetadata: { contentType: kind.type } })
    return json(req, env, { key, ref: `r2://private/${key}` })
  }
  if (path === '/svc/sign') {
    const body = await req.json().catch(() => ({}))
    const key = String(body.key || '')
    if (!validKey(key)) return json(req, env, { error: 'key ไม่ถูกต้อง' }, 400)
    const exp = Math.floor(Date.now() / 1000) + clampTtl(body.ttl)
    const sig = await hmacHex(env.SIGN_KEY, `${key}|${exp}`)
    return json(req, env, { url: `${url.origin}/f/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`, exp })
  }
  if (path === '/svc/delete') {
    const body = await req.json().catch(() => ({}))
    const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter(validKey).slice(0, 100)
    if (keys.length) await env.FILES_PRIVATE.delete(keys)
    return json(req, env, { ok: true, deleted: keys.length })
  }
  return json(req, env, { error: 'ไม่พบเส้นทาง' }, 404)
}

// รูปชุดเทรน (train/…): ลบถาวรเมื่อครบ 30 วัน (ไม่ผ่านถังขยะ) แล้วลบรายการ slipTrain ที่เก่ากว่านั้นในฐานข้อมูลด้วย
const TRAIN_DAYS = 30
export async function runTrainPrune(env) {
  const cut = Date.now() - TRAIN_DAYS * DAY
  let cursor = undefined
  let pages = 0
  let removed = 0
  do {
    const page = await env.FILES_PRIVATE.list({ prefix: 'train/', cursor, limit: 500 })
    const old = (page.objects || []).filter((o) => o.uploaded && new Date(o.uploaded).getTime() <= cut).map((o) => o.key)
    for (let i = 0; i < old.length; i += DELETE_BATCH) {
      const batch = old.slice(i, i + DELETE_BATCH)
      await env.FILES_PRIVATE.delete(batch)
      removed += batch.length
    }
    cursor = page.truncated ? page.cursor : undefined
    pages++
  } while (cursor && pages < MAX_LIST_PAGES)
  await fetch(`${env.SUPABASE_URL}/rest/v1/punpang_records?collection=eq.slipTrain&data->>at=lt.${encodeURIComponent(new Date(cut).toISOString())}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'return=minimal' },
  })
  return removed
}

// ---------- ไฟล์เดิมใน Supabase Storage (punpang-slips, punpang-chat): ลบตามอายุ ----------
// ไม่รับไฟล์ใหม่แล้ว · กติกา:
//  - punpang-chat: เก่ากว่า retention.chatMedia.days (ค่าเริ่มต้น 30 วัน)
//  - punpang-slips/manual/<แชท>/...: เก่ากว่า fileRetention.slipDays (ค่าเริ่มต้น 180 วัน)
//  - punpang-slips/<ออร์เดอร์>/...: เฉพาะออร์เดอร์ที่ปิดแล้ว (ส่งมอบ/ยกเลิก) และอัปเดตล่าสุดเกิน slipDays
// หมายเหตุ: ข้อมูลในฐานข้อมูลที่ยังอ้างถึงไฟล์เหล่านี้จะไม่มีรูปหลังไฟล์ถูกลบ
const LEGACY_BUCKETS = ['punpang-slips', 'punpang-chat']
const LEGACY_DEPTH = 3
const LEGACY_BATCH = 100
const sbStorage = (env, method, path, body) => fetch(`${env.SUPABASE_URL}/storage/v1${path}`, {
  method,
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})
// รายการไฟล์ทั้งบักเก็ต: เดินตามโฟลเดอร์ไม่เกิน LEGACY_DEPTH ชั้น
async function listLegacy(env, bucket) {
  const out = []
  let frontier = ['']
  for (let depth = 0; depth < LEGACY_DEPTH && frontier.length; depth++) {
    const next = []
    for (const prefix of frontier) {
      for (let offset = 0; ; offset += 1000) {
        const r = await sbStorage(env, 'POST', `/object/list/${bucket}`, { prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
        if (!r.ok) throw new Error(`list ${bucket} ${r.status}`)
        const items = await r.json()
        for (const it of items) {
          const path = prefix ? `${prefix}/${it.name}` : it.name
          if (it.id === null) next.push(path)
          else out.push({ path, created: it.created_at })
        }
        if (items.length < 1000) break
      }
    }
    frontier = next
  }
  return out
}
async function getChatMediaDays(env) {
  const r = await sbFetch(env, '/rest/v1/punpang_kv?collection=eq.config&id=eq.retention&select=data')
  const v = r.ok ? (await r.json())[0]?.data?.v : null
  const d = Math.round(Number(v?.chatMedia?.days))
  return Number.isFinite(d) && d >= 1 && d <= 3650 ? d : 30
}
// ลบไฟล์เดิมตามกติกา · คืนจำนวนที่ลบ (บักเก็ตที่ผิดพลาดถูกข้าม ไม่หยุดบักเก็ตอื่น)
export async function runLegacyPrune(env) {
  const ret = await getRetention(env)
  const chatDays = await getChatMediaDays(env)
  const now = Date.now()
  const aged = (t, days) => !!t && now - new Date(t).getTime() >= days * DAY
  let removed = 0
  for (const bucket of LEGACY_BUCKETS) {
    try {
      const files = await listLegacy(env, bucket)
      // โฟลเดอร์ชั้นบนสุดของ punpang-slips (ยกเว้น manual/) คือรหัสออร์เดอร์
      const orderFolders = bucket === 'punpang-slips'
        ? files.filter((f) => f.path.includes('/') && !f.path.startsWith('manual/')).map((f) => f.path.split('/')[0])
        : []
      const ords = await ordersById(env, orderFolders)
      const doomed = files.filter((f) => {
        const top = f.path.split('/')[0]
        if (bucket === 'punpang-chat') return aged(f.created, chatDays)
        if (top === 'manual') return aged(f.created, ret.slipDays)
        const o = f.path.includes('/') ? ords.get(top) : null
        return !!o && ORDER_CLOSED.includes(o.status) && aged(o.updated_at, ret.slipDays)
      }).map((f) => f.path)
      for (let i = 0; i < doomed.length; i += LEGACY_BATCH) {
        const batch = doomed.slice(i, i + LEGACY_BATCH)
        const r = await sbStorage(env, 'DELETE', `/object/${bucket}`, { prefixes: batch })
        if (!r.ok) throw new Error(`delete ${bucket} ${r.status}`)
        removed += batch.length
      }
    } catch (e) {
      console.error('legacy-prune', bucket, String(e?.message || e))
    }
  }
  return removed
}

// ---------- การลบไฟล์ ----------
const MAX_LIST_PAGES = 40
const DELETE_BATCH = 500
const clampDays = (n, d) => { const x = Math.round(Number(n)); return Number.isFinite(x) && x >= 30 && x <= 3650 ? x : d }
// ประเภทไฟล์จาก key: <orderId>/work/... = รูปงาน · <orderId>/ref/... = รูปอ้างอิง · <orderId>/<ไฟล์> = สลิป
export function fileTypeOf(key) {
  const parts = String(key).split('/')
  if (parts[0] === TRASH_DIR) return 'trash'
  if (parts[0] === 'train') return 'other' // รูปชุดเทรน ไม่ใช่ไฟล์ของออร์เดอร์ (ลบด้วย runTrainPrune)
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
// อ่านทุกแถวของตาราง: PostgREST ตัดที่ 1,000 แถวต่อคำขอ (เดิมอ่านแค่หน้าแรก → รูปที่ถูกอ้างในแถวที่ 1,001+ ถูกนับว่าไม่ถูกใช้)
// อ่านไม่สำเร็จ = โยนข้อผิดพลาด (ไม่ตัดสินว่ารูปไม่ถูกใช้จากข้อมูลที่ไม่ครบ)
export async function sbAll(env, path, order) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const r = await sbFetch(env, `${path}&order=${order}&limit=1000&offset=${off}`)
    if (!r.ok) throw new Error(`อ่านข้อมูล ${path.split('?')[0]} ไม่สำเร็จ (${r.status})`)
    const rows = await r.json()
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}
export async function publicRefText(env) {
  const sources = [
    ['/rest/v1/punpang_items?select=data', 'id'],
    ['/rest/v1/punpang_kv?select=data', 'collection,id'],
    ['/rest/v1/punpang_records?select=data', 'id'],
    ['/rest/v1/punpang_orders?select=data', 'id'],
  ]
  const parts = []
  for (const [path, order] of sources) parts.push(JSON.stringify(await sbAll(env, path, order)))
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
    items.push({ key: o.key, type, orderId: o.key.split('/')[0], code: ord?.code || '', status: ord?.status || '', size: o.size, uploaded: o.uploaded, referenced: referencedIn(ord, o.key), deletable: true })
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
    if (type === 'other') refused.push({ key: k, reason: 'ไม่รู้จักประเภทไฟล์' })
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
