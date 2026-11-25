// เชื่อม Supabase ฝั่งเบราว์เซอร์ — ใช้ได้เฉพาะ URL + publishable (anon) key เท่านั้น
// ห้ามใส่ service_role key ในที่นี้หรือในตัวแปร VITE_* ใด ๆ (ถูกฝังในไฟล์ที่ผู้ใช้ทุกคนโหลดได้)
// ปิดอยู่เป็นค่าเริ่มต้น: ถ้าไม่ตั้งตัวแปรครบ แอปใช้ข้อมูลจำลองในหน่วยความจำตามเดิม (และไม่โหลดไลบรารี Supabase)
const env = import.meta.env || {}
// ตัดช่องว่างหัว/ท้ายของค่าที่ตั้งไว้ (ค่าที่คัดลอกมามักมีช่องว่างติดมา)
// ช่องว่างท้ายค่า: การอ่านข้อมูลยังได้ (เบราว์เซอร์ตัดช่องว่างใน header ให้เอง) แต่การเชื่อม Realtime ส่งเป็น %20 → ถูกปฏิเสธ 401
const url = String(env.VITE_SUPABASE_URL || '').trim()
const key = String(env.VITE_SUPABASE_ANON_KEY || '').trim()

export const supabaseEnabled = !!(url && key && env.VITE_USE_SUPABASE === '1')

let client = null
export async function getSupabase() {
  if (!supabaseEnabled) return null
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      db: { schema: 'public' },
    })
  }
  return client
}

