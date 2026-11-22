// ตัวจำลอง supabase-js (ชุดย่อยของ query builder ที่ customer-auth ใช้) · ข้อมูลอยู่ใน globalThis.__DB
// ใช้แทน npm:@supabase/supabase-js@2 ผ่าน importmap.json เฉพาะตอนรันเทสต์ (ไม่กระทบการ deploy)
const db = () => (globalThis as any).__DB as { t: Record<string, any[]>; hooks: Record<string, any>; tick: number }
const get = (r: any, c: string) => (c.includes('->>') ? r[c.split('->>')[0]]?.[c.split('->>')[1]] : r[c])
class Q {
  op = 'select'; f: Array<(r: any) => boolean> = []; ord: [string, boolean] | null = null; lim: number | null = null
  patch: any = null; wantCount = false; head = false
  constructor(public table: string) {}
  select(_c?: string, o?: any) { if (o?.count) this.wantCount = true; if (o?.head) this.head = true; return this }
  eq(c: string, v: any) { this.f.push((r) => get(r, c) === v); return this }
  neq(c: string, v: any) { this.f.push((r) => get(r, c) !== v); return this }
  gte(c: string, v: any) { this.f.push((r) => get(r, c) != null && String(get(r, c)) >= String(v)); return this }
  is(c: string, v: any) { this.f.push((r) => (get(r, c) ?? null) === v); return this }
  order(c: string, o?: any) { this.ord = [c, o?.ascending !== false]; return this }
  limit(n: number) { this.lim = n; return this }
  update(p: any) { this.op = 'update'; this.patch = p; return this }
  insert(p: any) { this.op = 'insert'; this.patch = p; return this }
  delete() { this.op = 'delete'; return this }
  maybeSingle() { return this.run(true) }
  then(res?: (v: any) => any, rej?: (e: any) => any): Promise<any> { return this.run(false).then(res, rej) }
  async run(single: boolean) {
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)))
    const D = db(); const list = (D.t[this.table] ||= [])
    if (this.op === 'insert') { list.push(structuredClone(this.patch)); return { data: null, error: null } }
    let hit = list.filter((r) => this.f.every((g) => g(r)))
    if (this.op === 'update') {
      const h = D.hooks[`beforeUpdate:${this.table}`]; if (h) { D.hooks[`beforeUpdate:${this.table}`] = null; h(list) }
      hit = list.filter((r) => this.f.every((g) => g(r)))
      for (const r of hit) { Object.assign(r, this.patch); if ('updated_at' in r) r.updated_at = new Date(Date.UTC(2026, 10, 14, 3, 0, 0, 0) + ++D.tick).toISOString().replace('Z', '000+00:00') }
      return { data: hit.map((r) => structuredClone(r)), error: null }
    }
    if (this.op === 'delete') { D.t[this.table] = list.filter((r) => !hit.includes(r)); return { data: null, error: null } }
    if (this.ord) { const [c, asc] = this.ord; hit = [...hit].sort((a, b) => (String(get(a, c)) < String(get(b, c)) ? -1 : 1) * (asc ? 1 : -1)) }
    if (this.lim != null) hit = hit.slice(0, this.lim)
    if (this.head) return { data: null, count: hit.length, error: null }
    if (single) return { data: hit[0] ? structuredClone(hit[0]) : null, error: null }
    return { data: structuredClone(hit), error: null, ...(this.wantCount ? { count: hit.length } : {}) }
  }
}
export const createClient = (_u: string, _k: string, _o?: any) => ({
  from: (t: string) => new Q(t),
  // rpc: เรียก hooks['rpc:<ชื่อฟังก์ชัน>'] ของเทสต์ · ไม่มี hook = ตอบ error (เหมือนฟังก์ชันไม่มีในฐานข้อมูล)
  rpc: async (fn: string, args: any) => {
    const h = db().hooks[`rpc:${fn}`]
    return h ? h(args) : { data: null, error: { message: `ไม่มีฟังก์ชัน ${fn} ในตัวจำลอง` } }
  },
  storage: { from: (_bucket: string) => ({ createSignedUrl: async (_path: string, _sec: number) => ({ data: { signedUrl: 'x' } }) }) },
})
