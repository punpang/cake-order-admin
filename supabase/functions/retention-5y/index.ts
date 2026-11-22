import { modeOf, refuseInTest } from '../_shared/mode.ts'
// ระยะเก็บ 5 ปี · เรียกทุกวันจาก pg_cron ด้วย x-cron-key
// ฐานข้อมูลตัดสินทั้งหมด (punpang_retention5y_run): ทำให้ออร์เดอร์นิรนาม ยกยอดสมาชิก และใส่คิวไฟล์ที่ต้องลบ
// ฟังก์ชันนี้ทำแค่ลบไฟล์ใน R2 ตามคิวที่ฐานข้อมูลส่งมา แล้วยืนยันกลับเป็นชุด (ack) · ไฟล์ที่ลบไม่สำเร็จยังอยู่ในคิว รอบถัดไปลองใหม่
// โหมดเริ่มต้น off = ไม่ทำอะไร · report = อ่านอย่างเดียว
import { createClient } from 'npm:@supabase/supabase-js@2'
import { filesEnv, svcDelete } from '../_shared/filesvc.ts'

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// คีย์ไฟล์ต้องตรงกับที่ฐานข้อมูลกรองไว้ (punpang__ret_valid_key) และกฎของ Worker (validKey)
const KEY_RE = /^[A-Za-z0-9_/-]+\.(png|jpg|webp)$/
const validKey = (k: string) => KEY_RE.test(k) && k.length <= 200 && !k.includes('..') && !k.includes('//') && !k.startsWith('/')

// เทียบคีย์แบบคงที่เวลา
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused // โหมดทดสอบไม่ทำงานฟังก์ชันนี้
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const key = (Deno.env.get('SCHEDULED_KEY') || '').trim()
  if (!key || !sameKey(key, req.headers.get('x-cron-key') || '')) return json({ error: 'forbidden' }, 403)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: run, error } = await db.rpc('punpang_retention5y_run')
  if (error || !run || typeof run !== 'object') return json({ error: 'รันฐานข้อมูลไม่สำเร็จ' }, 500)

  // รายการไฟล์ไม่ส่งกลับทั้งก้อน (ไม่ต้องเก็บคีย์ในผลตอบกลับ)
  const { deleteKeys, ...summary } = run as Record<string, unknown>
  const keys = (Array.isArray(deleteKeys) ? deleteKeys : []).map(String).filter(validKey)

  // ลบเป็นชุดละ 100 · ยืนยันเฉพาะชุดที่ลบสำเร็จ · ชุดที่ล้มเหลวและที่เหลือยังอยู่ในคิว
  const f = filesEnv()
  let filesDeleted = 0
  let stopped = false
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100)
    if (!(await svcDelete(f, batch))) { stopped = true; break }
    const ack = await db.rpc('punpang_retention5y_ack', { p_keys: batch })
    if (ack.error) { stopped = true; break }
    filesDeleted += Number(ack.data) || 0
  }
  return json({ ...summary, filesToDelete: keys.length, filesDeleted, stopped })
})
