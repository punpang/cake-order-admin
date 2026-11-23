import { startSync, selectAll } from './tableSync'

// ซิงก์ข้อมูลปฏิบัติการรายแถวกับ punpang_records (1 แถวต่อ 1 รายการ แยกตาม collection)
// ชนิดข้อมูลใน db: list = อาร์เรย์ของอ็อบเจกต์มี id · strings = อาร์เรย์ของข้อความ (แต่ละข้อความ = 1 แถว) · map = อ็อบเจกต์ id→ค่า
// สิทธิ์: read/write = รายการสิทธิ์ที่ใช้ได้ (true = พนักงานทุกคน) · 'manage' ใช้ได้เสมอ — ต้องตรงกับ punpang_rec_can ในฐานข้อมูล (ฐานข้อมูลบังคับจริง)
// หมายเหตุ: ส่วนที่ลูกค้าเขียนเอง (รีวิว/คำขอ/ความยินยอม ฯลฯ ตอนยังไม่ล็อกอิน) ต้องผ่าน Edge Function ในอนาคต — ที่นี่เป็นส่วนที่พนักงานทำ
export const RECORD_SPECS = {
  reviews: { key: 'reviews', kind: 'list', order: 'desc', read: ['viewAllOrders'], write: [] },
  coupons: { key: 'coupons', kind: 'list', order: 'desc', read: ['useLoyalty', 'adjustPoints'], write: ['useLoyalty', 'adjustPoints'] },
  spinLog: { key: 'spinLog', kind: 'list', order: 'desc', read: ['useLoyalty', 'adjustPoints'], write: ['useLoyalty', 'adjustPoints'], limit: 2000 },
  photoRequests: { key: 'photoRequests', kind: 'list', order: 'desc', read: [], write: [] },
  deletionRequests: { key: 'deletionRequests', kind: 'list', order: 'desc', read: [], write: [] },
  birthdayGreeted: { key: 'birthdayGreeted', kind: 'strings', read: ['birthdays'], write: ['birthdays'] },
  notifySent: { key: 'notifySent', kind: 'strings', read: true, write: true },
  shortLinks: { key: 'shortLinks', kind: 'list', order: 'desc', read: [], write: [] },
  outbox: { key: 'outbox', kind: 'list', order: 'desc', read: ['chat', 'viewAllOrders'], write: true, limit: 1000 },
  bell: { key: 'bell', kind: 'list', order: 'desc', read: true, write: true, limit: 200 },
  orderLinks: { key: 'orderLinks', kind: 'list', order: 'asc', read: ['createOrder', 'viewAllOrders', 'sendToPayment'], write: ['createOrder', 'viewAllOrders', 'sendToPayment'] },
  consents: { key: 'consents', kind: 'list', order: 'asc', read: ['viewAllOrders', 'createOrder'], write: ['viewAllOrders', 'createOrder'] },
  chatDrafts: { key: 'chatDrafts', kind: 'map', read: ['chat'], write: ['chat'] },
  luckyTokens: { key: 'luckyTokens', kind: 'list', order: 'desc', read: ['pos'], write: ['pos'], limit: 3000 },
  // สรุปยอดฝากขาย: อ่านได้ผู้ดูยอดออร์เดอร์ · เขียน (สรุป/จ่าย) เฉพาะผู้จัดการ
  consignRounds: { key: 'consignRounds', kind: 'list', order: 'desc', read: ['viewAllOrders'], write: ['manage'], limit: 1000 },
}
export const specAllows = (rule, has) => rule === true || has('manage') || rule.some(has)

// ช่วง 5: ชุดที่โตตามลูกค้า/ออร์เดอร์ โหลดตอนล็อกอินเฉพาะที่จำเป็น (recent) · หน้าที่ต้องใช้ทั้งหมดขอแบบเต็ม (recordsFull)
// ตาราง records ไม่มี updated_at → รีเฟรชโหลดทั้งชุดเสมอ ตัวกรองจึงช่วยทุกรอบ · แถวที่ไม่ได้โหลดไม่ถูกลบ (diff ลบเฉพาะแถวที่อยู่ในสแนปช็อต)
const DAY = 86400e3
const ago = (nowMs, days) => new Date(nowMs - days * DAY).toISOString()
const pendingOrSince = (days) => (q, nowMs) => q.or(`data->>status.eq.pending,created_at.gte."${ago(nowMs, days)}"`)
const sinceDays = (days) => (q, nowMs) => q.gte('created_at', ago(nowMs, days))
export const RECORD_RECENT = {
  consents: (q, nowMs, startedAt) => q.gte('created_at', new Date(startedAt).toISOString()), // สถิติความยินยอมโหลดเมื่อเปิดหน้ากฎหมาย
  notifySent: sinceDays(400), // ครอบคลุมวันเกิดที่วนทุกปี
  birthdayGreeted: sinceDays(400),
  reviews: pendingOrSince(180),
  photoRequests: pendingOrSince(180),
  deletionRequests: pendingOrSince(180),
  // ยังใช้ได้ หรือ 400 วันล่าสุด · คูปองที่ออร์เดอร์ในเครื่องอ้างถึงปักหมุดแยก (pinRecordIds)
  coupons: (q, nowMs) => q.or(`data->>status.is.null,data->>status.not.in.(delivered,used,refunded,lapsed,void),created_at.gte."${ago(nowMs, 400)}"`),
}
export const recordsFull = new Set()
export const pinnedRecords = new Map()
let startedAt = Date.now()
export function resetRecordsScope(nowMs = Date.now()) { recordsFull.clear(); pinnedRecords.clear(); startedAt = nowMs }
export function pinRecordIds(collection, ids) {
  const set = pinnedRecords.get(collection) || new Set()
  pinnedRecords.set(collection, set)
  for (const id of ids) if (id) set.add(id)
}
// คูปองที่ออร์เดอร์อ้างถึง (ใช้ส่วนลด + คูปองคืนเงินที่ออกจากการคืน) → ต้องอยู่ในเครื่องเพื่อแก้/ยกเลิกออร์เดอร์ได้
export const orderCouponIds = (orders) => {
  const ids = new Set()
  for (const o of orders || []) {
    for (const u of o.couponsUsed || []) if (u?.couponId) ids.add(u.couponId)
    for (const r of o.refunds || []) if (r?.couponId) ids.add(r.couponId)
  }
  return [...ids]
}

const rowToItem = (kind, r) => (kind === 'strings' ? r.id : { ...(r.data || {}), id: r.id })
const itemToRow = (collection, kind, it) => (kind === 'strings' ? { collection, id: it.id, data: {} } : (({ id, ...rest }) => ({ collection, id, data: rest }))(it))

const baseQuery = (client, collection, asc) => client.from('punpang_records').select('id,data').eq('collection', collection).order('created_at', { ascending: asc }).order('id', { ascending: asc })
const sortItems = (spec, items) => {
  // แถวที่เพิ่มพร้อมกันมี created_at เท่ากัน → เรียงซ้ำด้วยเวลาในข้อมูล (createdAt/at) ให้ตรงลำดับในแอป
  if (spec.kind === 'list') {
    const asc = spec.order === 'asc'
    const t = (x) => String(x.createdAt || x.at || '')
    if (items.some((x) => t(x))) items.sort((a, b) => (asc ? t(a).localeCompare(t(b)) : t(b).localeCompare(t(a))))
  }
  return items
}
// ดึงตาม id (ทีละ 100 · ความยาว URL)
export async function fetchRecordIds(client, collection, spec, ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    const r = await client.from('punpang_records').select('id,data').eq('collection', collection).in('id', ids.slice(i, i + 100))
    if (r.error) return { error: r.error.message }
    out.push(...(r.data || []))
  }
  return { items: sortItems(spec, out.map((x) => rowToItem(spec.kind, x))) }
}

export async function loadRecords(client, collection, spec, nowMs = Date.now()) {
  const asc = spec.order === 'asc'
  const recent = recordsFull.has(collection) ? null : RECORD_RECENT[collection]
  const r = spec.limit
    ? await baseQuery(client, collection, asc).limit(spec.limit)
    : await selectAll((a, b) => (recent ? recent(baseQuery(client, collection, asc), nowMs, startedAt) : baseQuery(client, collection, asc)).range(a, b))
  if (r.error) return { error: r.error.message }
  const rows = r.data || []
  // แถวที่ปักหมุดไว้แต่ไม่ผ่านตัวกรอง → ดึงเพิ่ม (กันรีเฟรชรอบถัดไปเอาออกจากเครื่อง)
  const pins = recent ? [...(pinnedRecords.get(collection) || [])] : []
  if (pins.length) {
    const have = new Set(rows.map((x) => x.id))
    const miss = pins.filter((id) => !have.has(id))
    for (let i = 0; i < miss.length; i += 100) {
      const p = await client.from('punpang_records').select('id,data').eq('collection', collection).in('id', miss.slice(i, i + 100))
      if (p.error) return { error: p.error.message }
      rows.push(...(p.data || []))
    }
  }
  return { items: sortItems(spec, rows.map((x) => rowToItem(spec.kind, x))) }
}

export async function pushRecords(client, collection, spec, { upserts, deletes }) {
  for (let i = 0; i < upserts.length; i += 200) {
    const r = await client.from('punpang_records').upsert(upserts.slice(i, i + 200).map((it) => itemToRow(collection, spec.kind, it)), { onConflict: 'collection,id' })
    if (r.error) return { error: r.error.message }
  }
  for (let i = 0; i < deletes.length; i += 100) {
    const r = await client.from('punpang_records').delete().eq('collection', collection).in('id', deletes.slice(i, i + 100))
    if (r.error) return { error: r.error.message }
  }
  return { ok: true }
}

// อะแดปเตอร์ให้ startSync ใช้ได้กับทั้ง 3 ชนิด
function adapter(db, spec) {
  const k = spec.key
  if (spec.kind === 'strings') return { list: () => db[k].map((s) => ({ id: s })), replace: (items) => { db[k] = items } }
  if (spec.kind === 'map') return {
    list: () => Object.entries(db[k] || {}).map(([id, v]) => ({ ...v, id })),
    replace: (items) => { for (const x of Object.keys(db[k])) delete db[k][x]; for (const it of items) { const { id, ...v } = it; db[k][id] = v } },
  }
  return { list: () => db[k], replace: (items) => db[k].splice(0, db[k].length, ...items) }
}

export function startRecordsSync({ client, db, collection, canWrite, onError, debounceMs }) {
  const spec = RECORD_SPECS[collection]
  const ad = adapter(db, spec)
  return startSync({
    list: ad.list, replace: ad.replace,
    load: () => loadRecords(client, collection, spec),
    push: (c) => pushRecords(client, collection, spec, c),
    canWrite, onError, debounceMs, label: collection, poll: true,
  })
}

// ล้างข้อมูลตัวอย่างของ collection ที่ผู้ใช้อ่านไม่ได้ (ไม่ให้ข้อมูลจำลองปนกับของจริง)
export function clearRecords(db, collection) {
  const spec = RECORD_SPECS[collection]
  if (spec.kind === 'map') for (const x of Object.keys(db[spec.key])) delete db[spec.key][x]
  else db[spec.key].splice(0, db[spec.key].length)
}
