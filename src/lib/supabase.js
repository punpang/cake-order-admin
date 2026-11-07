import { createClient } from '@supabase/supabase-js'

// เชื่อม Supabase ฝั่งเบราว์เซอร์ — ใช้ได้เฉพาะ URL + publishable (anon) key เท่านั้น
// ห้ามใส่ service_role key ในที่นี้หรือในตัวแปร VITE_* ใด ๆ (ถูกฝังในไฟล์ที่ผู้ใช้ทุกคนโหลดได้)
// ปิดอยู่เป็นค่าเริ่มต้น: ถ้าไม่ตั้งตัวแปรทั้งสอง แอปใช้ข้อมูลจำลองในหน่วยความจำตามเดิม
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = !!(url && key && import.meta.env.VITE_USE_SUPABASE === '1')
export const supabase = supabaseEnabled
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null
