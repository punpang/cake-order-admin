import { reactive } from 'vue'
import { getSupabase, supabaseEnabled } from './supabase'
import { showToast } from './toast'

// สถานะพนักงานที่ล็อกอินจริง (ใช้เมื่อเปิด Supabase เท่านั้น)
export const staffState = reactive({ ready: !supabaseEnabled, staff: null })
let syncs = []
// หลังล็อกอินสำเร็จ: โหลดข้อมูลจาก Supabase (สินค้า/ลูกค้า) และเขียนกลับเมื่อมีสิทธิ์
async function startData(staff) {
  syncs.forEach((x) => x.stop())
  syncs = []
  const [items, customers, config, orders, acct, chats, store, client] = await Promise.all([import('./itemsSync'), import('./customersSync'), import('./configSync'), import('./ordersSync'), import('./acctSync'), import('./chatSync'), import('../data/store'), getSupabase()])
  const { db } = store
  const onError = (m) => showToast(m, 8000)
  const has = (p) => staff.perms.includes(p)
  // ขอเลขเอกสารเป็นชุดล่วงหน้าจากฐานข้อมูล (ไม่ซ้ำข้ามเครื่อง)
  store.numbering.setAlloc(async (p, d, n) => { const r = await client.rpc('punpang_alloc_numbers', { p_prefix: p, p_day: d, p_n: n }); return r.error ? null : r.data })
  syncs.push(await items.startItemsSync({ client, db, canWrite: has('editItems'), onError }))
  syncs.push(await config.startConfigSync({ client, db, canWrite: has('manage'), onError }))
  syncs.push(await orders.startOrdersSync({ client, db, numbering: store.numbering, onError, onRecode: (o, c) => showToast(`เลขออร์เดอร์ซ้ำ ระบบเปลี่ยนเป็น ${c}`, 8000),
    canWrite: ['createOrder', 'pos', 'startPreparing', 'markPrepared', 'deliverPickup', 'deliverShipping', 'confirmPayment', 'reportPayment', 'cancel', 'editPickup', 'editItems', 'adjustPrice', 'changeBuyer', 'workPhoto'].some(has) }))
  store.numbering.prefetch()
  syncs.push(await customers.startCustomersSync({ client, db, canWrite: has('createOrder') || has('adjustPoints'), onError }))
  syncs.push(...(await acct.startAcctSync({ client, db, has, onError })))
  // แชท/ใบเสนอ: เฉพาะผู้มีสิทธิ์ chat · คนอื่นล้างข้อมูลตัวอย่างออก (ไม่ให้เห็นแชทจำลองปนกับของจริง)
  if (has('chat')) syncs.push(...(await chats.startChatSync({ client, db, canWrite: true, numbering: store.numbering, onError, onRecode: (q, c) => showToast(`เลขใบเสนอซ้ำ ระบบเปลี่ยนเป็น ${c}`, 8000) })))
  else { db.chats.splice(0); db.quotes.splice(0) }
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

export async function staffSignOut() { staffState.staff = null; syncs.forEach((x) => x.stop()); syncs = []; const supabase = await getSupabase(); if (supabase) await supabase.auth.signOut() }
