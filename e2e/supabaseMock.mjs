// เซิร์ฟเวอร์ Supabase จำลองสำหรับ e2e (โหมดเชื่อม Supabase ของแอปจริง) · ไม่แตะฐานข้อมูลจริง
// จำลองเฉพาะที่แอปใช้: Auth (รหัสผ่าน) · PostgREST (ตัวกรอง/เรียง/แบ่งหน้า/นับ/เขียน) · rpc · Edge Function (คืน {}) · Realtime ปฏิเสธ (แอปใช้รอบ poll)
// ข้อจำกัด: ไม่มี RLS · ตัวกรองเฉพาะรูปแบบที่แอปส่ง
import http from 'node:http'

const TOKEN = 'mock-access-token'
const USER = { id: 'u-staff', aud: 'authenticated', role: 'authenticated', email: 'staff@test.local', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }

// ค่าของคอลัมน์ (รองรับ data->>key และ data->key)
const colOf = (r, c) => {
  const m = c.match(/^(\w+)->>?(.+)$/)
  if (!m) return r[c]
  let v = r[m[1]]
  for (const k of m[2].split(/->>?/)) v = v == null ? undefined : v[k.replace(/^'|'$/g, '')]
  return v
}
const unq = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)
const listOf = (v) => v.replace(/^\(|\)$/g, '').split(',').map((x) => unq(x.trim()))
const likeRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', 'is')
const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)

// แปลง "op.value" → ฟังก์ชันตรวจ
function opTest(c, expr) {
  let neg = false
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4) }
  const i = expr.indexOf('.')
  const op = expr.slice(0, i)
  const raw = expr.slice(i + 1)
  const v = unq(raw)
  const t = (r) => {
    const x = colOf(r, c)
    switch (op) {
      case 'eq': return x != null && String(x) === v
      case 'neq': return x != null && String(x) !== v
      case 'gt': return x != null && cmp(String(x), v) > 0
      case 'gte': return x != null && cmp(String(x), v) >= 0
      case 'lt': return x != null && cmp(String(x), v) < 0
      case 'lte': return x != null && cmp(String(x), v) <= 0
      case 'in': return x != null && listOf(raw).includes(String(x))
      case 'is': return v === 'null' ? x == null : v === 'true' ? x === true : v === 'false' ? x === false : false
      case 'like': case 'ilike': return x != null && likeRe(v).test(String(x))
      case 'cs': { try { const want = JSON.parse(v); return JSON.stringify(x ?? null).includes(JSON.stringify(want).slice(1, -1)) } catch { return false } }
      default: throw new Error(`ตัวกรองที่ยังไม่รองรับ: ${op}`)
    }
  }
  return neg ? (r) => { const x = colOf(r, c); return op === 'is' ? !t(r) : x != null && !t(r) } : t
}
// or=(a.eq.1,b.gte."x") · แยกตามจุลภาคระดับบนสุด
function splitTop(s) {
  const out = []
  let d = 0, q = false, cur = ''
  for (const ch of s) {
    if (ch === '"') q = !q
    if (!q && ch === '(') d++
    if (!q && ch === ')') d--
    if (!q && !d && ch === ',') { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
function orTest(expr) {
  const parts = splitTop(expr.replace(/^\(|\)$/g, '')).map((p) => {
    if (p.startsWith('and(')) { const ts = splitTop(p.slice(4, -1)).map(condTest); return (r) => ts.every((t) => t(r)) }
    return condTest(p)
  })
  return (r) => parts.some((t) => t(r))
}
function condTest(p) {
  const m = p.match(/^([\w>-]+?(?:->>?[\w']+)*)\.(.+)$/)
  return opTest(m[1], m[2])
}

const PARAMS_SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
function parseQuery(url) {
  const filters = []
  for (const [k, v] of url.searchParams) {
    if (PARAMS_SKIP.has(k)) continue
    if (k === 'or') filters.push(orTest(v))
    else if (k === 'and') { const ts = splitTop(v.replace(/^\(|\)$/g, '')).map(condTest); filters.push((r) => ts.every((t) => t(r))) }
    else filters.push(opTest(k, v))
  }
  const order = (url.searchParams.get('order') || '').split(',').filter(Boolean).map((o) => { const [c, dir = 'asc'] = o.split('.'); return [c, dir === 'desc'] })
  return { filters, order, limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : null, offset: Number(url.searchParams.get('offset') || 0), select: url.searchParams.get('select') || '*' }
}
// เลือกคอลัมน์ (ชื่อตรง ๆ หรือ alias:col) · * = ทั้งหมด
function project(r, select) {
  if (select === '*' || !select) return { ...r }
  const o = {}
  for (const part of splitTop(select)) {
    const [alias, col] = part.includes(':') ? part.split(':') : [null, part]
    const c = col.trim()
    const name = alias || c.replace(/^.*->>?/, '')
    o[name] = colOf(r, c)
  }
  return o
}

export function startSupabaseMock({ __rpc = {}, __functions = {}, ...tables } = {}) {
  const db = tables
  const log = []
  let seq = 0
  let clock = Date.now()
  const stamp = () => new Date((clock = Math.max(clock + 1, Date.now()))).toISOString()
  const keysOf = (t) => (t === 'punpang_kv' || t === 'punpang_records' ? ['collection', 'id'] : t === 'punpang_staff' ? ['user_id'] : ['id'])
  const rpc = { // __rpc = คำตอบ RPC ที่เทสต์กำหนดเอง (ใช้แทนของเดิมที่ชื่อเดียวกัน)
    punpang_alloc_numbers: ({ p_n }) => { const s = ++seq * 1000; return Array.from({ length: p_n || 1 }, (_, i) => s + i) },
    ...__rpc,
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range', ...headers })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    if (req.method === 'OPTIONS') return send(204)
    let raw = ''
    for await (const ch of req) raw += ch
    const body = raw ? JSON.parse(raw) : null
    const p = url.pathname

    if (p.startsWith('/auth/v1/')) {
      if (p === '/auth/v1/token') {
        if (body?.email !== USER.email || body?.password !== 'test-password') return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
        return send(200, { access_token: TOKEN, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'mock-refresh', user: USER })
      }
      if (p === '/auth/v1/user') return req.headers.authorization === `Bearer ${TOKEN}` ? send(200, USER) : send(401, { message: 'no session' })
      if (p === '/auth/v1/logout') return send(204)
      return send(200, {})
    }
    if (p.startsWith('/functions/v1/')) {
      const fn = p.slice('/functions/v1/'.length)
      log.push({ fn, id: body?.id })
      // order-create กับออร์เดอร์ที่มีแล้ว = 409 exists (เหมือนของจริง) · อื่น ๆ คืน {}
      if (fn === 'order-create' && (db.punpang_orders || []).some((r) => r.id === body?.id)) return send(409, { error: 'ออร์เดอร์นี้บันทึกแล้ว', code: 'exists' })
      // คำตอบของ Edge Function ที่เทสต์กำหนดเอง (เช่น customer-auth ของบัญชีลูกค้า)
      if (__functions[fn]) return send(200, __functions[fn](body || {}))
      return send(200, {})
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length)
      log.push({ rpc: fn, body })
      return send(200, rpc[fn] ? rpc[fn](body || {}) : null)
    }
    if (!p.startsWith('/rest/v1/')) return send(404, { message: 'not found' })

    const table = p.slice('/rest/v1/'.length)
    const rows = (db[table] ||= [])
    let q
    try { q = parseQuery(url) } catch (e) { return send(400, { message: e.message }) }
    const match = rows.filter((r) => q.filters.every((f) => f(r)))
    const prefer = String(req.headers.prefer || '')
    const wantCount = prefer.includes('count=exact')

    if (req.method === 'GET' || req.method === 'HEAD') {
      let out = [...match]
      if (q.order.length) out.sort((a, b) => { for (const [c, desc] of q.order) { const d = cmp(colOf(a, c), colOf(b, c)); if (d) return desc ? -d : d } return 0 })
      let from = q.offset, to = q.limit != null ? from + q.limit - 1 : Infinity
      const range = req.headers.range?.match(/(\d+)-(\d+)/)
      if (range) { from = Number(range[1]); to = Math.min(to, Number(range[2])) }
      out = out.slice(from, to + 1)
      const headers = { 'content-range': `${out.length ? `${from}-${from + out.length - 1}` : '*'}/${wantCount ? match.length : '*'}` }
      log.push({ table, method: 'GET', sent: req.method === 'HEAD' ? 0 : out.length, q: url.search })
      const accept = String(req.headers.accept || '')
      if (req.method === 'HEAD') return send(200, undefined, headers)
      const data = out.map((r) => project(r, q.select))
      if (accept.includes('vnd.pgrst.object')) return data.length === 1 ? send(200, data[0], headers) : send(406, { code: 'PGRST116', details: `The result contains ${data.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, headers)
      return send(200, data, headers)
    }
    if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body]
      const keys = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean)
      const k = keys.length ? keys : keysOf(table)
      const upsert = prefer.includes('resolution=merge-duplicates')
      const out = []
      for (const it of list) {
        const row = { ...it }
        if (row.updated_at === undefined) row.updated_at = stamp()
        if (row.created_at === undefined) row.created_at = row.updated_at
        const i = rows.findIndex((r) => k.every((c) => r[c] === row[c]))
        if (i >= 0) {
          if (!upsert) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint' })
          rows[i] = { ...rows[i], ...row, updated_at: stamp() }
          out.push(rows[i])
        } else { rows.push(row); out.push(row) }
      }
      log.push({ table, method: 'POST', n: out.length })
      return prefer.includes('return=representation') ? send(201, out.map((r) => project(r, q.select))) : send(201)
    }
    if (req.method === 'PATCH') {
      const t = stamp()
      for (const r of match) Object.assign(r, body, { updated_at: t })
      log.push({ table, method: 'PATCH', n: match.length, ids: match.map((r) => r.id), keys: Object.keys(body || {}) })
      const headers = wantCount ? { 'content-range': `*/${match.length}` } : {}
      return prefer.includes('return=representation') ? send(200, match.map((r) => project(r, q.select)), headers) : send(204, undefined, headers)
    }
    if (req.method === 'DELETE') {
      for (const r of match) rows.splice(rows.indexOf(r), 1)
      log.push({ table, method: 'DELETE', n: match.length })
      return send(204)
    }
    return send(405, { message: 'method' })
  })
  // Realtime (WebSocket): ปฏิเสธ → แอปใช้รอบ poll
  server.on('upgrade', (_req, socket) => socket.destroy())
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, db, log, user: USER, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }) })))
}
