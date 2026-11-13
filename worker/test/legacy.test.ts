// ทดสอบงานลบไฟล์เดิมใน Supabase Storage ตามอายุ
//  - punpang-chat: เก่ากว่า retention.chatMedia.days
//  - punpang-slips/manual/...: เก่ากว่า fileRetention.slipDays (ค่าเริ่มต้น 180)
//  - punpang-slips/<ออร์เดอร์>/...: เฉพาะออร์เดอร์ที่ delivered/cancelled และอัปเดตล่าสุดเกิน slipDays
//  - ไฟล์อื่นคงไว้ · ใช้ fetch จำลองแทน Supabase (ไม่ต่อระบบจริง)
import { assertEquals } from 'jsr:@std/assert@1'
import { runLegacyPrune } from '../src/index.js'

const DAY = 86_400_000
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString()
const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' }

type File = { bucket: string; path: string; created: string }
type Order = { status: string; updated_at: string }

// จำลอง Supabase: Storage (list/delete) · punpang_kv (ค่าตั้งค่า) · punpang_orders
function fakeSupabase(o: { files: File[]; orders: Record<string, Order>; kv?: Record<string, unknown>; failList?: string }) {
  const st = { files: [...o.files], deletes: [] as Array<{ bucket: string; prefixes: string[] }> }
  // รายการใต้ prefix: โฟลเดอร์มี id เป็น null (เหมือน Supabase) · ไฟล์มี id และ created_at
  const children = (bucket: string, prefix: string) => {
    const items = new Map<string, { name: string; id: string | null; created_at?: string }>()
    for (const f of st.files) {
      if (f.bucket !== bucket || (prefix && !f.path.startsWith(prefix + '/'))) continue
      const seg = (prefix ? f.path.slice(prefix.length + 1) : f.path).split('/')
      if (seg.length === 1) items.set(seg[0], { name: seg[0], id: 'file-id', created_at: f.created })
      else if (!items.has(seg[0])) items.set(seg[0], { name: seg[0], id: null })
    }
    return [...items.values()]
  }
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const list = /\/storage\/v1\/object\/list\/([^/?]+)$/.exec(url)
    if (list && method === 'POST') {
      if (list[1] === o.failList) return new Response('boom', { status: 500 })
      const body = JSON.parse(String(init?.body))
      return Response.json(children(list[1], body.prefix ?? ''))
    }
    const del = /\/storage\/v1\/object\/([^/?]+)$/.exec(url)
    if (del && method === 'DELETE') {
      const body = JSON.parse(String(init?.body))
      st.deletes.push({ bucket: del[1], prefixes: body.prefixes })
      st.files = st.files.filter((f) => !(f.bucket === del[1] && body.prefixes.includes(f.path)))
      return Response.json([])
    }
    if (url.includes('/rest/v1/punpang_kv')) {
      const id = /[?&]id=eq\.([^&]+)/.exec(url)?.[1]
      const v = id ? o.kv?.[id] : undefined
      return Response.json(v === undefined ? [] : [{ data: { v } }])
    }
    if (url.includes('/rest/v1/punpang_orders')) {
      return Response.json(Object.entries(o.orders).map(([id, x]) => ({ id, code: id, status: x.status, updated_at: x.updated_at, data: {} })))
    }
    return Response.json([])
  }
  return { st, fetchImpl }
}

Deno.test('ลบเฉพาะที่เข้าเกณฑ์อายุและกติกาออร์เดอร์ปิด ที่เหลือคงไว้', async () => {
  const sb = fakeSupabase({
    files: [
      { bucket: 'punpang-chat', path: 'staff/111/old.jpg', created: ago(40) },   // เกิน 7 วัน → ลบ
      { bucket: 'punpang-chat', path: 'staff/111/new.jpg', created: ago(5) },    // ยังไม่ถึง 7 วัน → เก็บ
      { bucket: 'punpang-chat', path: 'staff/222/mid.jpg', created: ago(10) },   // เกิน 7 วัน → ลบ
      { bucket: 'punpang-slips', path: 'a/x.jpg', created: ago(300) },           // ออร์เดอร์ a ปิดและอัปเดตเกิน 180 วัน → ลบ
      { bucket: 'punpang-slips', path: 'a/work/w.jpg', created: ago(300) },      // ชั้นลึกกว่าในโฟลเดอร์ออร์เดอร์เดียวกัน → ลบ
      { bucket: 'punpang-slips', path: 'b/y.jpg', created: ago(300) },           // ออร์เดอร์ b ปิดแต่อัปเดตเมื่อไม่นาน → เก็บ
      { bucket: 'punpang-slips', path: 'c/z.jpg', created: ago(300) },           // ออร์เดอร์ c ยังไม่ปิด → เก็บ
      { bucket: 'punpang-slips', path: 'missing/w.jpg', created: ago(300) },     // ไม่มีออร์เดอร์ → เก็บ
      { bucket: 'punpang-slips', path: 'manual/ch1/old.jpg', created: ago(200) }, // manual เกิน 180 วัน → ลบ
      { bucket: 'punpang-slips', path: 'manual/ch1/new.jpg', created: ago(3) },   // → เก็บ
    ],
    orders: {
      a: { status: 'delivered', updated_at: ago(200) },
      b: { status: 'delivered', updated_at: ago(10) },
      c: { status: 'awaiting_payment', updated_at: ago(300) },
    },
    kv: { retention: { chatMedia: { days: 7 } } },
  })
  const real = globalThis.fetch
  globalThis.fetch = sb.fetchImpl as typeof fetch
  try {
    assertEquals(await runLegacyPrune(env), 5)
  } finally {
    globalThis.fetch = real
  }
  assertEquals(sb.st.files.map((f) => `${f.bucket}/${f.path}`).sort(), [
    'punpang-chat/staff/111/new.jpg',
    'punpang-slips/b/y.jpg',
    'punpang-slips/c/z.jpg',
    'punpang-slips/manual/ch1/new.jpg',
    'punpang-slips/missing/w.jpg',
  ])
  assertEquals(
    sb.st.deletes.map((d) => `${d.bucket}:${d.prefixes.slice().sort().join(',')}`).sort(),
    ['punpang-chat:staff/111/old.jpg,staff/222/mid.jpg', 'punpang-slips:a/work/w.jpg,a/x.jpg,manual/ch1/old.jpg'],
  )
})

Deno.test('บักเก็ตใดขึ้นรายการไม่ได้ ไม่หยุดการลบของบักเก็ตอื่น', async () => {
  const sb = fakeSupabase({
    files: [
      { bucket: 'punpang-chat', path: 'staff/111/old.jpg', created: ago(40) },
      { bucket: 'punpang-slips', path: 'manual/ch1/old.jpg', created: ago(200) },
    ],
    orders: {},
    failList: 'punpang-chat',
  })
  const real = globalThis.fetch
  globalThis.fetch = sb.fetchImpl as typeof fetch
  try {
    assertEquals(await runLegacyPrune(env), 1)
  } finally {
    globalThis.fetch = real
  }
  assertEquals(sb.st.files.map((f) => `${f.bucket}/${f.path}`), ['punpang-chat/staff/111/old.jpg'])
})
