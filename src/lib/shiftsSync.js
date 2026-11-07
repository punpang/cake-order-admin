import { startSync, selectAll } from './tableSync'

// ซิงก์กะ POS (db.shifts) กับ punpang_shifts · เปิดกะค้างได้ครั้งละ 1 กะ · กะที่ปิดแล้วแก้ไม่ได้ (บังคับที่ฐานข้อมูล)
export function shiftToRow(s) {
  const { id, openedAt, closedAt, ...rest } = s
  return { id, opened_at: openedAt, closed_at: closedAt || null, data: rest }
}
export function rowToShift(r) {
  return { ...(r.data || {}), id: r.id, openedAt: r.opened_at, closedAt: r.closed_at || null }
}
export async function loadShifts(client) {
  const a = await selectAll((x, y) => client.from('punpang_shifts').select('id,opened_at,closed_at,data').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToShift).sort((p, q) => String(q.openedAt).localeCompare(String(p.openedAt))) }
}
export async function pushShifts(client, { upserts }) {
  for (const s of upserts) {
    const r = await client.from('punpang_shifts').upsert(shiftToRow(s))
    if (r.error) {
      if (r.error.code === '23505') return { error: 'มีกะที่เปิดอยู่แล้วบนอีกเครื่อง (รีเฟรชหน้าเพื่อใช้กะเดิม)' }
      if (/ปิดแล้ว/.test(r.error.message || '')) return { error: 'กะนี้ปิดแล้ว แก้ไขไม่ได้' }
      return { error: r.error.message }
    }
  }
  return { ok: true }
}
export function startShiftsSync({ client, db, canWrite, onError, debounceMs }) {
  return startSync({
    list: () => db.shifts,
    replace: (items) => db.shifts.splice(0, db.shifts.length, ...items),
    load: () => loadShifts(client),
    push: (c) => pushShifts(client, c),
    canWrite, onError, debounceMs, label: 'กะ POS',
  })
}
