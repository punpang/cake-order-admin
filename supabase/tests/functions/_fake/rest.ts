// ฐานข้อมูลจำลองแบบ PostgREST (ชุดย่อย) สำหรับเทสต์ Edge Function ทั้งฟังก์ชัน · แยกสคีมาตามหัว Accept-Profile / Content-Profile เหมือนของจริง
// รองรับ: GET (eq/neq/in · limit/offset) · POST แทรกแถว (กันซ้ำ id และ code) · PATCH · RPC ที่ฟังก์ชันใช้ · /auth/v1/user
// ใช้: installFakeRest({ users, staff }) ก่อน import ฟังก์ชัน แล้วอ่าน/ตั้งข้อมูลผ่าน fake.t["<schema>.<table>"]
export type Fake = {
  t: Record<string, any[]>
  calls: { method: string; path: string; schema: string }[]
  seq: Record<string, number>
  birth?: Record<string, unknown> // สิทธิเดือนเกิดที่ punpang_member_birth_for_quote คืน (ไม่ตั้ง = ไม่มีสิทธิ)
  reset: () => void
}

const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const val = (s: string) => decodeURIComponent(s)
function match(row: any, key: string, raw: string): boolean {
  if (['select', 'limit', 'offset', 'order'].includes(key)) return true
  const [op, ...rest] = raw.split('.')
  const v = val(rest.join('.'))
  if (op === 'eq') return String(row[key] ?? '') === v
  if (op === 'neq') return String(row[key] ?? '') !== v
  if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').includes(String(row[key] ?? ''))
  if (op === 'gte') return row[key] != null && String(row[key]) >= v
  if (op === 'is') return (row[key] ?? null) === (v === 'null' ? null : v)
  throw new Error(`ตัวกรองที่ไม่ได้จำลอง: ${key}=${raw}`)
}

// ตรรกะเดียวกับ SQL punpang__quote_check (supabase/migrations · สคีมาละตัว อ่านใบเสนอในสคีมาของตัวเอง)
function quoteCheck(quotes: any[], a: any): string {
  const q = quotes.find((x) => x.id === a.p_quote)
  if (!q) return 'not_found'
  if (!['customer_ok', 'converting', 'need_phone', 'accepted'].includes(q.status)) return 'not_ready'
  if (q.order_id != null && q.order_id !== a.p_order) return 'converted'
  if ((q.customer_id ?? null) !== (a.p_customer ?? null)) return 'customer'
  const pl = q.data?.payload || {}
  if (JSON.stringify(pl.items) !== JSON.stringify(a.p_items)) return 'items'
  if (JSON.stringify(pl.vat ?? null) !== JSON.stringify(a.p_vat ?? null)) return 'vat'
  if ((Number(pl.shippingFee) || 0) !== (Number(a.p_shipping) || 0)) return 'shipping'
  return 'ok'
}

// จำลอง punpang_quote_order_create: ตรวจ แทรกออร์เดอร์ และผูกใบเสนอในที่เดียว · รหัสผลลัพธ์เหมือนฟังก์ชันจริง
// ดัชนีกันซ้ำ (punpang_orders_quote_uniq): ใบเสนอเดียวมีออร์เดอร์ได้ไม่เกินหนึ่งใบ ทุกสถานะ
function quoteOrderCreate(fake: Fake, schema: string, a: any): any {
  const quotes = fake.t[`${schema}.punpang_quotes`] || []
  const orders = (fake.t[`${schema}.punpang_orders`] ||= [])
  const row = a.p_row || {}
  const oid = String(row.id || '')
  if (!oid) return { code: 'invalid' }
  const q = quotes.find((x: any) => x.id === a.p_quote)
  if (!q) return { code: 'not_found' }
  if (orders.some((o: any) => o.id === oid)) return { code: 'exists' }
  if (q.order_id != null && q.order_id !== oid) return { code: 'converted' }
  const code = quoteCheck([q], {
    p_quote: a.p_quote, p_order: oid, p_customer: row.customer_id ?? null,
    p_items: row.data?.items, p_vat: row.data?.vat ?? null, p_shipping: Number(row.data?.shippingFee) || 0,
  })
  if (code !== 'ok') return { code }
  if (orders.some((o: any) => o.data?.quoteId === a.p_quote)) return { code: 'converted' }
  const saved = { ...row, updated_at: new Date().toISOString() }
  orders.push(saved)
  q.order_id = oid
  q.status = 'accepted'
  return { code: 'ok', row: saved }
}

export function installFakeRest(opts: { host?: string; users: Record<string, string>; staff: Record<string, any> }): Fake {
  const host = opts.host || 'db.fake'
  const fake: Fake = { t: {}, calls: [], seq: {}, reset() { this.t = {}; this.calls = []; this.seq = {} } }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.host !== host) return realFetch(input, init)
    const p = url.pathname
    const schema = (req.method === 'GET' ? req.headers.get('accept-profile') : req.headers.get('content-profile')) || 'public'
    fake.calls.push({ method: req.method, path: p, schema })
    if (p === '/auth/v1/user') {
      const id = opts.users[(req.headers.get('authorization') || '').replace(/^Bearer /, '')]
      return id ? J({ id }) : J({ msg: 'invalid token' }, 401)
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length)
      const a = await req.json()
      if (fn === 'punpang_alloc_numbers') {
        const k = `${schema}|${a.p_prefix}|${a.p_day}`
        const start = (fake.seq[k] || 0) + 1
        fake.seq[k] = start + a.p_n - 1
        return J(start)
      }
      if (fn === 'punpang__quote_check') return J(quoteCheck(fake.t[`${schema}.punpang_quotes`] || [], a))
      if (fn === 'punpang_quote_order_create') return J(quoteOrderCreate(fake, schema, a))
      // สิทธิเดือนเกิด (punpang_member_birth_for_quote): ค่าเริ่มต้นไม่มีสิทธิ · เทสต์ที่ต้องการส่วนลดตั้ง fake.birth ได้
      if (fn === 'punpang_member_birth_for_quote') return J(fake.birth ?? { eligible: false, active: false, rate: 0, cap: 0, birthMult: null, cakeCategories: [] })
      throw new Error(`RPC ที่ไม่ได้จำลอง: ${fn}`)
    }
    const table = p.replace('/rest/v1/', '')
    if (table === 'punpang_staff') {
      const uid = val((url.searchParams.get('user_id') || '').replace(/^eq\./, ''))
      return J(opts.staff[uid] ? [opts.staff[uid]] : [])
    }
    const key = `${schema}.${table}`
    const list = (fake.t[key] ||= [])
    const filters = [...url.searchParams.entries()]
    const hit = () => list.filter((r) => filters.every(([k, v]) => match(r, k, v)))
    if (req.method === 'GET') {
      const off = Number(url.searchParams.get('offset') || 0)
      const lim = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity
      const all = hit()
      const res = J(structuredClone(all.slice(off, off + lim)))
      // Prefer: count=exact → จำนวนทั้งหมดในหัว Content-Range เหมือน PostgREST
      if ((req.headers.get('prefer') || '').includes('count=exact')) res.headers.set('content-range', `0-${Math.max(0, Math.min(all.length, lim) - 1)}/${all.length}`)
      return res
    }
    if (req.method === 'POST') {
      const body = await req.json()
      const out = []
      for (const row of Array.isArray(body) ? body : [body]) {
        if (list.some((r) => r.id === row.id)) return J({ code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` }, 409)
        if (row.code && list.some((r) => r.code === row.code)) return J({ code: '23505', message: `duplicate key value violates unique constraint "${table}_code_key"` }, 409)
        const saved = { at: new Date(Date.now()).toISOString(), ...structuredClone(row), updated_at: '2026-11-17T00:00:00.000000+00:00' }
        list.push(saved)
        out.push(saved)
      }
      return J(structuredClone(out), 201)
    }
    if (req.method === 'PATCH') {
      const patch = await req.json()
      const rows = hit()
      for (const r of rows) Object.assign(r, patch)
      return J(structuredClone(rows))
    }
    throw new Error(`คำขอที่ไม่ได้จำลอง: ${req.method} ${url}`)
  }) as typeof fetch
  return fake
}

// แคตาล็อกจากชุดข้อมูลอ้างอิงของการคิดราคา (src/lib/quotePrice.golden.json) ลงตาราง punpang_kv / punpang_items ของสคีมาจริง
export function seedCatalog(fake: Fake, cat: Record<string, any>) {
  fake.t['public.punpang_kv'] = Object.entries(cat).filter(([k]) => k !== 'retailItems').map(([id, v]) => ({ collection: 'config', id, data: { v } }))
  fake.t['public.punpang_items'] = (cat.retailItems || []).map((x: any) => ({ id: x.id, name: x.name, price: x.price, active: x.active, kind: 'retail', data: x }))
}

// ดึง handler ของ Edge Function (ไฟล์ index.ts เรียก Deno.serve ครั้งเดียวตอนโหลด)
export async function loadHandler(path: string): Promise<(r: Request) => Promise<Response>> {
  let h: any = null
  const prev = (Deno as any).serve
  ;(Deno as any).serve = (fn: any) => { h = fn; return { finished: Promise.resolve(), shutdown: async () => {} } }
  await import(path)
  ;(Deno as any).serve = prev
  if (!h) throw new Error(`โหลด handler ไม่สำเร็จ: ${path}`)
  return h
}

// ไคลเอนต์ supabase ฝั่งแอป (เฉพาะ functions.invoke) ที่ส่งเข้า handler ตรง · โหมดทดสอบใส่หัวแบบเดียวกับ src/lib/supabase.js
export function appClient(handlers: Record<string, (r: Request) => Promise<Response>>, token: string | null, test: boolean) {
  return {
    functions: {
      invoke: async (name: string, { body }: { body: unknown }) => {
        const h = handlers[name]
        if (!h) throw new Error(`ไม่มี handler ของ ${name}`)
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (token) headers.authorization = `Bearer ${token}`
        if (test) headers['x-punpang-mode'] = 'test'
        const res = await h(new Request(`http://fn.fake/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) }))
        if (res.ok) return { data: await res.json(), error: null }
        return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: res } }
      },
    },
  }
}
