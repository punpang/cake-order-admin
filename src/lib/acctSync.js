import { watch } from 'vue'
import { startSync } from './tableSync'
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
const PAGE = 1000

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

// อ่านทีละหน้า (PostgREST จำกัด 1000 แถวต่อคำขอ)
export async function loadAll(client, table, cols, orderBy) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const r = await client.from(table).select(cols).order(orderBy).order('id').range(from, from + PAGE - 1)
    if (r.error) return { error: r.error.message }
    out.push(...(r.data || []))
    if ((r.data || []).length < PAGE) return { rows: out }
  }
}
const loader = (client, table, cols, orderBy, conv) => async () => {
  const r = await loadAll(client, table, cols, orderBy)
  return r.error ? r : { items: r.rows.map(conv) }
}

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

function numberedSync({ client, A, field, table, cols, toRow, fromRow, assign, canWrite, onError, label, allowDelete, debounceMs }) {
  const known = new Set()
  return startSync({
    list: () => A[field],
    replace: (items) => { A[field].splice(0, A[field].length, ...items); known.clear(); for (const i of items) known.add(i.id) },
    load: loader(client, table, cols, 'created_at', fromRow),
    push: (changes) => pushNumbered(client, table, toRow, changes, { known, onAssign: assign, allowDelete, label }),
    canWrite, onError, debounceMs, label,
  })
}

async function pushFrozen(client, { upserts, deletes }) {
  for (let i = 0; i < upserts.length; i += 500) {
    const r = await client.from('punpang_acct_frozen').upsert(upserts.slice(i, i + 500).map(frozenToRow))
    if (r.error) return { error: r.error.message }
  }
  for (let i = 0; i < deletes.length; i += 200) {
    const r = await client.from('punpang_acct_frozen').delete().in('id', deletes.slice(i, i + 200))
    if (r.error) return { error: r.error.message }
  }
  return { ok: true }
}

// ปิดงวดถึงวันที่ (ค่าเดียว) · อ่านไม่ได้ = ไม่เริ่ม (ไม่เขียนทับ)
async function startStateSync({ client, A, canWrite, onError, debounceMs = 400 }) {
  const r = await client.from('punpang_acct_state').select('closed_through').eq('id', 1).maybeSingle()
  if (r.error || !r.data) { onError('โหลดสถานะปิดงวดไม่สำเร็จ: ' + (r.error?.message || 'ไม่พบ')); return { stop() {}, loaded: false } }
  A.closedThrough = r.data.closed_through || ''
  if (!canWrite) return { stop() {}, loaded: true }
  let last = A.closedThrough
  let timer = null
  const flush = async () => {
    const now = A.closedThrough || ''
    if (now === last) return
    const u = await client.from('punpang_acct_state').update({ closed_through: now }).eq('id', 1)
    if (u.error) onError('บันทึกปิดงวดไม่สำเร็จ: ' + u.error.message)
    else last = now
  }
  const stopWatch = watch(() => A.closedThrough, () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) })
  return { stop() { stopWatch(); clearTimeout(timer) }, loaded: true, flush }
}

// has(p) = พนักงานมีสิทธิ์ p หรือไม่ (บังคับจริงที่ RLS) · คืนรายการตัวหยุดซิงก์
export async function startAcctSync({ client, db, has, onError = () => {}, debounceMs }) {
  const A = db.acct
  const anyView = ACCT_VIEW_PERMS.some(has)
  const canInv = has('taxInvoice') || has('cancel')
  const out = []
  if (anyView || has('taxInvoice') || has('viewAllOrders')) {
    out.push(await startStateSync({ client, A, canWrite: has('acctClose'), onError, debounceMs }))
    // ใบกำกับ: คนที่ไม่มีสิทธิ์บัญชีก็อ่านได้ (ใช้ในหน้าออร์เดอร์) · เลขที่ใส่กลับเมื่อฐานข้อมูลออกให้
    out.push(await numberedSync({ client, A, field: 'taxInvoices', table: 'punpang_acct_invoices', cols: 'id,no,data,created_at', toRow: invoiceToRow, fromRow: rowToInvoice,
      assign: (inv, row) => { inv.no = row.no; delete inv.pending; for (const c of A.taxInvoices) if (c.refId === inv.id) c.refNo = row.no }, // ใบลดหนี้ที่อ้างใบนี้ได้เลขอ้างอิงจริง
       canWrite: canInv, onError, label: 'ใบกำกับภาษี', allowDelete: false, debounceMs }))
  }
  if (!anyView) return out
  out.push(await numberedSync({ client, A, field: 'entries', table: 'punpang_acct_entries', cols: 'id,no,data,created_at', toRow: entryToRow, fromRow: rowToEntry,
    assign: (e, row) => { e.no = row.no }, canWrite: ['acctRecord', 'acctAssets', 'acctTax'].some(has), onError, label: 'รายการบัญชี', allowDelete: has('acctRecord') || has('acctAssets'), debounceMs }))
  out.push(await startSync({
    list: () => A.frozen,
    replace: (items) => A.frozen.splice(0, A.frozen.length, ...items),
    load: loader(client, 'punpang_acct_frozen', 'id,data,created_at', 'created_at', rowToFrozen),
    push: (c) => pushFrozen(client, c),
    canWrite: has('acctClose'), onError, debounceMs, label: 'รายการแช่แข็ง',
  }))
  out.push(await startConfigSync({ client, db: A, canWrite: ['acctRecord', 'acctClose', 'acctTax', 'acctAssets', 'acctSettings'].some(has), onError, keys: ACCT_KV_KEYS, collection: 'acct', debounceMs }))
  return out
}
