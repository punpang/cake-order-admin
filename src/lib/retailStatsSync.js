// เผยแพร่สถิติสินค้าพร้อมขายไปยัง kv 'shop_public' (อ่านได้สาธารณะ) · ทำในเบราว์เซอร์ของพนักงานที่มีสิทธิ์เขียนการตั้งค่า
// ใช้ออร์เดอร์ที่สร้างในช่วง STATS_WINDOW_DAYS วันล่าสุด (ensure ดึงจากเซิร์ฟเวอร์ก่อนคำนวณทุกรอบ) · ไม่มีรหัสลูกค้าในข้อมูลที่เผยแพร่
import { computeRetailStats } from './retailStats.js'
import { computeOccasionStats } from './occasion.js'

export const RETAIL_STATS_COLLECTION = 'shop_public'
// ช่วงที่สถิติใช้ (retailStats / occasion = 30 วันตามวันที่สร้าง) + เผื่อ 1 วัน
export const STATS_WINDOW_DAYS = 31
export const RETAIL_STATS_IDS = { sales: 'retailSales', pairs: 'retailPairs', occasion: 'occasionStats' }

export async function publishRetailStats(client, orders, now = new Date()) {
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
// ensure() = ดึงออร์เดอร์ในช่วงเวลาที่ใช้คำนวณให้อยู่ในเครื่อง (ล้มเหลว = ข้ามรอบนั้น ไม่เผยแพร่สถิติที่ข้อมูลไม่ครบ)
export function startRetailStatsSync({ client, db, canWrite, intervalMs = 15 * 60e3, ensure = null }) {
  if (!canWrite || !ensure) return { stop() {} }
  const run = async () => {
    try { await ensure() } catch { return }
    if (db.orders?.length) publishRetailStats(client, db.orders).catch(() => {})
  }
  const first = setTimeout(run, 3000)
  const timer = setInterval(run, intervalMs)
  return { stop() { clearTimeout(first); clearInterval(timer) } }
}
