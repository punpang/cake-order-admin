import { startSync } from './tableSync'

// ซิงก์ออร์เดอร์ (db.orders) กับ punpang_orders · ชำระเงิน/รายการ/ประวัติ ฯลฯ อยู่ใน data (jsonb)
// สิทธิ์ตรวจที่ฐานข้อมูลด้วย trigger (เปลี่ยนสถานะ/ยืนยันชำระ/ยกเลิกยอด/แจ้งยอด) — ดู punpang_guard_status
// ออร์เดอร์ไม่ถูกลบจริง (ใช้สถานะ cancelled) — ตารางไม่มี policy ลบ จึงข้ามการลบ
export function orderToRow(o) {
  const { id, code, customerId, status, fulfillment, channel, ...rest } = o
  // pickupAt เป็นเวลาท้องถิ่นแบบไม่มีโซน เก็บฉบับจริงใน data · คอลัมน์ pickup_at ไว้เรียง/ค้นหาเท่านั้น
  return { id, code, customer_id: customerId || null, status, fulfillment, channel: channel || null, pickup_at: o.pickupAt || null, data: rest }
}
export function rowToOrder(r) {
  const d = r.data || {}
  return { ...d, id: r.id, code: r.code, customerId: r.customer_id || '', status: r.status, fulfillment: r.fulfillment, ...(r.channel ? { channel: r.channel } : {}) }
}
export const codeNumber = (code) => { const m = /^OR-(\d+)$/.exec(String(code || '')); return m ? Number(m[1]) : 0 }

export async function loadOrders(client) {
  const a = await client.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data').order('code')
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToOrder) }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// หาเลขออร์เดอร์ที่ว่าง (กรณีสองเครื่องออกเลขพร้อมกัน)
export async function nextFreeCode(client) {
  const r = await client.from('punpang_orders').select('code').order('code', { ascending: false }).limit(200)
  const max = Math.max(0, ...((r.data || []).map((x) => codeNumber(x.code))))
  return `OR-${String(max + 1).padStart(4, '0')}`
}

// เขียนทีละรายการ: FK ลูกค้ายังไม่ถูกซิงก์ (23503) → รอแล้วลองใหม่ · เลขซ้ำ (23505) → ออกเลขใหม่
export async function pushOrders(client, { upserts }, { retryDelay = 1200, onRecode = () => {} } = {}) {
  for (const o of upserts) {
    let tries = 0
    for (;;) {
      const r = await client.from('punpang_orders').upsert(orderToRow(o))
      if (!r.error) break
      const code = r.error.code
      if (code === '23503' && tries < 3) { tries++; await wait(retryDelay); continue }
      if (code === '23505' && tries < 3) {
        tries++
        const fresh = await nextFreeCode(client)
        o.code = fresh // reactive: ปรับเลขในแอปด้วย
        onRecode(o, fresh)
        continue
      }
      return { error: `${o.code || o.id}: ${r.error.message}` }
    }
  }
  return { ok: true }
}

export function startOrdersSync({ client, db, canWrite, onError, onRecode, bumpOrderNo, debounceMs, retryDelay }) {
  return startSync({
    list: () => db.orders,
    replace: (items) => {
      db.orders.splice(0, db.orders.length, ...items)
      if (bumpOrderNo) bumpOrderNo(Math.max(0, ...items.map((i) => codeNumber(i.code))))
    },
    load: () => loadOrders(client),
    push: (changes) => pushOrders(client, changes, { onRecode, retryDelay }),
    canWrite, onError, debounceMs, label: 'ออร์เดอร์',
  })
}
