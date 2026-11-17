// คิวบิลหน้าร้านที่รอให้ผู้จัดการตรวจ · ดึงจากฐานข้อมูลด้วยสิทธิ์ของผู้ใช้ (ไม่มีตารางหรือฟังก์ชันใหม่)
import { pendingPosHolds } from './posHoldRules.js'
import { loadOrdersByIds } from './ordersSync.js'

const CHUNK = 100 // แบ่งชุดกัน URL ยาวเมื่อคิวมีหลายบิล

// รหัสบิลหน้าร้านที่ค้างตรวจ · ฐานข้อมูลให้เห็นเฉพาะผู้มีสิทธิ์ (RLS ของผลตรวจและการตรวจ) · บิลที่ยกเลิกแล้วไม่เข้าคิว
export async function fetchPendingPosHoldIds(client) {
  const a = await client
    .from('punpang_order_audits')
    .select('order_id,checked_at,punpang_orders!inner(channel,status)')
    .eq('hold', true)
    .eq('punpang_orders.channel', 'pos')
    .neq('punpang_orders.status', 'cancelled')
  if (a.error) return { error: a.error.message }
  const audits = a.data || []
  const ids = audits.map((x) => x.order_id)
  const reviews = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await client.from('punpang_order_reviews').select('order_id,reviewed_at').in('order_id', ids.slice(i, i + CHUNK))
    if (r.error) return { error: r.error.message }
    reviews.push(...(r.data || []))
  }
  return { ids: [...pendingPosHolds(audits, reviews)] }
}

// โหลดบิลในคิวเข้ารายการ
export async function loadPendingPosOrders(client, ids) {
  const items = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await loadOrdersByIds(client, ids.slice(i, i + CHUNK))
    if (r.error) return { error: r.error }
    items.push(...r.items)
  }
  return { items }
}
