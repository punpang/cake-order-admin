import { startSync, selectAll } from './tableSync'
import { startConfigSync } from './configSync'

// ซิงก์ผู้ใช้/สิทธิ์ (db.users) กับ punpang_staff · ใช้ได้เฉพาะผู้มีสิทธิ์ manageUsers (บังคับที่ฐานข้อมูล)
// - id ผู้ใช้ = user_id ของ Supabase Auth · เพิ่มพนักงานใหม่ = แอดมินสร้างบัญชีใน Supabase Auth ก่อน แล้วพิมพ์อีเมลในแอป
//   (ฟังก์ชัน punpang_staff_add หา user จากอีเมล) · ไม่ลบจริง ใช้ปิดใช้งาน (active)
// - ประวัติเปลี่ยนสิทธิ์ (permLog) เก็บใน punpang_kv collection 'audit' (อ่าน/เขียนเฉพาะ manageUsers)
export function staffToUser(r) {
  return { id: r.user_id, name: r.name, email: r.email || '', role: r.role, active: r.active !== false, perms: Array.isArray(r.perms) ? [...r.perms] : [] }
}
export async function loadUsers(client) {
  const a = await selectAll((x, y) => client.from('punpang_staff').select('user_id,name,role,perms,active,email').order('user_id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(staffToUser) }
}
// แถวใหม่ → ฟังก์ชันเพิ่มจากอีเมล (แล้วเปลี่ยน id ในแอปเป็น user_id จริง) · แถวเดิม → update (ไม่แก้อีเมล/ไม่ลบ)
export async function pushUsers(client, { upserts }, { known = new Set(), onRename = () => {} } = {}) {
  for (const u of upserts) {
    if (known.has(u.id)) {
      const r = await client.from('punpang_staff').update({ name: u.name, role: u.role, perms: u.perms || [], active: u.active !== false }).eq('user_id', u.id)
      if (r.error) return { error: `${u.email || u.name}: ${r.error.message}` }
      continue
    }
    const r = await client.rpc('punpang_staff_add', { p_email: u.email, p_name: u.name, p_role: u.role, p_perms: u.perms || [] })
    if (r.error) return { error: `${u.email}: ${r.error.message}` }
    const old = u.id
    u.id = r.data // reactive: ใช้ user_id จริงของบัญชี
    onRename(old, r.data) // อ้างอิงเดิม (เช่น ประวัติสิทธิ์) ตามไปด้วย
    known.add(u.id)
    if (u.active === false) { // เพิ่มแล้วปิดใช้งานทันที
      const x = await client.from('punpang_staff').update({ active: false }).eq('user_id', u.id)
      if (x.error) return { error: `${u.email}: ${x.error.message}` }
    }
  }
  return { ok: true }
}
export async function startUsersSync({ client, db, canWrite, onError, debounceMs }) {
  const known = new Set()
  const users = await startSync({
    list: () => db.users,
    replace: (items) => { db.users.splice(0, db.users.length, ...items); known.clear(); for (const i of items) known.add(i.id) },
    load: () => loadUsers(client),
    push: (c) => pushUsers(client, c, { known, onRename: (o, n) => { for (const e of db.permLog) if (e.userId === o) e.userId = n } }),
    canWrite, onError, debounceMs, label: 'ผู้ใช้',
  })
  const audit = await startConfigSync({ client, db, canWrite, onError, keys: ['permLog'], collection: 'audit', debounceMs })
  return [users, audit]
}
// ผู้ที่จัดการผู้ใช้ไม่ได้: เห็นแค่ตัวเอง (ล้างผู้ใช้ตัวอย่างออก)
export function selfOnly(db, staff) {
  db.users.splice(0, db.users.length, staffToUser({ ...staff, email: staff.email || '' }))
  db.permLog.splice(0)
}
