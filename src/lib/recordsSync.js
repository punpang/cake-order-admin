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
  consents: { key: 'consents', kind: 'list', order: 'asc', read: ['viewAllOrders', 'createOrder'], write: true },
  chatDrafts: { key: 'chatDrafts', kind: 'map', read: ['chat'], write: ['chat'] },
}
export const specAllows = (rule, has) => rule === true || has('manage') || rule.some(has)

const rowToItem = (kind, r) => (kind === 'strings' ? r.id : { ...(r.data || {}), id: r.id })
const itemToRow = (collection, kind, it) => (kind === 'strings' ? { collection, id: it.id, data: {} } : (({ id, ...rest }) => ({ collection, id, data: rest }))(it))

export async function loadRecords(client, collection, spec) {
  const asc = spec.order === 'asc'
  const r = spec.limit
    ? await client.from('punpang_records').select('id,data').eq('collection', collection).order('created_at', { ascending: asc }).order('id', { ascending: asc }).limit(spec.limit)
    : await selectAll((a, b) => client.from('punpang_records').select('id,data').eq('collection', collection).order('created_at', { ascending: asc }).order('id', { ascending: asc }).range(a, b))
  if (r.error) return { error: r.error.message }
  const items = (r.data || []).map((x) => rowToItem(spec.kind, x))
  // แถวที่เพิ่มพร้อมกันมี created_at เท่ากัน → เรียงซ้ำด้วยเวลาในข้อมูล (createdAt/at) ให้ตรงลำดับในแอป
  if (spec.kind === 'list') {
    const t = (x) => String(x.createdAt || x.at || '')
    if (items.some((x) => t(x))) items.sort((a, b) => (asc ? t(a).localeCompare(t(b)) : t(b).localeCompare(t(a))))
  }
  return { items }
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
    canWrite, onError, debounceMs, label: collection,
  })
}

// ล้างข้อมูลตัวอย่างของ collection ที่ผู้ใช้อ่านไม่ได้ (ไม่ให้ข้อมูลจำลองปนกับของจริง)
export function clearRecords(db, collection) {
  const spec = RECORD_SPECS[collection]
  if (spec.kind === 'map') for (const x of Object.keys(db[spec.key])) delete db[spec.key][x]
  else db[spec.key].splice(0, db[spec.key].length)
}
