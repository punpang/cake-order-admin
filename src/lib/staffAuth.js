import { supabase } from './supabase'

// เข้าสู่ระบบพนักงานด้วย Supabase Auth (อีเมล+รหัสผ่าน) แล้วอ่านบทบาท/สิทธิ์จาก punpang_staff
// สิทธิ์จริงบังคับที่ฝั่งฐานข้อมูล (RLS) — ค่าที่อ่านมาใช้แสดง/ซ่อนเมนูเท่านั้น
export async function staffSignIn(email, password) {
  if (!supabase) return { error: 'ยังไม่ได้เปิดใช้ Supabase' }
  const { error } = await supabase.auth.signInWithPassword({ email: String(email).trim(), password })
  if (error) return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' } // ข้อความเดียว ไม่บอกว่าผิดช่องไหน
  return currentStaff()
}

export async function currentStaff() {
  if (!supabase) return { error: 'ยังไม่ได้เปิดใช้ Supabase' }
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return { error: 'ยังไม่ได้เข้าสู่ระบบ' }
  const { data, error } = await supabase.from('punpang_staff').select('user_id,name,role,perms,active').eq('user_id', u.user.id).maybeSingle()
  if (error || !data || !data.active) { await supabase.auth.signOut(); return { error: 'บัญชีนี้ไม่มีสิทธิ์ใช้งานหลังบ้าน' } }
  return { staff: data }
}

export async function staffSignOut() { if (supabase) await supabase.auth.signOut() }
