// ตัวจำลอง supabase-js ที่แยกสคีมา (public / punpang_test) · ข้อมูลอยู่ใน globalThis.__DB.t["<schema>.<table>"]
// ใช้แทน npm:@supabase/supabase-js@2 ผ่าน importmap.json เฉพาะตอนรันเทสต์ (ไม่กระทบการ deploy)
const db = () => (globalThis as any).__DB as { t: Record<string, any[]>; users: Record<string, string> }
const get = (r: any, c: string) => (c.includes('->>') ? r[c.split('->>')[0]]?.[c.split('->>')[1]] : r[c])
class Q {
  op = 'select'; f: Array<(r: any) => boolean> = []; lim: number | null = null; patch: any = null; head = false
  constructor(public key: string) {}
  select(_c?: string, o?: any) { if (o?.head) this.head = true; return this }
  eq(c: string, v: any) { this.f.push((r) => get(r, c) === v); return this }
  neq(c: string, v: any) { this.f.push((r) => get(r, c) !== v); return this }
  gte(c: string, v: any) { this.f.push((r) => get(r, c) != null && String(get(r, c)) >= String(v)); return this }
  order() { return this }
  limit(n: number) { this.lim = n; return this }
  insert(p: any) { this.op = 'insert'; this.patch = p; return this }
  maybeSingle() { return this.run(true) }
  then(res?: (v: any) => any, rej?: (e: any) => any): Promise<any> { return this.run(false).then(res, rej) }
  async run(single: boolean) {
    const list = (db().t[this.key] ||= [])
    if (this.op === 'insert') { list.push({ at: new Date().toISOString(), ...structuredClone(this.patch) }); return { data: null, error: null } }
    let hit = list.filter((r) => this.f.every((g) => g(r)))
    if (this.lim != null) hit = hit.slice(0, this.lim)
    if (this.head) return { data: null, count: hit.length, error: null }
    if (single) return { data: hit[0] ? structuredClone(hit[0]) : null, error: null }
    return { data: structuredClone(hit), count: hit.length, error: null }
  }
}
export const createClient = (_u: string, _k: string, o?: any) => {
  const schema = o?.db?.schema || 'public'
  return {
    from: (t: string) => new Q(`${schema}.${t}`),
    auth: { getUser: async (jwt: string) => ({ data: { user: db().users[jwt] ? { id: db().users[jwt] } : null }, error: null }) },
    storage: { from: (_bucket: string) => ({ createSignedUrl: async (_path: string, _sec: number) => ({ data: { signedUrl: 'x' }, error: null }) }) },
  }
}
