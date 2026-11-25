// คัดรายการออเดอร์ที่ต้องแจ้งเตือนรอบนี้ (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล)
// การกันซ้ำอยู่ที่ punpang_preorder_notify_claim ดังนั้นรอบซ้ำที่เลือกออเดอร์เดิมจะไม่ส่งซ้ำ

export const REMIND_WINDOW_MS = 60 * 60e3 // เตือนเมื่อเหลือไม่เกิน 1 ชั่วโมง
export const EXPIRED_LOOKBACK_MS = 24 * 60 * 60e3 // แจ้งหมดเวลาย้อนหลังไม่เกิน 24 ชั่วโมง

export type PlanOrder = { id: string; status: string; payDueAt?: string | null; total?: number; paid?: number; fulfillment?: string | null; pickupDate?: string | null }

const dueOf = (o: PlanOrder) => Math.max(0, (Number(o.total) || 0) - (Number(o.paid) || 0))

// ออเดอร์รอชำระที่ยังค้างและกำหนดชำระอยู่ในช่วง (ตอนนี้, ตอนนี้ + 1 ชม.]
export function planReminders(orders: PlanOrder[], nowMs: number): string[] {
  return orders
    .filter((o) => o.status === 'awaiting_payment' && dueOf(o) > 0 && !!o.payDueAt)
    .filter((o) => {
      const t = Date.parse(o.payDueAt as string)
      return Number.isFinite(t) && t > nowMs && t <= nowMs + REMIND_WINDOW_MS
    })
    .map((o) => o.id)
}

// ออเดอร์ที่หมดเวลาแล้วภายใน 24 ชั่วโมง (รวมเวลาหมดเวลาในอนาคตไม่ได้)
export function planExpired(orders: PlanOrder[], nowMs: number): string[] {
  return orders
    .filter((o) => o.status === 'expired' && !!o.payDueAt)
    .filter((o) => {
      const t = Date.parse(o.payDueAt as string)
      return Number.isFinite(t) && t <= nowMs && t >= nowMs - EXPIRED_LOOKBACK_MS
    })
    .map((o) => o.id)
}

// เวลาไทยของตอนนี้เป็นวันที่ YYYY-MM-DD และชั่วโมง/นาที
export function bangkokNow(nowMs: number): { date: string; hour: number; minute: number } {
  const d = new Date(nowMs + 7 * 3600e3)
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

// ออเดอร์รับที่ร้านที่ยังค้างยอด และวันรับเป็นพรุ่งนี้ (เวลาไทย) · ออเดอร์จัดส่งไม่รวม (ต้องชำระเต็มก่อนจัดส่งอยู่แล้ว)
export function planPickupReminders(orders: PlanOrder[], nowMs: number): string[] {
  const tomorrow = new Date(Date.parse(`${bangkokNow(nowMs).date}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10)
  return orders
    .filter((o) => o.fulfillment === 'pickup' && o.pickupDate === tomorrow)
    .filter((o) => (o.status === 'awaiting_payment' || o.status === 'payment_confirmed') && dueOf(o) > 0)
    .map((o) => o.id)
}

// ส่งแจ้งเตือนก่อนวันรับได้ช่วง 09:00–19:59 น. (เวลาไทย) · ล้มเหลวจะลองใหม่ในรอบ 5 นาทีถัดไปจนกว่าจะหมดช่วง
export function inPickupReminderWindow(nowMs: number): boolean {
  const b = bangkokNow(nowMs)
  return b.hour >= 9 && b.hour < 20
}

// เพดานการส่งต่อรอบ (รอบละ 5 นาที) กันเกตเวย์ SMS รับไม่ทัน
export const SEND_CAP_PER_RUN = 50

// ทำรายการตามลำดับจนครบเพดาน · 'skipped' (เคยส่งแล้วหรือไม่มีช่องทาง) ไม่กินโควตา · 'sent' และ 'failed' กินโควตา
export async function runWithCap<T>(items: T[], cap: number, attempt: (item: T) => Promise<'sent' | 'skipped' | 'failed'>): Promise<{ sent: number; attempts: number; used: number }> {
  let sent = 0
  let used = 0
  let attempts = 0
  for (const item of items) {
    if (used >= cap) break
    attempts++
    const r = await attempt(item)
    if (r === 'skipped') continue
    used++
    if (r === 'sent') sent++
  }
  return { sent, attempts, used }
}
