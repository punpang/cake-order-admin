import { mayHaveStaffSession } from './staffSessionHint'
import { reactive } from 'vue'
import { getSupabase, supabaseEnabled } from './supabase'
import { showToast } from './toast'
import { quietly } from './loading'
import { publicState, setRestoring } from './dataStatus'
import { syncRealtime, waitSaved } from './syncStatus'
import { startRealtime, makeDebouncer } from './realtimeSync'
import { startPush, stopPush } from './push'
import { createQuoteRemote } from './quoteRemote'

// สถานะพนักงานที่ล็อกอินจริง (ใช้เมื่อเปิด Supabase เท่านั้น)
export const staffState = reactive({ ready: !supabaseEnabled, staff: null, loadFailed: [] })
let syncs = []
let trashHook = null
// รีเฟรชข้อมูลที่คนอื่น/ลูกค้าแก้ (ออร์เดอร์ ลูกค้า ข้อมูลรายแถว) ทุก 45 วินาทีขณะเปิดหน้าอยู่ และเมื่อกลับมาที่แท็บ
const POLL_MS = 45000
let pollTimer = null
let pollBusy = false
// Realtime เชื่อมอยู่ = ดึงทั้งหมดแค่ทุก 5 นาทีเป็นตาข่ายสำรอง · หลุด = กลับไปทุก 45 วินาที
const SAFETY_POLL_MS = 300000
let lastFull = 0
let chain = Promise.resolve()
const exclusive = (fn) => (chain = chain.then(fn, fn).catch(() => {})) // รีเฟรชทีละงาน ไม่ซ้อนกัน
async function pollOnce(force = false) {
  if (pollBusy || (typeof document !== 'undefined' && document.hidden)) return
  if (force !== true && syncRealtime.state === 'live' && Date.now() - lastFull < SAFETY_POLL_MS) return
  pollBusy = true
  await exclusive(async () => {
    try { for (const x of syncs) if (x.refresh) await x.refresh() } catch (e) { console.warn('รีเฟรชข้อมูลไม่สำเร็จ:', e?.message) }
    lastFull = Date.now()
  })
  pollBusy = false
}
const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) pollOnce(true) }
const onOnline = () => pollOnce(true)
function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => quietly(pollOnce), POLL_MS)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
}
// Realtime ฝั่งพนักงาน: event ของตาราง → refresh เฉพาะ handle ที่เกี่ยวข้อง (หน่วง + รวมเหตุการณ์)
let rt = null
let rtDeb = null
function startStaffRealtime(client, recNames) {
  stopStaffRealtime()
  const by = (f) => syncs.filter((x) => x && x.refresh && f(x))
  const routes = {
    punpang_orders: by((x) => x.label === 'ออร์เดอร์'),
    punpang_customers: by((x) => x.label === 'ลูกค้า'),
    punpang_shifts: by((x) => x.label === 'กะ POS'),
    punpang_chats: by((x) => x.label === 'แชท'),
    punpang_quotes: by((x) => x.label === 'ใบเสนอ'),
    punpang_items: by((x) => x.label === 'สินค้า'),
    punpang_kv: by((x) => x.label === 'สินค้า' || !x.label), // ตั้งค่า/บัญชี/ล็อกสิทธิ์ (handle ที่โหลดสำเร็จไม่มี label) + ต้นทุนสินค้า
    punpang_records: by((x) => recNames.has(x.label)),
  }
  const bindings = Object.entries(routes).filter(([, h]) => h.length).map(([table]) => ({ table, key: table }))
  if (!bindings.length) return
  // เก็บ id ที่เปลี่ยนต่อ key · มี refreshIds + ทุก event มี id → ดึงเฉพาะแถว ไม่งั้น (หรือดึงไม่สำเร็จ) รีเฟรชทั้งตาราง
  const pending = new Map()
  rtDeb = makeDebouncer((key) => {
    const p = pending.get(key); pending.delete(key)
    exclusive(async () => {
      for (const x of routes[key]) {
        try {
          // ข้อมูลที่เปลี่ยนจาก Realtime ดึงเบื้องหลัง: ไม่ขึ้นหน้าจอหมุนโหลด
          const byIds = await quietly(() => (p && !p.full && p.ids.size && x.refreshIds && p.ids.size <= 50 ? x.refreshIds([...p.ids]) : false))
          if (byIds) continue
          await quietly(() => x.refresh())
        } catch (e) { console.warn('รีเฟรชข้อมูลไม่สำเร็จ:', e?.message) }
      }
    })
  })
  rt = startRealtime({
    client, name: 'staff-sync', bindings,
    onEvent: (key, payload) => {
      const p = pending.get(key) || { ids: new Set(), full: false }
      const id = payload?.new?.id || payload?.old?.id
      if (id && payload?.eventType !== 'DELETE') p.ids.add(id); else p.full = true
      pending.set(key, p)
      rtDeb(key, key === 'punpang_chats' || key === 'punpang_quotes' ? 300 : 400)
    },
    onLive: (reconnect) => { if (reconnect) quietly(() => pollOnce(true)) },
  })
}
function stopStaffRealtime() {
  if (rtDeb) { rtDeb.cancel(); rtDeb = null }
  if (rt) { rt.stop(); rt = null }
}
// เปิดหน้าแชทอยู่ = รีเฟรชเฉพาะแชทถี่ขึ้น (ข้อความ Facebook เข้าทาง webhook) · ที่อื่นคง 45 วินาที
const FAST_CHAT_MS = 10000
let fastTimer = null
export function setChatFastPoll(on) {
  clearInterval(fastTimer)
  fastTimer = null
  if (!on) return
  fastTimer = setInterval(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (syncRealtime.state === 'live') return // เรียลไทม์เชื่อมอยู่ ไม่ต้อง poll ถี่
    try { for (const x of syncs) if (x.kind === 'chats' && x.refresh) await x.refresh() } catch (e) { console.warn('รีเฟรชแชทไม่สำเร็จ:', e?.message) }
  }, FAST_CHAT_MS)
}
function stopPolling() {
  clearInterval(pollTimer)
  clearInterval(fastTimer)
  pollTimer = null
  fastTimer = null
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  stopStaffRealtime()
}
// ตัวจัดการเบื้องหลังของแชท (ใช้เมื่อโหลดกลุ่ม chats เท่านั้น): บอทตอบ/ใบเสนอที่ลูกค้ากดยืนยัน จองสิทธิ์ที่ฐานข้อมูลก่อน
function chatHooks(client, store, has) {
  const botSeen = new Set()
  const onInbound = async (chatId, mid) => {
    const k = chatId + '|' + mid
    if (botSeen.has(k)) return
    botSeen.add(k)
    const r = await client.rpc('punpang_chat_bot_claim', { p_chat: chatId, p_mid: mid })
    if (r.error || r.data !== true) return // ไม่ได้สิทธิ์ (มีเครื่องอื่นจองแล้ว) หรือผิดพลาด
    store.processInbound(chatId, mid)
  }
  const quoteSeen = new Set()
  const onQuoteConfirm = async (quoteId) => {
    if (quoteSeen.has(quoteId)) return
    quoteSeen.add(quoteId)
    const r = await client.rpc('punpang_quote_claim', { p_quote: quoteId })
    if (r.error || r.data !== true) { quoteSeen.delete(quoteId); return }
    store.processQuoteConfirm(quoteId)
  }
  return { onInbound, onQuoteConfirm: has('createOrder') ? onQuoteConfirm : null }
}

// กลุ่มข้อมูลที่โหลดตามหน้า (ไม่โหลดตอนเปิดแอป) · คืน handle/array/null ของการซิงก์
const GROUP_LOADERS = {
  // ประวัติออร์เดอร์ทั้งหมด (บัญชี/กำไร/ลูกค้า/วันเกิด/ชำระเงิน): เปิดโหมดเต็มแล้วรีเฟรชตารางออร์เดอร์
  ordersAll: async () => {
    const m = await import('./ordersSync')
    m.setOrdersFullHistory(true)
    const h = syncs.find((x) => x && x.label === 'ออร์เดอร์')
    if (h?.refresh) await h.refresh()
    return null
  },
  shifts: async (c) => {
    if (!['pos', 'viewAllOrders', 'manage'].some(c.has)) return null
    const m = await import('./shiftsSync')
    return m.startShiftsSync({ client: c.client, db: c.store.db, canWrite: c.has('pos'), onError: c.onError })
  },
  chats: async (c) => {
    if (!c.has('chat')) return null
    const m = await import('./chatSync')
    return m.startChatSync({ client: c.client, db: c.store.db, canWrite: true, numbering: c.store.numbering, onError: c.onError, ...chatHooks(c.client, c.store, c.has),
      onRecode: (q, n) => showToast(`เลขใบเสนอซ้ำ ระบบเปลี่ยนเป็น ${n}`, 8000) })
  },
  // สถิติสินค้าพร้อมขายสำหรับหน้าร้าน: ต้องมีประวัติออร์เดอร์ครบก่อนคำนวณ · เผยแพร่เฉพาะผู้ที่แก้การตั้งค่าได้
  retailStats: async (c) => {
    if (!c.has('manage')) return null
    await GROUP_LOADERS.ordersAll(c)
    const m = await import('./retailStatsSync')
    return m.startRetailStatsSync({ client: c.client, db: c.store.db, canWrite: true })
  },
  users: async (c) => {
    if (!c.has('manageUsers')) return null
    const m = await import('./usersSync')
    return m.startUsersSync({ client: c.client, db: c.store.db, canWrite: true, onError: c.onError })
  },
}
// ข้อมูลของการเข้าสู่ระบบปัจจุบัน (ตั้งหลัง startData) + สัญญาณว่าข้อมูลพื้นฐานพร้อมแล้ว
let dataCtx = null
let coreDone = null
let coreReady = Promise.resolve()
const groupLoads = new Map()
// เรียกเมื่อเข้าหน้าที่ต้องใช้กลุ่มข้อมูล (router meta.data): โหลดเฉพาะกลุ่มที่ยังไม่เคยโหลด แล้วคงไว้เมื่อออกจากหน้า
export function ensureData(groups = []) {
  if (!dataCtx) return Promise.resolve()
  for (const g of groups) {
    if (!GROUP_LOADERS[g] || groupLoads.has(g)) continue
    const p = Promise.race([coreReady, new Promise((r) => setTimeout(r, 8000))]).then(async () => {
      if (!dataCtx) return
      const r = await GROUP_LOADERS[g](dataCtx)
      if (Array.isArray(r)) syncs.push(...r); else if (r) syncs.push(r)
      startStaffRealtime(dataCtx.client, dataCtx.recNames)
    }).catch((e) => { groupLoads.delete(g); console.warn('โหลดข้อมูลไม่สำเร็จ:', g, e?.message) })
    groupLoads.set(g, p)
  }
  return Promise.all(groups.map((g) => groupLoads.get(g) || Promise.resolve()))
}

// หลังล็อกอินสำเร็จ: โหลดข้อมูลจาก Supabase (สินค้า/ลูกค้า) และเขียนกลับเมื่อมีสิทธิ์
async function startData(staff) {
  stopPublicRefresh(); publicState.status = 'idle'
  groupLoads.clear()
  { const os = await import('./ordersSync'); os.setOrdersFullHistory(false); os.clearPinnedOrders() }
  coreReady = new Promise((r) => (coreDone = r))
  dataCtx = null
  ;(await import('./tableSync')).syncOptions.clearOnLoadFail = true
  stopPolling()
  syncs.forEach((x) => x.stop())
  syncs = []
  const [items, customers, config, orders, acct, chats, shifts, users, store, client] = await Promise.all([import('./itemsSync'), import('./customersSync'), import('./configSync'), import('./ordersSync'), import('./acctSync'), import('./chatSync'), import('./shiftsSync'), import('./usersSync'), import('../data/store'), getSupabase()])
  const { db } = store
  // สำเร็จรูปสาธารณะที่ถอนการเผยแพร่แล้ว → ลบไฟล์ (เฉพาะผู้มีสิทธิ์จัดการ)
  const storage = await import('./storage')
  // ใช้/ยกเลิกใช้แต้มแบบอะตอมิกบนเซิร์ฟเวอร์ (RPC ล็อกแถวลูกค้า → ตัดแต้ม + แก้ออร์เดอร์ในธุรกรรมเดียว) แล้วดึงแถวล่าสุดของออร์เดอร์/ลูกค้ามาแทนที่
  store.pointsHook.call = async (fn, args, ids) => {
    const w = await waitSaved() // บันทึกสิ่งที่แก้ค้างก่อน ให้เครื่องนี้ตรงกับเซิร์ฟเวอร์ก่อนตัดแต้ม
    if (!w.ok) return { error: `บันทึกข้อมูลก่อนหน้ายังไม่สำเร็จ: ${w.error}` }
    const r = await client.rpc(fn, args)
    if (r.error) return { error: r.error.message }
    try {
      for (const x of syncs) {
        if (x.refreshIds && x.label === 'ออร์เดอร์' && ids.order) await x.refreshIds([ids.order])
        if (x.refreshIds && x.label === 'ลูกค้า' && ids.customer) await x.refreshIds([ids.customer])
      }
    } catch { /* ข้อมูลล่าสุดจะมาตามรอบรีเฟรชปกติ */ }
    return r.data || {}
  }
  // จองคูปองแบบอะตอมิกบนเซิร์ฟเวอร์ (RPC punpang_claim_coupon / punpang_release_coupon)
  store.couponHook.claim = async (couponId, orderId) => {
    const r = await client.rpc('punpang_claim_coupon', { p_coupon: couponId, p_order: orderId })
    if (r.error) throw new Error(r.error.message)
    return String(r.data || '')
  }
  store.couponHook.release = async (couponId, orderId) => { await client.rpc('punpang_release_coupon', { p_coupon: couponId, p_order: orderId }) }
  // SMS จริงผ่านเกตเวย์ของร้าน (Edge Function sms-send · URL เกตเวย์เก็บเป็น secret ฝั่งเซิร์ฟเวอร์) · ตั้งค่าไว้ = ถือว่าเชื่อมช่องทาง SMS แล้ว
  store.smsHook.send = async (number, text, kind, idempotencyKey) => {
    const r = await client.functions.invoke('sms-send', { body: { number, text, kind, idempotencyKey } })
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
  // Telegram จริงเข้ากลุ่มทีม (Edge Function telegram-send · secret อยู่ฝั่งเซิร์ฟเวอร์) · ตั้งค่าไว้ = ถือว่าเชื่อมช่องทาง Telegram แล้ว
  store.tgHook.send = async (text, kind, parseMode = '') => {
    const r = await client.functions.invoke('telegram-send', { body: { text, kind, parse_mode: parseMode || undefined } })
    if (r.error) { let m = ''; try { m = (await r.error.context?.json?.())?.error || '' } catch { /* ข้าม */ } return { ok: false, error: m || 'ส่งไม่สำเร็จ' } }
    return r.data?.ok ? { ok: true } : { ok: false, error: r.data?.error || '' }
  }
  client.functions.invoke('telegram-send', { body: { action: 'status' } }).then((r) => {
    if (r.data?.configured) {
      const was = store.db.integrations.telegram.enabled // คงสวิตช์เปิด/ปิดที่ร้านตั้งไว้ (บันทึกใน Supabase)
      store.connectIntegration('telegram', { accountName: 'บอททีม', accountId: 'group' })
      store.db.integrations.telegram.enabled = was
    }
  }, () => {})
  // Facebook Messenger จริง: ตอบผ่าน fb-send · สถานะการเชื่อมเพจจาก fb-connect (token อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น)
  const fbr = await import('./fbRemote')
  store.fbHook.send = async (psid, text, opts = {}) => {
    const r = await fbr.fbSendCall(client, psid, text, { quoteId: opts.quoteId || '', card: opts.card || null, images: opts.images || [], channel: opts.channel || 'facebook' })
    return r.ok ? { ok: true } : { ok: false, error: r.error || '' }
  }
  fbr.fbConnectCall(client, 'status').then((r) => {
    if (r.error) return
    const it = store.db.integrations.facebook
    if (r.page) {
      const was = it.enabled // คงสวิตช์เปิด/ปิดที่ร้านตั้งไว้ (บันทึกใน Supabase)
      store.connectIntegration('facebook', { accountName: r.page.name, accountId: r.page.id })
      it.enabled = was
    } else if (it.status === 'connected') store.disconnectIntegration('facebook')
  }, () => {})
  const rmIdx = store.trashHooks.indexOf(trashHook)
  if (rmIdx >= 0) store.trashHooks.splice(rmIdx, 1)
  trashHook = (url) => { storage.removePublicCopy(client, url) }
  if (staff.perms.includes('manage')) store.trashHooks.push(trashHook)
  const onError = (m) => showToast(m, 8000, 'error')
  const has = (p) => staff.perms.includes(p)
  // ขอเลขเอกสารเป็นชุดล่วงหน้าจากฐานข้อมูล (ไม่ซ้ำข้ามเครื่อง)
  import('./chatMedia').then((m) => m.setChatMediaSigner(m.makeSigner(client))).catch(() => {})
  store.numbering.setAlloc(async (p, d, n) => { const r = await client.rpc('punpang_alloc_numbers', { p_prefix: p, p_day: d, p_n: n }); return r.error ? null : r.data })
  store.setQuoteServer((chatId, draft) => createQuoteRemote(client, chatId, draft))
  // ด่านตรวจออร์เดอร์เสี่ยง: อ่านสถานะด่าน และให้ผู้จัดการบันทึกการตรวจ (ฐานข้อมูลเป็นผู้ตัดสินจริง)
  store.setOrderGateServer({
    fetch: async (id) => {
      const r = await client.rpc('punpang_order_gate', { p_order: id })
      return r.error ? { error: 'อ่านสถานะการตรวจไม่สำเร็จ ลองใหม่อีกครั้ง' } : { state: r.data }
    },
    review: async (id, note) => {
      const r = await client.rpc('punpang_review_order', { p_order: id, p_note: note || '' })
      if (!r.error) return {}
      if (r.error.code === '42501') return { error: 'ต้องเป็นผู้จัดการจึงตรวจได้' }
      if (r.error.code === 'P0002') return { error: 'ออร์เดอร์นี้ไม่มีรายการเสี่ยงให้ตรวจแล้ว' }
      return { error: 'บันทึกการตรวจไม่สำเร็จ ลองใหม่อีกครั้ง' }
    },
  })
  // เริ่มซิงก์ทุกตารางพร้อมกัน (เดิมทีละตาราง ~35 คำขอต่อกัน = ช้า) แล้วรอทั้งชุดครั้งเดียว · ลำดับใน syncs คงเดิม
  const tasks = []
  tasks.push(items.startItemsSync({ client, db, canWrite: has('editItems'), onError }))
  // ตั้งค่า + (แอดมิน) สร้างสำเนาสาธารณะของราคา/ตัวเลือก/โปรโมชั่น/ข้อมูลร้านให้ครบ (ครั้งแรกหลังเปิดใช้) — ทำเบื้องหลังหลังโหลดตั้งค่าสำเร็จ ไม่บล็อกการเปิดหน้า
  tasks.push(config.startConfigSync({ client, db, canWrite: has('manage'), onError }).then((h) => {
    if (has('manage') && h?.loaded) {
      Promise.all([import('./publicSync'), import('./configSync')]).then(([pub, cfg]) => pub.ensureMirror(client, db, cfg.stripRecipes)).then((m) => { if (m.error) onError('เผยแพร่ข้อมูลหน้าร้านไม่สำเร็จ: ' + m.error) }).catch(() => {})
    }
    return h
  }))
  tasks.push(orders.startOrdersSync({ client, db, numbering: store.numbering, onError, onRecode: (o, c) => showToast(`เลขออร์เดอร์ซ้ำ ระบบเปลี่ยนเป็น ${c}`, 8000),
    canWrite: ['createOrder', 'pos', 'startPreparing', 'markPrepared', 'deliverPickup', 'deliverShipping', 'confirmPayment', 'reportPayment', 'cancel', 'editPickup', 'editItems', 'adjustPrice', 'changeBuyer', 'workPhoto'].some(has) }).then((h) => { store.numbering.prefetch(); return h }))
  tasks.push(customers.startCustomersSync({ client, db, canWrite: has('createOrder') || has('adjustPoints'), onError }))
  tasks.push(acct.startAcctSync({ client, db, has, onError }))
  // แชท/ใบเสนอ/กะ POS/ผู้ใช้: โหลดเมื่อเปิดหน้าที่ใช้ (ensureData) · ไม่มีสิทธิ์ = ล้างข้อมูลตัวอย่างทิ้ง
  if (!has('chat')) { db.chats.splice(0); db.quotes.splice(0) }
  store.session.userId = staff.user_id
  store.session.role = staff.role
  if (!has('manageUsers')) users.selfOnly(db, staff)
  if (!['pos', 'viewAllOrders', 'manage'].some(has)) db.shifts.splice(0)
  // ข้อมูลปฏิบัติการรายแถว (รีวิว/คูปอง/คำขอ/แจ้งเตือน/ลิงก์ ฯลฯ): อ่าน/เขียนตามสิทธิ์ · อ่านไม่ได้ = ล้างข้อมูลตัวอย่าง
  const rec = await import('./recordsSync')
  const recNames = new Set(Object.keys(rec.RECORD_SPECS))
  dataCtx = { client, store, has, onError, recNames }
  for (const [name, spec] of Object.entries(rec.RECORD_SPECS)) {
    if (rec.specAllows(spec.read, has)) tasks.push(rec.startRecordsSync({ client, db, collection: name, canWrite: rec.specAllows(spec.write, has), onError }))
    else rec.clearRecords(db, name)
  }
  for (const r of await Promise.all(tasks)) { if (Array.isArray(r)) syncs.push(...r); else syncs.push(r) }
  import('./clicksSync').then((m) => m.applyClicks(client, db)).catch(() => {})
  // ตารางที่โหลดจากเซิร์ฟเวอร์ไม่สำเร็จ → แจ้งบนแถบสถานะ (ข้อมูลที่เห็นอาจไม่ครบ) พร้อมปุ่มลองโหลดใหม่
  staffState.loadFailed = syncs.filter((x) => x && x.loaded === false).map((x) => x.label || 'ข้อมูล')
  startPolling()
  startStaffRealtime(client, recNames)
  coreDone()
  startPush() // แอป Android เท่านั้น · เว็บไม่ทำอะไร
}
// เปิดออร์เดอร์เดียว (เช่น ลิงก์จากแชท/การแจ้งเตือน) ที่อยู่นอกช่วงที่โหลดไว้: ดึงมาทีละรายการแล้วปักหมุดไว้
export async function loadOneOrder(id) {
  const [client, store, m] = await Promise.all([getSupabase(), import('../data/store'), import('./ordersSync')])
  if (!client || !id || store.findOrder(id)) return
  const r = await m.loadOrdersByIds(client, [id])
  if (r.error || !r.items?.length) return
  m.pinOrderId(id)
  store.db.orders.push(...r.items)
}
export async function reloadStaffData() { if (staffState.staff) await startData(staffState.staff) }
// ดึงข้อมูลล่าสุดของตารางที่ระบุจากเซิร์ฟเวอร์ทันที (เช่น ก่อนขาย POS: สต็อก/กะ) · ข้ามตารางที่มีแก้ค้างในเครื่อง
export async function refreshLabels(labels) {
  try { for (const x of syncs) if (x.refresh && labels.includes(x.label)) await x.refresh() } catch (e) { console.warn('รีเฟรชข้อมูลไม่สำเร็จ:', e?.message) }
}
export async function initStaff() {
  if (!supabaseEnabled) return
  // ผู้เยี่ยมชมทั่วไป (เบราว์เซอร์นี้ไม่มีเซสชันพนักงานค้าง): วาดหน้าเว็บได้เลย ไม่ต้องรอดาวน์โหลดไลบรารี Supabase และตรวจเซสชันก่อน
  // ข้อมูลหน้าร้านโหลดต่อเบื้องหลังเหมือนเดิม · ถ้าไม่แน่ใจ mayHaveStaffSession ตอบ true แล้วใช้ขั้นตอนเต็มด้านล่าง
  if (!mayHaveStaffSession()) { staffState.ready = true; loadForVisitor(); return }
  const r = await currentStaff()
  staffState.staff = r.staff || null
  staffState.ready = true
  if (r.staff) await startData(r.staff)
  else loadForVisitor() // ไม่รอ: เปิดหน้าก่อน หน้าร้านแสดงสถานะกำลังโหลดจนกว่าข้อมูลจริงจะมา
}
// ผู้เยี่ยมชมที่ไม่ล็อกอิน: อ่านข้อมูลสาธารณะของหน้าร้านจาก Supabase (อ่านอย่างเดียว)
const PUBLIC_REFRESH_MS = 60000
let pubTimer = null
let pubBusy = false
let pubRt = null
let pubDeb = null
function startPublicRealtime(client) {
  stopPublicRealtime()
  pubDeb = makeDebouncer(() => quietly(() => loadPublicNow(false)), { wait: 800, minGap: 3000 })
  pubRt = startRealtime({
    client, name: 'public-sync',
    bindings: [
      { table: 'punpang_kv', filter: 'collection=in.(shop_public,storefront,legal)', key: 'kv' },
      { table: 'punpang_items', key: 'items' },
      { table: 'punpang_records', filter: 'collection=in.(reviews,shortLinks)', key: 'records' },
    ],
    onEvent: (key) => pubDeb(key),
    onLive: (reconnect) => { if (reconnect) quietly(() => loadPublicNow(false)) },
  })
}
function stopPublicRealtime() {
  if (pubDeb) { pubDeb.cancel(); pubDeb = null }
  if (pubRt) { pubRt.stop(); pubRt = null }
}
function stopPublicRefresh() {
  stopPublicRealtime()
  if (pubTimer) { clearInterval(pubTimer); pubTimer = null }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onPubVisible)
}
function onPubVisible() { if (document.visibilityState === 'visible') loadPublicNow(false) }
// first = โหลดครั้งแรก/กดลองใหม่ (แสดงสถานะ) · ครั้งต่อไปเงียบ ผิดพลาดแล้วคงข้อมูลเดิมจากเซิร์ฟเวอร์
export async function loadPublicNow(first = true) {
  if (pubBusy || staffState.staff) return
  pubBusy = true
  if (first) { publicState.status = 'loading'; publicState.error = '' }
  try {
    const [pub, store, client] = await Promise.all([import('./publicSync'), import('../data/store'), getSupabase()])
    let ok = false, msg = ''
    // ไม่ให้หน้าเว็บค้างถ้าเซิร์ฟเวอร์ช้า: รอไม่เกิน 15 วินาที แล้วแจ้งผิดพลาด (ถ้าโหลดเสร็จทีหลังจะอัปเดตเอง)
    const done = pub.startPublicLoad({ client, db: store.db, onError: (m) => { msg = m } }).then((v) => { ok = v; return 'done' })
    const r = await Promise.race([done, new Promise((res) => setTimeout(() => res('timeout'), 15000))])
    if (r === 'timeout') done.then(() => { if (ok) publicState.status = 'ready' })
    if (ok) publicState.status = 'ready'
    else if (first || publicState.status !== 'ready') { publicState.status = 'error'; publicState.error = r === 'timeout' ? 'เซิร์ฟเวอร์ตอบช้า' : msg || 'โหลดข้อมูลไม่สำเร็จ' }
  } catch (e) {
    if (first || publicState.status !== 'ready') { publicState.status = 'error'; publicState.error = e?.message || 'โหลดข้อมูลไม่สำเร็จ' }
  } finally { pubBusy = false }
}
async function loadForVisitor() {
  setRestoring(restoreSession())
  await loadPublicNow(true)
  // สถิติคลิกแบบเค้ก (รูปแนะนำ) — โหลดเบื้องหลัง ไม่รอ
  import('./clicksSync').then(async (m) => m.applyClicks(await getSupabase(), (await import('../data/store')).db)).catch(() => {})
  stopPublicRefresh()
  pubTimer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') quietly(() => loadPublicNow(false)) }, PUBLIC_REFRESH_MS)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onPubVisible)
  if (!staffState.staff) startPublicRealtime(await getSupabase())
}
async function restoreSession() {
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

export async function staffSignOut() { await stopPush(); staffState.staff = null; staffState.loadFailed = []; dataCtx = null; groupLoads.clear(); { const m = await import('../data/store'); const i = m.trashHooks.indexOf(trashHook); if (i >= 0) m.trashHooks.splice(i, 1) }; stopPolling(); syncs.forEach((x) => x.stop()); syncs = []; const supabase = await getSupabase(); if (supabase) await supabase.auth.signOut() }
