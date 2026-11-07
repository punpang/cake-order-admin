import { reactive } from 'vue'
import { getSupabase, supabaseEnabled } from './supabase'
import { showToast } from './toast'

// สถานะพนักงานที่ล็อกอินจริง (ใช้เมื่อเปิด Supabase เท่านั้น)
export const staffState = reactive({ ready: !supabaseEnabled, staff: null })
let itemsSync = null
// หลังล็อกอินสำเร็จ: โหลดสินค้าจาก Supabase (และเขียนกลับเมื่อมีสิทธิ์ editItems)
async function startData(staff) {
  if (itemsSync) itemsSync.stop()
  const [{ startItemsSync }, { db }, client] = await Promise.all([import('./itemsSync'), import('../data/store'), getSupabase()])
  itemsSync = await startItemsSync({ client, db, canWrite: staff.perms.includes('editItems'), onError: (m) => showToast(m, 8000) })
}
export async function initStaff() {
  if (!supabaseEnabled) return
  const r = await currentStaff()
  staffState.staff = r.staff || null
  staffState.ready = true
  if (r.staff) await startData(r.staff)
}

// เข้าสู่ระบบพนักงานด้วย Supabase Auth (อีเมล+รหัสผ่าน) แล้วอ่านบทบาท/สิทธิ์จาก punpang_staff
// สิทธิ์จริงบังคับที่ฝั่งฐานข้อมูล (RLS) — ค่าที่อ่านมาใช้แสดง/ซ่อนเมนูเท่านั้น
export async function staffSignIn(email, password) {
  const supabase = await getSupabase()
  if (!supabase) return { error: 'ยังไม่ได้เปิดใช้ Supabase' }
  const { error } = await supabase.auth.signInWithPassword({ email: String(email).trim(), password })
  if (error) return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' } // ข้อความเดียว ไม่บอกว่าผิดช่องไหน
  const r = await currentStaff()
  if (r.staff) { staffState.staff = r.staff; await startData(r.staff) }
  return r
}

export async function currentStaff() {
  const supabase = await getSupabase()
  if (!supabase) return { error: 'ยังไม่ได้เปิดใช้ Supabase' }
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return { error: 'ยังไม่ได้เข้าสู่ระบบ' }
  const { data, error } = await supabase.from('punpang_staff').select('user_id,name,role,perms,active').eq('user_id', u.user.id).maybeSingle()
  if (error || !data || !data.active) { await supabase.auth.signOut(); return { error: 'บัญชีนี้ไม่มีสิทธิ์ใช้งานหลังบ้าน' } }
  return { staff: data }
}

export async function staffSignOut() { staffState.staff = null; if (itemsSync) { itemsSync.stop(); itemsSync = null }; const supabase = await getSupabase(); if (supabase) await supabase.auth.signOut() }
