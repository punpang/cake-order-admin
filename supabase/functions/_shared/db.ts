// ไคลเอนต์ฐานข้อมูลด้วยสิทธิ์บริการ · ใช้สคีมา public เสมอ (ระบบจริง)
import { createClient } from 'npm:@supabase/supabase-js@2'

export function serviceDb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}
