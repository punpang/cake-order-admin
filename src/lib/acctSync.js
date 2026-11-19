import { watch } from 'vue'
import { startSync, selectAll, fillArray } from './tableSync'
import { startConfigSync } from './configSync'

// ซิงก์ระบบบัญชี (db.acct) กับ Supabase
//  - รายการสมุดบัญชี   → punpang_acct_entries  (เลขที่ JV ออกโดยฐานข้อมูล)
//  - ใบกำกับ/ใบลดหนี้  → punpang_acct_invoices (เลขที่ INV/CN ออกโดยฐานข้อมูล ต่อเนื่องไม่ขาดช่วง · ลบไม่ได้)
//  - รายการแช่แข็ง     → punpang_acct_frozen
//  - ปิดงวดถึงวันที่   → punpang_acct_state
//  - ที่เหลือ (ผังบัญชี/ตั้งค่า/ภาษี/สินทรัพย์ ฯลฯ) → punpang_kv collection 'acct'
// ข้อควรระวัง: เลขที่ออกใน trigger ก่อนตรวจชนกัน ดังนั้นแถวใหม่ต้อง insert ตรง ๆ (ห้าม upsert ซ้ำ ไม่งั้นเลขหาย)
export const ACCT_KV_KEYS = ['settings', 'accounts', 'vatFilings', 'recurring', 'recurringSkips', 'deferrals', 'assets', 'installments', 'taxYears', 'taxTables', 'taxFilings', 'seq']
export const ACCT_VIEW_PERMS = ['acctView', 'acctRecord', 'acctClose', 'acctReports', 'acctTax', 'acctAssets', 'acctSettings']

export const entryToRow = (e) => ({ id: e.id, entry_date: e.date, no: e.no, data: e })
export const rowToEntry = (r) => ({ ...r.data, id: r.id, no: r.no })
export const frozenToRow = (e) => ({ id: e.id, entry_date: e.date, data: e })
export const rowToFrozen = (r) => ({ ...r.data, id: r.id })
// pending = ยังรอเลขที่จากฐานข้อมูล (ไม่เก็บลงฐานข้อมูล)
export function invoiceToRow(i) {
  const { pending, ...data } = i
  return { id: i.id, kind: i.type === 'credit' ? 'credit' : 'invoice', order_id: i.orderId || null, doc_date: i.date, no: i.no || '', year: 0, seq: 0, data }
}
export const rowToInvoice = (r) => ({ ...r.data, id: r.id, no: r.no })

// อ่านทีละหน้า (PostgREST จำกัด 1000 แถวต่อคำขอ) · where(q) = เงื่อนไขเพิ่ม (ช่วงวันที่)
export async function loadAll(client, table, cols, orderBy, where = (q) => q) {
  const r = await selectAll((a, b) => where(client.from(table).select(cols)).order(orderBy).order('id').range(a, b))
  return r.error ? { error: r.error.message } : { rows: r.data }
}
const loader = (client, table, cols, orderBy, conv, where) => async () => {
  const r = await loadAll(client, table, cols, orderBy, where ? where() : undefined)
  return r.error ? r : { items: r.rows.map(conv) }
}

// ---------- โหลดรายละเอียดเฉพาะช่วงล่าสุด ----------
// รายการบัญชี/แช่แข็ง: โหลดเฉพาะที่ลงวันที่หลัง cut · ก่อนหน้ารวมเป็น "ยอดยกมา" ที่ฐานข้อมูล (punpang_acct_opening)
// cut = วันที่เก่ากว่าระหว่าง วันปิดงวด กับ 31 ธ.ค. ของ 2 ปีก่อน (ปีนี้และปีก่อนมีรายละเอียดครบเสมอ) · ยังไม่เคยปิดงวด = โหลดทั้งหมด
// รายการถึงวันปิดงวดแก้/ลบ/เพิ่มไม่ได้ → ยอดยกมาไม่เปลี่ยนระหว่างใช้งาน · รายงานที่ดูช่วงก่อน cut ดึงรายละเอียดเพิ่ม (extend)
export function acctCutOf(closedThrough, now = new Date()) {
  if (!closedThrough) return ''
  const floor = `${now.getFullYear() - 2}-12-31`
  return closedThrough < floor ? closedThrough : floor
}
export const openingEntry = (rows, cut) => ({
  id: `opening:${cut}`, date: cut, memo: `ยอดยกมา (รวมรายการถึง ${cut})`, auto: true, opening: true, source: { type: 'opening' },
  lines: (rows || []).map((r) => ({ account: r.account, dr: Number(r.dr) || 0, cr: Number(r.cr) || 0 })),
})
export async function loadOpening(client, cut) {
  const r = await client.rpc('punpang_acct_opening', { p_through: cut })
  if (r.error) return { error: r.error.message }
  return { entry: openingEntry(r.data, cut) }
}
// ใบกำกับภาษี: โหลดตั้งแต่ต้นปีก่อน · ใบของออร์เดอร์ที่เปิดดู / ปีที่เลือกดู ดึงเพิ่ม
export const invoiceFromOf = (now = new Date()) => `${now.getFullYear() - 1}-01-01`

// แถวใหม่ = insert (ฐานข้อมูลออกเลขแล้วส่งกลับมาใส่ใน onAssign) · แถวเดิม = update เฉพาะ data
export async function pushNumbered(client, table, toRow, { upserts, deletes }, { known, onAssign, allowDelete = false, label }) {
  for (const it of upserts) {
    const row = toRow(it)
    if (known.has(it.id)) {
      const r = await client.from(table).update({ data: row.data, ...(table === 'punpang_acct_entries' ? { entry_date: row.entry_date } : {}) }).eq('id', it.id)
      if (r.error) return { error: `${label} ${it.no || it.id}: ${r.error.message}` }
      continue
    }
    const r = await client.from(table).insert(row).select('id,no,data').single()
    if (r.error) {
      if (r.error.code === '23505') { known.add(it.id); return { error: `${label} ${it.no || it.id}: มีอยู่แล้ว (จะลองใหม่)` } }
      return { error: `${label} ${it.no || it.id}: ${r.error.message}` }
    }
    known.add(it.id)
    onAssign(it, r.data)
  }
  if (allowDelete) for (const id of deletes) {
    const r = await client.from(table).delete().eq('id', id)
    if (r.error) return { error: `${label}: ${r.error.message}` }
  }
  return { ok: true }
}

function numberedSync({ client, A, field, table, cols, toRow, fromRow, assign, canWrite, onError, label, allowDelete, debounceMs, where }) {
  const known = new Set()
  return startSync({
    list: () => A[field],
    replace: (items) => { fillArray(A[field], items); known.clear(); for (const i of items) known.add(i.id) },
    applyRows: (rows) => { for (const i of rows) known.add(i.id) }, // แถวที่ดึงเพิ่มภายหลัง = มีในฐานข้อมูลแล้ว (แก้ = update)
    load: loader(client, table, cols, 'created_at', fromRow, where),
    push: (changes) => pushNumbered(client, table, toRow, changes, { known, onAssign: assign, allowDelete, label }),
    canWrite, onError, debounceMs, label,
  })
}

async function pushFrozen(client, { upserts, deletes }) {
  for (let i = 0; i < upserts.length; i += 500) {
    // ไม่ทับของเดิม (do nothing) — ตารางนี้ไม่มี policy UPDATE การ upsert แบบ do update จะถูกปฏิเสธ
    const r = await client.from('punpang_acct_frozen').upsert(upserts.slice(i, i + 500).map(frozenToRow), { onConflict: 'id', ignoreDuplicates: true })
    if (r.error) return { error: r.error.message }
  }
  for (let i = 0; i < deletes.length; i += 200) {
    const r = await client.from('punpang_acct_frozen').delete().in('id', deletes.slice(i, i + 200))
    if (r.error) return { error: r.error.message }
  }
  return { ok: true }
}

// ปิดงวดถึงวันที่ (ค่าเดียว) · อ่านไม่ได้ = ไม่เริ่ม (ไม่เขียนทับ)
// before() = ต้องเสร็จก่อนเขียนสถานะ (เช่น เขียนรายการแช่แข็งให้ครบก่อนประกาศว่าปิดงวดแล้ว) · คืน false = ยังไม่เขียน แล้วลองใหม่
async function startStateSync({ client, A, canWrite, onError, debounceMs = 400, before = null }) {
  const r = await client.from('punpang_acct_state').select('closed_through').eq('id', 1).maybeSingle()
  if (r.error || !r.data) { onError('โหลดสถานะปิดงวดไม่สำเร็จ: ' + (r.error?.message || 'ไม่พบ')); return { stop() {}, loaded: false, label: 'บัญชี' } }
  A.closedThrough = r.data.closed_through || ''
  if (!canWrite) return { stop() {}, loaded: true }
  let last = A.closedThrough
  let timer = null
  let retries = 0
  const flush = async () => {
    const now = A.closedThrough || ''
    if (now === last) return
    if (before && !(await before())) {
      if (retries++ < 5) { clearTimeout(timer); timer = setTimeout(flush, 1500) } else onError('ปิด/เปิดงวด: บันทึกรายการแช่แข็งไม่สำเร็จ จึงยังไม่บันทึกสถานะปิดงวด (ลองกดอีกครั้ง)')
      return
    }
    retries = 0
    const u = await client.from('punpang_acct_state').update({ closed_through: now }).eq('id', 1)
    if (u.error) onError('บันทึกปิดงวดไม่สำเร็จ: ' + u.error.message)
    else last = now
  }
  const stopWatch = watch(() => A.closedThrough, () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) })
  return { stop() { stopWatch(); clearTimeout(timer) }, loaded: true, flush }
}

// has(p) = พนักงานมีสิทธิ์ p หรือไม่ (บังคับจริงที่ RLS) · คืนรายการตัวหยุดซิงก์
// onFetchers(f) = ส่งตัวดึงข้อมูลเพิ่มให้ data/acct.js (extend ช่วงรายการ · ใบกำกับของออร์เดอร์ / ของปี)
export async function startAcctSync({ client, db, has, onError = () => {}, debounceMs, onFetchers = null }) {
  const A = db.acct
  const anyView = ACCT_VIEW_PERMS.some(has)
  const canInv = has('taxInvoice') || has('cancel')
  const readsInv = anyView || has('taxInvoice') || has('viewAllOrders')
  let frozenSync = null
  let entriesSync = null
  let invSync = null
  const jobs = []
  // สถานะปิดงวดก่อน (ใช้กำหนดช่วงที่โหลดรายละเอียด) · คำขอเดียว
  if (readsInv) jobs.push(await startStateSync({ client, A, canWrite: has('acctClose'), onError, debounceMs, before: anyView ? () => (frozenSync?.flush ? frozenSync.flush() : true) : null }))
  let cut = anyView ? acctCutOf(A.closedThrough) : ''
  A.opening = null
  if (cut) {
    const op = await loadOpening(client, cut)
    if (op.error) cut = '' // ยังไม่มีฟังก์ชันยอดยกมา (ยังไม่รัน migration) หรือผิดพลาด → โหลดทั้งหมดเหมือนเดิม
    else A.opening = op.entry
  }
  A.loadedCut = cut
  const afterCut = () => (q) => (cut ? q.gt('entry_date', cut) : q)
  const invFrom = invoiceFromOf()
  A.invFrom = invFrom
  if (anyView) {
    jobs.push(startSync({
      list: () => A.frozen,
      replace: (items) => fillArray(A.frozen, items),
      load: loader(client, 'punpang_acct_frozen', 'id,data,created_at', 'created_at', rowToFrozen, afterCut),
      push: (c) => pushFrozen(client, c),
      canWrite: has('acctClose'), onError, debounceMs, label: 'รายการแช่แข็ง',
    }).then((h) => (frozenSync = h)))
  }
  if (readsInv) {
    // ใบกำกับ: คนที่ไม่มีสิทธิ์บัญชีก็อ่านได้ (ใช้ในหน้าออร์เดอร์) · เลขที่ใส่กลับเมื่อเขียนสำเร็จ · โหลดตั้งแต่ต้นปีก่อน
    jobs.push(numberedSync({ client, A, field: 'taxInvoices', table: 'punpang_acct_invoices', cols: 'id,no,data,created_at', toRow: invoiceToRow, fromRow: rowToInvoice,
      assign: (inv, row) => { inv.no = row.no; delete inv.pending; for (const c of A.taxInvoices) if (c.refId === inv.id) c.refNo = row.no },
      canWrite: canInv, onError, label: 'ใบกำกับภาษี', allowDelete: false, debounceMs, where: () => (q) => q.gte('doc_date', invFrom) }).then((h) => (invSync = h)))
  }
  if (anyView) {
    jobs.push(numberedSync({ client, A, field: 'entries', table: 'punpang_acct_entries', cols: 'id,no,data,created_at', toRow: entryToRow, fromRow: rowToEntry,
      assign: (e, row) => { e.no = row.no }, canWrite: ['acctRecord', 'acctAssets', 'acctTax'].some(has), onError, label: 'รายการบัญชี', allowDelete: has('acctRecord') || has('acctAssets'), debounceMs, where: afterCut }).then((h) => (entriesSync = h)))
    jobs.push(startConfigSync({ client, db: A, canWrite: ['acctRecord', 'acctClose', 'acctTax', 'acctAssets', 'acctSettings'].some(has), onError, keys: ACCT_KV_KEYS, collection: 'acct', debounceMs }))
  }
  const out = await Promise.all(jobs)
  // รวมแถวที่ดึงเพิ่ม (ถ้ากำลังบันทึกอยู่ รอแล้วลองใหม่)
  const mergeInto = async (h, items) => {
    if (!items.length) return true
    if (!h?.merge) return false
    for (let i = 0; i < 20; i++) { if (h.merge(items)) return true; await new Promise((r) => setTimeout(r, 300)) }
    return false
  }
  let chain = Promise.resolve(true)
  // ขยายช่วงรายละเอียดให้ครอบคลุมตั้งแต่วันหลัง newCut ('' = ทั้งหมด) · ทำทีละคำขอ
  const extend = (newCut) => (chain = chain.then(async () => {
    if (!A.loadedCut || !anyView) return true
    if (newCut && newCut >= A.loadedCut) return true
    const upTo = A.loadedCut
    const range = () => (q) => { q = q.lte('entry_date', upTo); return newCut ? q.gt('entry_date', newCut) : q }
    const [e, f] = await Promise.all([
      loader(client, 'punpang_acct_entries', 'id,no,data,created_at', 'created_at', rowToEntry, range)(),
      loader(client, 'punpang_acct_frozen', 'id,data,created_at', 'created_at', rowToFrozen, range)(),
    ])
    if (e.error || f.error) { onError(`โหลดรายการบัญชีช่วงก่อนหน้าไม่สำเร็จ: ${e.error || f.error}`); return false }
    let op = null
    if (newCut) { const r = await loadOpening(client, newCut); if (r.error) { onError(`โหลดยอดยกมาไม่สำเร็จ: ${r.error}`); return false } op = r.entry }
    if (!(await mergeInto(entriesSync, e.items)) || !(await mergeInto(frozenSync, f.items))) { onError('รวมรายการบัญชีช่วงก่อนหน้าไม่สำเร็จ ลองเปิดหน้าใหม่'); return false }
    A.opening = op
    A.loadedCut = newCut
    return true
  }).catch(() => false))
  const loadedYears = new Set()
  const fetchInvoices = async (where) => {
    const r = await loader(client, 'punpang_acct_invoices', 'id,no,data,created_at', 'created_at', rowToInvoice, () => where)()
    if (r.error) return false
    return mergeInto(invSync, r.items.filter((i) => !A.taxInvoices.some((x) => x.id === i.id)))
  }
  onFetchers?.({
    extend,
    orderInvoices: (orderId) => (readsInv && orderId ? fetchInvoices((q) => q.eq('order_id', orderId)) : Promise.resolve(true)),
    invoiceYear: (year) => {
      if (!readsInv || `${year}-12-31` >= invFrom || loadedYears.has(year)) return Promise.resolve(true)
      loadedYears.add(year)
      return fetchInvoices((q) => q.gte('doc_date', `${year}-01-01`).lte('doc_date', `${year}-12-31`)).then((ok) => { if (!ok) loadedYears.delete(year); return ok })
    },
  })
  return out
}
