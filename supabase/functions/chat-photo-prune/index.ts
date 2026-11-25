// ลบรูปที่ลูกค้าแนบในแชทเมื่อครบ 90 วัน · ลำดับ: ถอดลิงก์ในแชท → ลบไฟล์ใน R2 → ลบทะเบียน
// ถ้าขั้นใดไม่สำเร็จ ทะเบียนยังอยู่ รอบถัดไปจะลองใหม่ (ทำซ้ำได้ปลอดภัย)
// เรียกทุกวันจาก pg_cron ด้วยคีย์ x-cron-key (คีย์เดียวกับฟังก์ชัน scheduled)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CHAT_PHOTO_DAYS, CHAT_PHOTO_KV, isExpiredAt } from '../_shared/chatphoto.ts'
import { filesEnv, svcDelete } from '../_shared/filesvc.ts'

const BATCH = 500
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// เทียบคีย์แบบคงที่เวลา
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const key = (Deno.env.get('SCHEDULED_KEY') || '').trim()
  if (!key || !sameKey(key, req.headers.get('x-cron-key') || '')) return json({ error: 'forbidden' }, 403)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const nowMs = Date.now()
  const cutoff = new Date(nowMs - CHAT_PHOTO_DAYS * 86400e3).toISOString()
  const { data: rows, error } = await db.from('punpang_kv').select('id,data').eq('collection', CHAT_PHOTO_KV).lt('data->>at', cutoff).limit(BATCH)
  if (error) return json({ error: 'อ่านทะเบียนไม่สำเร็จ' }, 500)
  const expired = (rows || []).filter((r: any) => isExpiredAt(r.data?.at, nowMs))
  if (!expired.length) return json({ expired: 0, chatsChanged: 0, r2Deleted: true })
  const keys: string[] = expired.map((r: any) => String(r.id))
  const refs = new Set(keys.map((k) => `r2://private/${k}`))

  // 1) ถอดลิงก์รูปออกจากข้อความในแชทเว็บ (CAS บน updated_at)
  const { data: chats, error: ce } = await db.from('punpang_chats').select('id,data,updated_at').eq('channel', 'web').limit(5000)
  if (ce) return json({ error: 'อ่านแชทไม่สำเร็จ' }, 500)
  let chatsChanged = 0
  let failed = 0
  for (const c of chats || []) {
    const msgs: any[] = Array.isArray(c.data?.messages) ? c.data.messages : []
    let touched = false
    const next = msgs.map((m) => {
      if (!Array.isArray(m?.attachments) || !m.attachments.some((a: any) => refs.has(a?.path))) return m
      touched = true
      return { ...m, attachments: m.attachments.filter((a: any) => !refs.has(a?.path)) }
    })
    if (!touched) continue
    const up = await db.from('punpang_chats').update({ data: { ...c.data, messages: next } }).eq('id', c.id).eq('updated_at', c.updated_at).select('id')
    if (up?.error || !(up?.data || []).length) failed++
    else chatsChanged++
  }
  // มีแชทที่เขียนไม่ได้ → ยังไม่ลบไฟล์ รอบถัดไปจะลองใหม่
  if (failed) return json({ expired: keys.length, chatsChanged, retry: failed, r2Deleted: false }, 200)

  // 2) ลบไฟล์ใน R2 เป็นชุดละ 100 ไฟล์
  const f = filesEnv()
  for (let i = 0; i < keys.length; i += 100) {
    const ok = await svcDelete(f, keys.slice(i, i + 100))
    if (!ok) return json({ expired: keys.length, chatsChanged, r2Deleted: false }, 502)
  }

  // 3) ลบทะเบียนของไฟล์ที่ลบแล้ว
  const del = await db.from('punpang_kv').delete().eq('collection', CHAT_PHOTO_KV).in('id', keys)
  if (del?.error) return json({ expired: keys.length, chatsChanged, registryDeleted: false }, 500)
  return json({ expired: keys.length, chatsChanged, r2Deleted: true, registryDeleted: true })
})
