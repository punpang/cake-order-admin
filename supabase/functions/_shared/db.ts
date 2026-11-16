// ไคลเอนต์ฐานข้อมูลด้วยสิทธิ์บริการ · เลือกสคีมาตามโหมดของคำขอ (โหมดจริง = public เหมือนเดิมทุกประการ)
// โหมดทดสอบ = punpang_test (ข้อมูลทดสอบอยู่ที่นั่น · ตารางข้อมูลร่วมเป็น view อ่านอย่างเดียว)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { modeOf, schemaOf, type Mode } from './mode.ts'

export function serviceDb(req: Request, mode: Mode = modeOf(req)) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
    db: { schema: schemaOf(mode) },
  })
}
