import { startSync, withVer, fillArray } from './tableSync.js'

// ซิงก์กะ POS (db.shifts) กับ punpang_shifts · เปิดกะค้างได้ครั้งละ 1 กะ · กะที่ปิดแล้วแก้ไม่ได้ (บังคับที่ฐานข้อมูล)
export function shiftToRow(s) {
  const { id, openedAt, closedAt, ...rest } = s
  return { id, opened_at: openedAt, closed_at: closedAt || null, data: rest }
}
export function rowToShift(r) {
  return withVer({ ...(r.data || {}), id: r.id, openedAt: r.opened_at, closedAt: r.closed_at || null }, r.updated_at)
}
// หน้า POS ใช้กะที่เปิดอยู่ + กะที่ปิดล่าสุด (แสดง 10 กะ) → โหลดกะที่เปิดอยู่ทั้งหมด + ล่าสุด RECENT_SHIFTS กะ (แทนทั้งตาราง ~1 กะต่อวัน)
export const RECENT_SHIFTS = 60
const COLS = 'id,opened_at,closed_at,data,updated_at'
const byOpenedDesc = (p, q) => String(q.openedAt).localeCompare(String(p.openedAt))
export async function loadShifts(client) {
  const [open, recent] = await Promise.all([
    client.from('punpang_shifts').select(COLS).is('closed_at', null).order('opened_at', { ascending: false }).limit(20),
    client.from('punpang_shifts').select(COLS).order('opened_at', { ascending: false }).limit(RECENT_SHIFTS),
  ])
  if (open.error) return { error: open.error.message }
  if (recent.error) return { error: recent.error.message }
  const rows = new Map([...(recent.data || []), ...(open.data || [])].map((r) => [r.id, r]))
  return { items: [...rows.values()].map(rowToShift).sort(byOpenedDesc) }
}
export async function loadShiftsSince(client, since) {
  const r = await client.from('punpang_shifts').select(COLS).gte('updated_at', since).order('updated_at').limit(500)
  if (r.error) return { error: r.error.message }
  return { items: (r.data || []).map(rowToShift) }
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
    replace: (items) => fillArray(db.shifts, items),
    load: () => loadShifts(client),
    loadSince: (since) => loadShiftsSince(client, since), // อีกเครื่องเปิด/ปิดกะ → ได้มาในรอบดึงเฉพาะที่เปลี่ยน
    push: (c) => pushShifts(client, c),
    canWrite, onError, debounceMs, label: 'กะ POS', poll: true,
  })
}
