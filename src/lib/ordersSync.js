import { startSync, selectAll, withVer, casUpdate, fillArray } from './tableSync'
import { orderRowOf, balanceOf } from './orderCreate.js'
import { parseNo } from './docNo'
import { orderTotals } from './pricing'
import { STATUS } from './constants'
import { externalizeOrderImages, privateRefsOf, removePrivate } from './storage'

// ตารางออร์เดอร์ในเครื่อง = ทุกออร์เดอร์ที่สถานะไม่ใช่ยกเลิก/ส่งมอบแล้ว (ไม่จำกัดช่วงเวลา) · หน้าที่ต้องใช้ประวัติทั้งหมดเปิดโหมดเต็ม (setOrdersFullHistory)
let fullHistory = false
export function setOrdersFullHistory(on) { fullHistory = !!on }
// ออร์เดอร์ที่เปิดดูเฉพาะรายการ (นอกช่วง) ต้องคงอยู่ในเครื่องระหว่างรีเฟรช
const pinned = new Set()
export function pinOrderId(id) { pinned.add(id) }
export function clearPinnedOrders() { pinned.clear() }

// ซิงก์ออร์เดอร์ (db.orders) กับ punpang_orders · ชำระเงิน/รายการ/ประวัติ ฯลฯ อยู่ใน data (jsonb)
// สิทธิ์ตรวจที่ฐานข้อมูลด้วย trigger (เปลี่ยนสถานะ/ยืนยันชำระ/ยกเลิกยอด/แจ้งยอด) — ดู punpang_guard_status
// ออร์เดอร์ไม่ถูกลบจริง (ใช้สถานะ cancelled) — ตารางไม่มี policy ลบ จึงข้ามการลบ
// ยอดคงค้าง (คอลัมน์ balance) ใช้กรองการชำระเงินที่ฐานข้อมูล · คำนวณจากข้อมูลออร์เดอร์ตอนเขียน
// แถวฐานข้อมูลของออร์เดอร์ใช้ตัวเดียวกับ Edge Function order-create (ดู orderCreate.js)
export const orderToRow = orderRowOf
export function rowToOrder(r) {
  const d = r.data || {}
  return withVer({ ...d, id: r.id, code: r.code, customerId: r.customer_id || '', status: r.status, fulfillment: r.fulfillment, ...(r.channel ? { channel: r.channel } : {}) }, r.updated_at)
}

export async function loadOrders(client) {
  const a = await selectAll((x, y) => {
    let qy = client.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data,updated_at')
    if (!fullHistory) qy = qy.not('status', 'in', '(cancelled,delivered)')
    return qy.order('code').order('id').range(x, y)
  })
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToOrder) }
}

// ดึงเฉพาะแถวที่แก้หลังเวลา since (ทุกสถานะ: ออร์เดอร์ที่เพิ่งปิดต้องถูกเอาออกจากเครื่องด้วย keep ของ startOrdersSync)
export async function loadOrdersSince(client, since) {
  const a = await selectAll((x, y) => client.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data,updated_at').gte('updated_at', since).order('updated_at').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToOrder) }
}
// ดึงเฉพาะออร์เดอร์ที่หน้านั้นต้องใช้ (แทนการโหลดประวัติทั้งหมด) · เงื่อนไขในชุดเดียวกัน = ต้องตรงทุกข้อ
// customerId / customerIds · pickupFrom–pickupTo (YYYY-MM-DD วันนัด รวมทั้งสองวัน) · updatedSince / createdSince / createdBefore (ISO)
// birthdays = มีวันเกิดและไม่ยกเลิก · deliveredReported = ส่งมอบแล้วแต่ยังมีงวดที่แจ้งรอตรวจ
const ORDER_COLS = 'id,code,customer_id,status,fulfillment,channel,data,updated_at'
const WHERE_KEYS = ['customerId', 'customerIds', 'pickupFrom', 'pickupTo', 'updatedSince', 'createdSince', 'createdBefore', 'birthdays', 'deliveredReported']
export async function loadOrdersWhere(client, spec = {}) {
  if (!WHERE_KEYS.some((k) => spec[k])) return { error: 'ต้องระบุเงื่อนไขอย่างน้อยหนึ่งข้อ (ห้ามดึงออร์เดอร์ทั้งตาราง)' }
  if (spec.customerIds && !spec.customerIds.length) return { items: [] }
  const a = await selectAll((x, y) => {
    let qy = client.from('punpang_orders').select(ORDER_COLS)
    if (spec.customerId) qy = qy.eq('customer_id', spec.customerId)
    if (spec.customerIds) qy = qy.in('customer_id', spec.customerIds)
    if (spec.pickupFrom) qy = qy.gte('pickup_at', spec.pickupFrom)
    if (spec.pickupTo) qy = qy.lt('pickup_at', nextDay(spec.pickupTo))
    if (spec.updatedSince) qy = qy.gte('updated_at', spec.updatedSince)
    if (spec.createdSince) qy = qy.gte('created_at', spec.createdSince)
    if (spec.createdBefore) qy = qy.lt('created_at', spec.createdBefore)
    if (spec.birthdays) qy = qy.not('data->birthday->>md', 'is', null).neq('status', 'cancelled')
    if (spec.deliveredReported) qy = qy.eq('status', 'delivered').filter('data->payments', 'cs', JSON.stringify([{ status: 'reported' }])) // ต้องเป็นข้อความ JSON (อาร์เรย์ของอ็อบเจกต์ใน contains() ถูกแปลงผิด)
    return qy.order('id').range(x, y)
  })
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToOrder) }
}
// จำนวนออร์เดอร์ของลูกค้าแต่ละคน (ทุกสถานะ) · ดึงเฉพาะคอลัมน์ customer_id ทีละ 100 คน
export async function loadOrderCounts(client, customerIds) {
  const out = new Map(customerIds.map((id) => [id, 0]))
  for (let i = 0; i < customerIds.length; i += 100) {
    const part = customerIds.slice(i, i + 100)
    const a = await selectAll((x, y) => client.from('punpang_orders').select('id,customer_id').in('customer_id', part).order('id').range(x, y))
    if (a.error) return { error: a.error.message }
    for (const r of a.data || []) out.set(r.customer_id, (out.get(r.customer_id) || 0) + 1)
  }
  return { counts: out }
}
// อยู่ในชุดที่โหลดไว้ไหม: โหมดประวัติเต็ม = ทุกแถว · ปกติ = ยังไม่ปิด หรือถูกปักหมุดเปิดดูอยู่
export const keepOrder = (o) => fullHistory || pinned.has(o.id) || !['cancelled', 'delivered'].includes(o.status)

// หน้าออเดอร์: ดึงเฉพาะแถวตามตัวกรอง (กรองที่ฐานข้อมูล) · from/to = YYYY-MM-DD ของวันนัด (รวมทั้งสองวัน) · ว่าง = ไม่จำกัด
// pickup_at เป็น timestamptz แต่แอปเก็บเวลานัดแบบท้องถิ่นไม่มีโซน → เทียบด้วยโซนเดียวกับตอนเขียน (ช่วง [from, to+1 วัน))
const nextDay = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
// กรองการชำระเงินที่ฐานข้อมูล: due = ค้างชำระ · paid = ชำระครบ · over = ชำระเกิน (ไม่รวมที่ยกเลิก)
const applyPay = (qy, payState) => {
  if (!payState) return qy
  qy = qy.neq('status', 'cancelled')
  return payState === 'due' ? qy.gt('balance', 0) : payState === 'paid' ? qy.eq('balance', 0) : payState === 'over' ? qy.lt('balance', 0) : qy
}
export async function loadOrdersInRange(client, { from = '', to = '', status = '', fulfillment = '', includePos = true, onlyPos = false, openOnly = false, payState = '' } = {}) {
  const a = await selectAll((x, y) => {
    let qy = client.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data,updated_at')
    if (openOnly) qy = qy.not('status', 'in', '(cancelled,delivered)') // ไม่เลือกช่วงวันที่ = ทุกออร์เดอร์ที่ยังไม่ยกเลิก/ส่งมอบ
    qy = applyPay(qy, payState)
    if (from) qy = qy.gte('pickup_at', from)
    if (to) qy = qy.lt('pickup_at', nextDay(to))
    if (status) qy = qy.eq('status', status)
    if (fulfillment) qy = qy.eq('fulfillment', fulfillment)
    if (!includePos) qy = qy.or('channel.is.null,channel.neq.pos')
    if (onlyPos) qy = qy.eq('channel', 'pos') // หน้าบิลหน้าร้านย้อนหลัง: เฉพาะบิล POS
    return qy.order('code').order('id').range(x, y)
  })
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToOrder) }
}

// นับจำนวนตามตัวกรองเดียวกับรายการ (ไม่รวมตัวกรองสถานะ) → { all, pos, byStatus } · ใช้แถบสถานะ/ตัวเลขบนหน้า
export async function countOrders(client, { from = '', to = '', fulfillment = '', includePos = true, openOnly = false, payState = '' } = {}) {
  const base = () => {
    let qy = client.from('punpang_orders').select('id', { count: 'exact', head: true })
    if (from) qy = qy.gte('pickup_at', from)
    if (to) qy = qy.lt('pickup_at', nextDay(to))
    if (openOnly) qy = qy.not('status', 'in', '(cancelled,delivered)')
    if (fulfillment) qy = qy.eq('fulfillment', fulfillment)
    return applyPay(qy, payState)
  }
  const scoped = () => (includePos ? base() : base().or('channel.is.null,channel.neq.pos'))
  const statuses = Object.keys(STATUS)
  const res = await Promise.all([scoped(), base().eq('channel', 'pos'), ...statuses.map((s) => scoped().eq('status', s))])
  const bad = res.find((r) => r.error)
  if (bad) return { error: bad.error.message }
  return { all: res[0].count || 0, pos: res[1].count || 0, byStatus: Object.fromEntries(statuses.map((s, i) => [s, res[i + 2].count || 0])) }
}

// เติมคอลัมน์ยอดคงค้างของออร์เดอร์เก่าที่ยังว่าง (ทำครั้งเดียวจากข้อมูลในเครื่อง · เฉพาะผู้มีสิทธิ์เขียน)
export async function backfillBalances(client, db) {
  const r = await client.from('punpang_orders').select('id').is('balance', null).limit(5000)
  if (r.error || !r.data?.length) return
  const need = new Set(r.data.map((x) => x.id))
  const todo = db.orders.filter((o) => need.has(o.id))
  for (let i = 0; i < todo.length; i += 20) {
    // เติมคอลัมน์แล้ว updated_at ขยับ → อัปเดตเวอร์ชันในเครื่องด้วย (ไม่งั้นการแก้ครั้งถัดไปจะชนเวอร์ชัน)
    await Promise.all(todo.slice(i, i + 20).map(async (o) => { const c = await casUpdate(client, 'punpang_orders', o.id, { balance: balanceOf(o) }, null); if (c.ok) withVer(o, c.ver) }))
  }
}

// ค้นข้อความทุกวันที่เซิร์ฟเวอร์ (RPC punpang_order_search) · ยังไม่มี RPC/ล้มเหลว → { error } ให้หน้าจอค้นจากข้อมูลในเครื่องแทน
export async function searchOrdersRemote(client, q) {
  const a = await selectAll((x, y) => client.rpc('punpang_order_search', { q }).range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToOrder) }
}

export async function loadOrdersByIds(client, ids) {
  const r = await client.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data,updated_at').in('id', ids)
  if (r.error) return { error: r.error.message }
  return { items: (r.data || []).map(rowToOrder) }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ข้อมูลที่เซิร์ฟเวอร์ต้องการเพื่อคิดราคาและบันทึกออร์เดอร์ใหม่ (ราคาที่แอปคิดไว้ไม่ถูกส่งเป็นราคาจริง)
const DELIVERY_KEYS = ['address', 'shippingFee', 'placeName', 'mapUrl', 'detail', 'distanceKm', 'feeManual']
function draftOf(o) {
  const d = { customerId: o.customerId || '', fulfillment: o.fulfillment, pickupAt: o.pickupAt, birthday: o.birthday ? { name: o.birthday.name || '', md: o.birthday.md } : null, items: (o.items || []).map((i) => ({ ...i })), adjustment: o.adjustment || null }
  for (const k of DELIVERY_KEYS) if (o[k] !== undefined) d[k] = o[k]
  return d
}
// เรียก Edge Function order-create: คืน { ok, row } หรือ { ok:false, code, message }
async function createOrderRemote(client, o) {
  const { data, error } = await client.functions.invoke('order-create', { body: {
    id: o.id, code: o.code, asDraft: o.status === 'draft', chatId: o.chatId || null, quoteId: o.quoteId || null,
    by: o.history?.[0]?.by || '', draft: draftOf(o), occasionKind: o.occasion?.kind || '', occasionConsent: !!o.occasion?.consent,
  } })
  if (!error && data?.row) return { ok: true, row: data.row }
  if (!error) return { ok: false, code: '', message: 'ตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง' }
  let j = {}
  try { j = (await error.context?.json?.()) || {} } catch { j = {} }
  return { ok: false, code: j.code || '', message: j.error || error.message || 'บันทึกออร์เดอร์ไม่สำเร็จ' }
}
// รับค่าที่เซิร์ฟเวอร์บันทึกจริงมาแสดง (ราคา รายการ ประวัติ) และตั้งเวอร์ชันสำหรับการแก้ครั้งต่อไป
function mergeServerOrder(o, row) {
  const fresh = rowToOrder(row)
  for (const k of Object.keys(fresh)) o[k] = fresh[k]
  withVer(o, row.updated_at)
}

// เขียนทีละรายการ: แถวใหม่ = insert · แถวที่มีในฐานข้อมูลแล้ว (known) = update
// ห้ามใช้ upsert: PostgREST ส่งเป็น INSERT ... ON CONFLICT และ Postgres ตรวจ policy ฝั่ง INSERT กับแถวที่ส่งด้วย
// ทำให้ออร์เดอร์ที่สถานะไปไกลกว่า draft/awaiting_payment ถูกปฏิเสธ (403) ทุกครั้งที่แก้
// FK ลูกค้ายังไม่ถูกซิงก์ (23503) → รอแล้วลองใหม่ · เลขซ้ำ (23505) → ออกเลขใหม่
export async function pushOrders(client, { upserts }, { retryDelay = 1200, onRecode = () => {}, onGate = () => {}, onCreated = () => {}, numbering = null, known = new Set(), slips = new Map() } = {}) {
  const cache = new Map()
  const conflicts = []
  for (const o of upserts) {
    // รูปในเครื่อง (สลิป/รูปงาน/รูปตัวอย่าง) → อัปโหลดไป bucket ส่วนตัวก่อน (ล้มเหลว = ไม่เขียนออร์เดอร์นี้)
    try { await externalizeOrderImages(client, o, cache) } catch (e) { return { error: `${o.code || o.id}: อัปโหลดรูปไม่สำเร็จ: ${e.message}` } }
    let tries = 0
    for (;;) {
      const row = orderToRow(o)
      let r
      if (known.has(o.id)) {
        // แก้แถวเดิมแบบเทียบเวอร์ชัน: มีคนอื่น/ระบบ (เช่น ลูกค้าแจ้งชำระ) แก้ไปก่อน = ไม่เขียนทับ รายงาน conflict
        const c = await casUpdate(client, 'punpang_orders', o.id, (({ id, ...rest }) => rest)(row), o._v)
        if (c.conflict) { conflicts.push(o.id); break }
        r = c.error ? { error: c.error } : {}
        if (c.ok) withVer(o, c.ver)
      } else if (o.channel === 'pos') {
        r = await client.from('punpang_orders').insert(row) // บิลหน้าร้าน: เขียนตรง (ตรวจหลังบันทึกด้วย pos_audit)
      } else {
        // แถวใหม่: ส่งให้เซิร์ฟเวอร์คิดราคาและบันทึก (order-create) · รับแถวที่บันทึกจริงมาแสดง
        const c = await createOrderRemote(client, o)
        if (c.ok) { mergeServerOrder(o, c.row); r = {} }
        else if (c.code === 'exists') { known.add(o.id); continue } // มีแถวนี้แล้ว → รอบถัดไปแก้แถวเดิม
        else r = { error: { code: c.code === 'code' ? '23505' : c.code === 'fk' ? '23503' : (c.code || ''), message: c.message } }
      }
      if (!r.error) {
        const wasNew = !known.has(o.id)
        known.add(o.id)
        if (wasNew) onCreated(o) // แจ้งลูกค้า/ทีมหลังเซิร์ฟเวอร์บันทึกแล้วเท่านั้น
        // รูปที่ไม่ถูกอ้างถึงแล้ว (เปลี่ยนรูป/ลบรูป/ล้างข้อมูลลูกค้า) → ลบไฟล์
        const cur = privateRefsOf(o), prev = slips.get(o.id)
        slips.set(o.id, cur)
        if (prev) { const gone = [...prev].filter((x) => !cur.has(x)); if (gone.length) await removePrivate(client, gone) }
        break
      }
      const code = r.error.code
      // ด่านตรวจออร์เดอร์เสี่ยง: ฐานข้อมูลไม่รับการยืนยันชำระ/ส่งมอบ → ไม่ค้างทั้งชุด · โหลดแถวจากฐานข้อมูลกลับมา (สถานะย้อนกลับ)
      if (code === 'P0001' && r.error.hint === 'ORDER_REVIEW_REQUIRED') { onGate(`${o.code || o.id}: ต้องให้ผู้จัดการตรวจก่อนยืนยันชำระหรือส่งมอบ สถานะถูกคืนค่าเดิม`); conflicts.push(o.id); break }
      if (code === '23505' && !known.has(o.id) && /pkey/.test(r.error.message || '') && tries < 3) { tries++; known.add(o.id); continue } // มีอยู่แล้ว → แก้แทน
      if (code === '23503' && tries < 3) { tries++; await wait(retryDelay); continue }
      if (code === '23505' && tries < 3) {
        tries++
        if (!numbering) return { error: `${o.code}: เลขซ้ำ` }
        const fresh = numbering.next(parseNo(o.code)?.prefix || (o.channel === 'pos' ? 'POS' : 'OR'))
        o.code = fresh // reactive: ปรับเลขในแอปด้วย
        onRecode(o, fresh)
        continue
      }
      return { error: `${o.code || o.id}: ${r.error.message}` }
    }
  }
  return conflicts.length ? { ok: true, conflicts } : { ok: true }
}

export function startOrdersSync({ client, db, canWrite, onError, onRecode, onCreated, numbering, debounceMs, retryDelay, onCustomerIds = null }) {
  const known = new Set()
  const slips = new Map()
  return startSync({
    list: () => db.orders,
    replace: (items, { refresh = false } = {}) => {
      // คงออร์เดอร์ที่เปิดดูเฉพาะรายการ (ปักหมุดไว้) แม้อยู่นอกช่วง
      const ids = new Set(items.map((i) => i.id))
      const stay = db.orders.filter((o) => pinned.has(o.id) && !ids.has(o.id))
      fillArray(db.orders, items, stay)
      known.clear()
      slips.clear()
      for (const i of items) { known.add(i.id); slips.set(i.id, privateRefsOf(i)) }
      // ตัวนับเลข: ล้างเลขจากข้อมูลตัวอย่าง แล้วตั้งตามเลขที่มีอยู่จริง
      if (numbering) numbering.seen(items.map((i) => i.code), { reset: !refresh }) // รีเฟรชระหว่างใช้งาน: ห้ามล้างตัวนับ/ชุดเลขที่ขอไว้
      onCustomerIds?.(items.map((i) => i.customerId)) // โหมดโหลดลูกค้าเฉพาะที่ใช้: ดึงลูกค้าของออร์เดอร์ที่ยังไม่มีในเครื่อง
    },
    load: () => loadOrders(client),
    loadSince: (since) => loadOrdersSince(client, since),
    keep: keepOrder,
    loadByIds: (ids) => loadOrdersByIds(client, ids),
    applyRows: (rows) => { for (const i of rows) { known.add(i.id); slips.set(i.id, privateRefsOf(i)) } if (numbering) numbering.seen(rows.map((i) => i.code), { reset: false }); onCustomerIds?.(rows.map((i) => i.customerId)) },
    push: (changes) => pushOrders(client, changes, { onRecode, onCreated, retryDelay, numbering, known, slips, onGate: (m) => onError(m) }),
    canWrite, onError, debounceMs, label: 'ออร์เดอร์', poll: true,
  }).then((h) => { if (canWrite) backfillBalances(client, db).catch(() => {}); return h })
}
