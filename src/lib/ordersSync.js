import { startSync, selectAll } from './tableSync'
import { parseNo } from './docNo'
import { externalizeOrderImages, privateRefsOf, removePrivate } from './storage'

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

export async function loadOrders(client) {
  const a = await selectAll((x, y) => client.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data').order('code').order('id').range(x, y))
  if (a.error) return { error: a.error.message }
  return { items: (a.data || []).map(rowToOrder) }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// เขียนทีละรายการ: แถวใหม่ = insert · แถวที่มีในฐานข้อมูลแล้ว (known) = update
// ห้ามใช้ upsert: PostgREST ส่งเป็น INSERT ... ON CONFLICT และ Postgres ตรวจ policy ฝั่ง INSERT กับแถวที่ส่งด้วย
// ทำให้ออร์เดอร์ที่สถานะไปไกลกว่า draft/awaiting_payment ถูกปฏิเสธ (403) ทุกครั้งที่แก้
// FK ลูกค้ายังไม่ถูกซิงก์ (23503) → รอแล้วลองใหม่ · เลขซ้ำ (23505) → ออกเลขใหม่
export async function pushOrders(client, { upserts }, { retryDelay = 1200, onRecode = () => {}, numbering = null, known = new Set(), slips = new Map() } = {}) {
  const cache = new Map()
  for (const o of upserts) {
    // รูปในเครื่อง (สลิป/รูปงาน/รูปตัวอย่าง) → อัปโหลดไป bucket ส่วนตัวก่อน (ล้มเหลว = ไม่เขียนออร์เดอร์นี้)
    try { await externalizeOrderImages(client, o, cache) } catch (e) { return { error: `${o.code || o.id}: อัปโหลดรูปไม่สำเร็จ: ${e.message}` } }
    let tries = 0
    for (;;) {
      const row = orderToRow(o)
      const r = known.has(o.id)
        ? await client.from('punpang_orders').update((({ id, ...rest }) => rest)(row)).eq('id', o.id)
        : await client.from('punpang_orders').insert(row)
      if (!r.error) {
        known.add(o.id)
        // รูปที่ไม่ถูกอ้างถึงแล้ว (เปลี่ยนรูป/ลบรูป/ล้างข้อมูลลูกค้า) → ลบไฟล์
        const cur = privateRefsOf(o), prev = slips.get(o.id)
        slips.set(o.id, cur)
        if (prev) { const gone = [...prev].filter((x) => !cur.has(x)); if (gone.length) await removePrivate(client, gone) }
        break
      }
      const code = r.error.code
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
  return { ok: true }
}

export function startOrdersSync({ client, db, canWrite, onError, onRecode, numbering, debounceMs, retryDelay }) {
  const known = new Set()
  const slips = new Map()
  return startSync({
    list: () => db.orders,
    replace: (items, { refresh = false } = {}) => {
      db.orders.splice(0, db.orders.length, ...items)
      known.clear()
      slips.clear()
      for (const i of items) { known.add(i.id); slips.set(i.id, privateRefsOf(i)) }
      // ตัวนับเลข: ล้างเลขจากข้อมูลตัวอย่าง แล้วตั้งตามเลขที่มีอยู่จริง
      if (numbering) numbering.seen(items.map((i) => i.code), { reset: !refresh }) // รีเฟรชระหว่างใช้งาน: ห้ามล้างตัวนับ/ชุดเลขที่ขอไว้
    },
    load: () => loadOrders(client),
    push: (changes) => pushOrders(client, changes, { onRecode, retryDelay, numbering, known, slips }),
    canWrite, onError, debounceMs, label: 'ออร์เดอร์', poll: true,
  })
}
