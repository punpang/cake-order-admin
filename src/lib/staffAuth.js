import { reactive } from 'vue'
import { getSupabase, supabaseEnabled } from './supabase'
import { showToast } from './toast'

// สถานะพนักงานที่ล็อกอินจริง (ใช้เมื่อเปิด Supabase เท่านั้น)
export const staffState = reactive({ ready: !supabaseEnabled, staff: null })
let syncs = []
let trashHook = null
// รีเฟรชข้อมูลที่คนอื่น/ลูกค้าแก้ (ออร์เดอร์ ลูกค้า ข้อมูลรายแถว) ทุก 45 วินาทีขณะเปิดหน้าอยู่ และเมื่อกลับมาที่แท็บ
const POLL_MS = 45000
let pollTimer = null
let pollBusy = false
async function pollOnce() {
  if (pollBusy || (typeof document !== 'undefined' && document.hidden)) return
  pollBusy = true
  try { for (const x of syncs) if (x.refresh) await x.refresh() } catch (e) { console.warn('รีเฟรชข้อมูลไม่สำเร็จ:', e?.message) }
  pollBusy = false
}
const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) pollOnce() }
function startPolling() {
  stopPolling()
  pollTimer = setInterval(pollOnce, POLL_MS)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
}
function stopPolling() {
  clearInterval(pollTimer)
  pollTimer = null
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
}
// หลังล็อกอินสำเร็จ: โหลดข้อมูลจาก Supabase (สินค้า/ลูกค้า) และเขียนกลับเมื่อมีสิทธิ์
async function startData(staff) {
  stopPolling()
  syncs.forEach((x) => x.stop())
  syncs = []
  const [items, customers, config, orders, acct, chats, shifts, users, store, client] = await Promise.all([import('./itemsSync'), import('./customersSync'), import('./configSync'), import('./ordersSync'), import('./acctSync'), import('./chatSync'), import('./shiftsSync'), import('./usersSync'), import('../data/store'), getSupabase()])
  const { db } = store
  // สำเร็จรูปสาธารณะที่ถอนการเผยแพร่แล้ว → ลบไฟล์ (เฉพาะผู้มีสิทธิ์จัดการ)
  const storage = await import('./storage')
  // SMS จริงผ่านเกตเวย์ของร้าน (Edge Function sms-send · URL เกตเวย์เก็บเป็น secret ฝั่งเซิร์ฟเวอร์) · ตั้งค่าไว้ = ถือว่าเชื่อมช่องทาง SMS แล้ว
  store.smsHook.send = async (number, text, kind) => {
    const r = await client.functions.invoke('sms-send', { body: { number, text, kind } })
    if (r.error) { let m = ''; try { m = (await r.error.context?.json?.())?.error || '' } catch { /* ข้าม */ } return { ok: false, error: m || 'ส่งไม่สำเร็จ' } }
    return r.data?.ok ? { ok: true } : { ok: false, error: r.data?.error || '' }
  }
  client.functions.invoke('sms-send', { body: { action: 'status' } }).then((r) => {
    if (r.data?.configured) {
      const was = store.db.integrations.sms.enabled // คงสวิตช์เปิด/ปิดที่ร้านตั้งไว้ (บันทึกใน Supabase)
      store.connectIntegration('sms', { accountName: 'เกตเวย์ SMS ของร้าน', accountId: 'gateway' })
      store.db.integrations.sms.enabled = was
    }
  }, () => {})
  const rmIdx = store.trashHooks.indexOf(trashHook)
  if (rmIdx >= 0) store.trashHooks.splice(rmIdx, 1)
  trashHook = (url) => { storage.removePublicCopy(client, url) }
  if (staff.perms.includes('manage')) store.trashHooks.push(trashHook)
  const onError = (m) => showToast(m, 8000)
  const has = (p) => staff.perms.includes(p)
  // ขอเลขเอกสารเป็นชุดล่วงหน้าจากฐานข้อมูล (ไม่ซ้ำข้ามเครื่อง)
  store.numbering.setAlloc(async (p, d, n) => { const r = await client.rpc('punpang_alloc_numbers', { p_prefix: p, p_day: d, p_n: n }); return r.error ? null : r.data })
  syncs.push(await items.startItemsSync({ client, db, canWrite: has('editItems'), onError }))
  syncs.push(await config.startConfigSync({ client, db, canWrite: has('manage'), onError }))
  // แอดมิน: สร้างสำเนาสาธารณะของราคา/ตัวเลือก/โปรโมชั่น/ข้อมูลร้านให้ครบ (ครั้งแรกหลังเปิดใช้) — ทำเมื่อโหลดตั้งค่าสำเร็จเท่านั้น
  if (has('manage') && syncs.at(-1)?.loaded) {
    const [pub, cfg] = await Promise.all([import('./publicSync'), import('./configSync')])
    const m = await pub.ensureMirror(client, db, cfg.stripRecipes)
    if (m.error) onError('เผยแพร่ข้อมูลหน้าร้านไม่สำเร็จ: ' + m.error)
  }
  syncs.push(await orders.startOrdersSync({ client, db, numbering: store.numbering, onError, onRecode: (o, c) => showToast(`เลขออร์เดอร์ซ้ำ ระบบเปลี่ยนเป็น ${c}`, 8000),
    canWrite: ['createOrder', 'pos', 'startPreparing', 'markPrepared', 'deliverPickup', 'deliverShipping', 'confirmPayment', 'reportPayment', 'cancel', 'editPickup', 'editItems', 'adjustPrice', 'changeBuyer', 'workPhoto'].some(has) }))
  store.numbering.prefetch()
  syncs.push(await customers.startCustomersSync({ client, db, canWrite: has('createOrder') || has('adjustPoints'), onError }))
  syncs.push(...(await acct.startAcctSync({ client, db, has, onError })))
  // แชท/ใบเสนอ: เฉพาะผู้มีสิทธิ์ chat · คนอื่นล้างข้อมูลตัวอย่างออก (ไม่ให้เห็นแชทจำลองปนกับของจริง)
  if (has('chat')) syncs.push(...(await chats.startChatSync({ client, db, canWrite: true, numbering: store.numbering, onError, onRecode: (q, c) => showToast(`เลขใบเสนอซ้ำ ระบบเปลี่ยนเป็น ${c}`, 8000) })))
  else { db.chats.splice(0); db.quotes.splice(0) }
  // ผู้ใช้/สิทธิ์: เฉพาะ manageUsers · คนอื่นเห็นแค่ตัวเอง · ผูกตัวตนปัจจุบัน (ไว้บันทึกประวัติ "ใครทำ")
  store.session.userId = staff.user_id
  store.session.role = staff.role
  if (has('manageUsers')) syncs.push(...(await users.startUsersSync({ client, db, canWrite: true, onError })))
  else users.selfOnly(db, staff)
  // กะ POS: อ่านได้เมื่อมี pos / viewAllOrders / manage · เขียนได้เมื่อมี pos
  if (['pos', 'viewAllOrders', 'manage'].some(has)) syncs.push(await shifts.startShiftsSync({ client, db, canWrite: has('pos'), onError }))
  else db.shifts.splice(0)
  // ข้อมูลปฏิบัติการรายแถว (รีวิว/คูปอง/คำขอ/แจ้งเตือน/ลิงก์ ฯลฯ): อ่าน/เขียนตามสิทธิ์ · อ่านไม่ได้ = ล้างข้อมูลตัวอย่าง
  const rec = await import('./recordsSync')
  for (const [name, spec] of Object.entries(rec.RECORD_SPECS)) {
    if (rec.specAllows(spec.read, has)) syncs.push(await rec.startRecordsSync({ client, db, collection: name, canWrite: rec.specAllows(spec.write, has), onError }))
    else rec.clearRecords(db, name)
  }
  import('./clicksSync').then((m) => m.applyClicks(client, db)).catch(() => {})
  startPolling()
}
export async function initStaff() {
  if (!supabaseEnabled) return
  const r = await currentStaff()
  staffState.staff = r.staff || null
  staffState.ready = true
  if (r.staff) await startData(r.staff)
  else await loadForVisitor()
}
// ผู้เยี่ยมชมที่ไม่ได้ล็อกอิน: อ่านข้อมูลสาธารณะของหน้าร้านจาก Supabase (อ่านอย่างเดียว)
async function loadForVisitor() {
  try {
    const [pub, store, client] = await Promise.all([import('./publicSync'), import('../data/store'), getSupabase()])
    // ไม่ให้หน้าเว็บค้างถ้าเซิร์ฟเวอร์ช้า: รอไม่เกิน 6 วินาที (ข้อมูลที่โหลดเสร็จทีหลังยังถูกใส่ให้เอง)
    await Promise.race([pub.startPublicLoad({ client, db: store.db, onError: (m) => console.warn('โหลดข้อมูลหน้าร้านไม่สำเร็จ:', m) }), new Promise((r) => setTimeout(r, 6000))])
  } catch (e) { console.warn('โหลดข้อมูลหน้าร้านไม่สำเร็จ:', e?.message) }
  // สถิติคลิกแบบเค้ก (รูปแนะนำ) — โหลดเบื้องหลัง ไม่รอ
  import('./clicksSync').then(async (m) => m.applyClicks(await getSupabase(), (await import('../data/store')).db)).catch(() => {})
  try { await (await import('../data/store')).restoreCustomerSession() } catch (e) { console.warn('กลับเข้าบัญชีลูกค้าไม่สำเร็จ:', e?.message) }
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
  const { data, error } = await supabase.from('punpang_staff').select('user_id,name,role,perms,active,email').eq('user_id', u.user.id).maybeSingle()
  if (error || !data || !data.active) { await supabase.auth.signOut(); return { error: 'บัญชีนี้ไม่มีสิทธิ์ใช้งานหลังบ้าน' } }
  return { staff: data }
}

export async function staffSignOut() { staffState.staff = null; { const m = await import('../data/store'); const i = m.trashHooks.indexOf(trashHook); if (i >= 0) m.trashHooks.splice(i, 1) }; stopPolling(); syncs.forEach((x) => x.stop()); syncs = []; const supabase = await getSupabase(); if (supabase) await supabase.auth.signOut() }
