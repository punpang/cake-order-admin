// ตัวจำลอง supabase-js แบบแยกสคีมา (ชุดย่อยของ query builder) · ข้อมูลอยู่ใน globalThis.__DB.t["<schema>.<table>"]
// ใช้แทน npm:@supabase/supabase-js@2 ผ่าน import map เฉพาะตอนรันเทสต์ (ไม่กระทบการ deploy)
const db = () => (globalThis as any).__DB as { t: Record<string, any[]>; users?: Record<string, string> }
const get = (r: any, c: string) => (c.includes('->>') ? (r[c.split('->>')[0]]?.[c.split('->>')[1]] ?? null) : r[c])
// jsonb @> แบบ Postgres: วัตถุ = มีทุกคีย์ที่ต้องการ · อาร์เรย์ = ทุกสมาชิกที่ต้องการมีคู่ที่ครอบได้
const containsJson = (have: any, want: any): boolean => {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h) => containsJson(h, w)))
  if (want && typeof want === 'object') return !!have && typeof have === 'object' && Object.entries(want).every(([k, v]) => containsJson(have[k], v))
  return have === want
}
class Q {
  op = 'select'; f: Array<(r: any) => boolean> = []; lim: number | null = null; off = 0; patch: any = null; head = false; conflict = ''; ignoreDup = false
  constructor(public key: string) {}
  select(_c?: string, o?: any) { if (o?.head) this.head = true; return this }
  eq(c: string, v: any) { this.f.push((r) => get(r, c) === v); return this }
  neq(c: string, v: any) { this.f.push((r) => get(r, c) !== v); return this }
  gte(c: string, v: any) { this.f.push((r) => get(r, c) != null && String(get(r, c)) >= String(v)); return this }
  is(c: string, v: any) { this.f.push((r) => (get(r, c) ?? null) === v); return this }
  contains(c: string, v: any) { this.f.push((r) => containsJson(r[c], v)); return this }
  filter(c: string, op: string, v: any) { if (op === 'is') return this.is(c, v); if (op === 'eq') return this.eq(c, v); throw new Error(`filter ${op} ไม่ได้จำลอง`) }
  order(..._a: any[]) { return this }
  limit(n: number) { this.lim = n; return this }
  range(from: number, to: number) { this.off = from; this.lim = to - from + 1; return this }
  insert(p: any) { this.op = 'insert'; this.patch = p; return this }
  update(p: any) { this.op = 'update'; this.patch = p; return this }
  upsert(p: any, o?: any) { this.op = 'upsert'; this.patch = p; this.conflict = o?.onConflict || 'id'; this.ignoreDup = !!o?.ignoreDuplicates; return this }
  maybeSingle() { return this.run(true) }
  single() { return this.run(true) }
  then(res?: (v: any) => any, rej?: (e: any) => any): Promise<any> { return this.run(false).then(res, rej) }
  async run(single: boolean) {
    const list = (db().t[this.key] ||= [])
    if (this.op === 'insert') { for (const p of [].concat(this.patch) as any[]) list.push({ at: new Date().toISOString(), ...structuredClone(p) }); return { data: null, error: null } }
    if (this.op === 'upsert') {
      // คืนแถวที่ถูกเขียนจริง (ignoreDuplicates: แถวที่มีอยู่แล้วไม่ถูกคืน เหมือน ON CONFLICT DO NOTHING ... RETURNING)
      const written: any[] = []
      for (const p of [].concat(this.patch) as any[]) {
        const cur = list.find((r) => r[this.conflict] === p[this.conflict])
        if (!cur) { list.push(structuredClone(p)); written.push(structuredClone(p)) }
        else if (!this.ignoreDup) { Object.assign(cur, structuredClone(p)); written.push(structuredClone(cur)) }
      }
      return { data: written, error: null }
    }
    let hit = list.filter((r) => this.f.every((g) => g(r)))
    if (this.op === 'update') { for (const r of hit) Object.assign(r, structuredClone(this.patch)); return { data: structuredClone(hit), error: null } }
    if (this.lim != null) hit = hit.slice(this.off, this.off + this.lim)
    if (this.head) return { data: null, count: hit.length, error: null }
    if (single) return { data: hit[0] ? structuredClone(hit[0]) : null, error: null }
    return { data: structuredClone(hit), count: hit.length, error: null }
  }
}
export const createClient = (_u: string, _k: string, o?: any) => {
  const schema = o?.db?.schema || 'public'
  return {
    from: (t: string) => new Q(`${schema}.${t}`),
    auth: { getUser: async (jwt: string) => ({ data: { user: db().users?.[jwt] ? { id: db().users![jwt] } : null }, error: null }) },
    // rpc: เรียกฟังก์ชันที่เทสต์ลงทะเบียนไว้ใน globalThis.__RPC[ชื่อ] · ไม่มีฟังก์ชัน = error
    rpc: async (name: string, args: any) => {
      const f = (globalThis as any).__RPC?.[name]
      if (!f) return { data: null, error: { message: `ไม่ได้ลงทะเบียน rpc ${name}` } }
      return f(args)
    },
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, sec: number) => ({ data: { signedUrl: `https://signed.fake/${bucket}/${path}?ttl=${sec}` }, error: null }) }) },
  }
}
