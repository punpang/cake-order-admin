// เชื่อม Supabase ฝั่งเบราว์เซอร์ — ใช้ได้เฉพาะ URL + publishable (anon) key เท่านั้น
// ห้ามใส่ service_role key ในที่นี้หรือในตัวแปร VITE_* ใด ๆ (ถูกฝังในไฟล์ที่ผู้ใช้ทุกคนโหลดได้)
// ปิดอยู่เป็นค่าเริ่มต้น: ถ้าไม่ตั้งตัวแปรครบ แอปใช้ข้อมูลจำลองในหน่วยความจำตามเดิม (และไม่โหลดไลบรารี Supabase)
const env = import.meta.env || {}
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = !!(url && key && env.VITE_USE_SUPABASE === '1')

let client = null
export async function getSupabase() {
  if (!supabaseEnabled) return null
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  }
  return client
}
