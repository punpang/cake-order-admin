// คัดรายการออเดอร์ที่ต้องแจ้งเตือนรอบนี้ (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล)
// การกันซ้ำอยู่ที่ punpang_preorder_notify_claim ดังนั้นรอบซ้ำที่เลือกออเดอร์เดิมจะไม่ส่งซ้ำ

export const REMIND_WINDOW_MS = 60 * 60e3 // เตือนเมื่อเหลือไม่เกิน 1 ชั่วโมง
export const EXPIRED_LOOKBACK_MS = 24 * 60 * 60e3 // แจ้งหมดเวลาย้อนหลังไม่เกิน 24 ชั่วโมง

export type PlanOrder = { id: string; status: string; payDueAt?: string | null; total?: number; paid?: number }

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
