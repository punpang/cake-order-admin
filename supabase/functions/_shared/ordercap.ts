// จำกัดออเดอร์ต่อวันที่เซิร์ฟเวอร์ (order-create) · กติกาเดียวกับ src/lib/orderCap.js
// วันที่นัด = 10 ตัวแรกของ pickupAt (เวลาท้องถิ่นแบบไม่มีโซน) · ไม่นับยกเลิกและร่าง · 0 = ไม่จำกัด
import { pages } from './catalog.ts'

export const NOT_COUNTED = ['cancelled', 'draft']

// วันที่นัดจาก pickupAt → YYYY-MM-DD หรือ '' ถ้าไม่ใช่รูปแบบวันที่
export function dayOfPickup(pickupAt: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(pickupAt ?? ''))
  return m ? m[1] : ''
}

// path สำหรับนับออเดอร์ของวันนั้น (ไม่รวมยกเลิก/ร่าง)
export function countPath(day: string): string {
  return `punpang_orders?select=id&data->>pickupAt=like.${day}*&status=not.in.(${NOT_COUNTED.join(',')})`
}

// ครบแล้วหรือยัง: cap > 0 และจำนวนที่มีอยู่ถึง cap แล้ว
export function capFull(cap: unknown, count: number): boolean {
  const c = Math.max(0, Math.round(Number(cap) || 0))
  return c > 0 && count >= c
}

// ค่าความจุจากการตั้งค่าร้าน (punpang_kv · collection config · id shop)
export async function shopCap(url: string, headers: Record<string, string>): Promise<number | null> {
  const rows = await pages(url, headers, 'punpang_kv?collection=eq.config&id=eq.shop&select=data')
  if (!rows) return null
  return Math.max(0, Math.round(Number(rows[0]?.data?.v?.dailyOrderCap) || 0))
}

// นับออเดอร์ของวันนั้น · null = อ่านไม่สำเร็จ
export async function countOnDay(url: string, headers: Record<string, string>, day: string): Promise<number | null> {
  const rows = await pages(url, headers, countPath(day))
  return rows ? rows.length : null
}
