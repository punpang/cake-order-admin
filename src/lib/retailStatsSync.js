// เผยแพร่สถิติสินค้าพร้อมขายไปยัง kv 'shop_public' (อ่านได้สาธารณะ) · ทำในเบราว์เซอร์ของพนักงานที่มีสิทธิ์เขียนการตั้งค่า
// ต้องมีประวัติออร์เดอร์ครบ (กลุ่ม ordersAll) ก่อนคำนวณ · ไม่มีรหัสลูกค้าในข้อมูลที่เผยแพร่
import { computeRetailStats } from './retailStats.js'
import { computeOccasionStats } from './occasion.js'
import { testModeOn } from './testMode.js'

export const RETAIL_STATS_COLLECTION = 'shop_public'
export const RETAIL_STATS_IDS = { sales: 'retailSales', pairs: 'retailPairs', occasion: 'occasionStats' }

export async function publishRetailStats(client, orders, now = new Date()) {
  if (testModeOn()) return { skipped: 'test' } // โหมดทดสอบไม่เผยแพร่สถิติไปหน้าร้านจริง (kv shop_public เป็นข้อมูลร่วม)
  const s = computeRetailStats(orders, { now })
  const rows = [
    { collection: RETAIL_STATS_COLLECTION, id: RETAIL_STATS_IDS.sales, data: { v: s.sales } },
    { collection: RETAIL_STATS_COLLECTION, id: RETAIL_STATS_IDS.pairs, data: { v: s.pairs } },
    { collection: RETAIL_STATS_COLLECTION, id: RETAIL_STATS_IDS.occasion, data: { v: computeOccasionStats(orders, { now }) } },
  ]
  const r = await client.from('punpang_kv').upsert(rows)
  return r.error ? { error: r.error.message } : { ok: true }
}

// เผยแพร่รอบแรกหลังโหลดประวัติ แล้วทำซ้ำตามช่วงเวลา · คืน handle สำหรับหยุด
export function startRetailStatsSync({ client, db, canWrite, intervalMs = 15 * 60e3 }) {
  if (!canWrite) return { stop() {} }
  const run = () => { if (db.orders?.length) publishRetailStats(client, db.orders).catch(() => {}) }
  const first = setTimeout(run, 3000)
  const timer = setInterval(run, intervalMs)
  return { stop() { clearTimeout(first); clearInterval(timer) } }
}
