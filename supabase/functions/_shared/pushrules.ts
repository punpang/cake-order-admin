// กติกาแจ้งเตือนพนักงานบนแอป Android (push): ประเภท → สิทธิ์ที่ต้องมี (ข้อใดข้อหนึ่ง หรือ manage) + ปลายทางเมื่อกดแจ้งเตือน
// ต้องตรงกับกระดิ่งพนักงาน (src/lib/bell.js · BELL_STAFF) — pushrules.test.ts เทียบให้อัตโนมัติ
// ทริกเกอร์ punpang_push_on_bell ใช้รายการประเภทชุดเดียวกัน (migration 20261117150000) · ประเภทที่ไม่อยู่ในรายการนี้ไม่ยิง push
export type PushRule = { perms: string[]; path: (d: Record<string, string>) => string }

const toOrder = (d: Record<string, string>) => (d.orderId ? `/admin/orders/${d.orderId}` : '/admin/orders')
const toChat = (d: Record<string, string>) => (d.chatId ? `/admin/chat/${d.chatId}` : '/admin/chat')
const fixed = (path: string) => () => path

export const STAFF_PUSH_RULES: Record<string, PushRule> = {
  team_customer_paid: { perms: ['confirmPayment', 'reportPayment'], path: fixed('/admin/payments') },
  team_customer_message: { perms: ['chat'], path: toChat },
  team_pay_extend_request: { perms: ['confirmPayment', 'reportPayment'], path: fixed('/admin/payments') },
  team_pay_overdue: { perms: ['confirmPayment', 'reportPayment'], path: fixed('/admin/payments') },
  team_new_order: { perms: ['viewAllOrders'], path: toOrder },
  team_approval_request: { perms: ['confirmUnpaid', 'requestConfirmUnpaid'], path: toOrder },
  team_due_soon: { perms: ['viewAllOrders', 'viewPrepOrders'], path: toOrder },
  chat_inbound: { perms: ['chat'], path: toChat },
  notify_failed: { perms: ['chat', 'viewAllOrders'], path: toChat },
  bot_handoff: { perms: ['chat'], path: toChat },
  slip_check: { perms: ['chat'], path: toChat },
  team_photo_optout: { perms: ['manage'], path: fixed('/admin/settings/photo-requests') },
  deletion_request: { perms: ['manage'], path: fixed('/admin/settings/deletion-requests') },
  team_coupon_shown: { perms: ['pos'], path: fixed('/admin/pos') },
  team_vat_due: { perms: ['acctView'], path: fixed('/admin/accounting') },
  team_expense_missing: { perms: ['acctView'], path: fixed('/admin/accounting') },
  team_installment_due: { perms: ['acctView'], path: fixed('/admin/accounting') },
  team_order_review: { perms: ['manage'], path: fixed('/admin/settings/sync-review') },
}

// มีกติกาของประเภทนี้หรือไม่ (ใช้ hasOwn กันชื่อที่ซ้ำกับ prototype เช่น constructor)
export function ruleOf(event: string): PushRule | null {
  return Object.hasOwn(STAFF_PUSH_RULES, event) ? STAFF_PUSH_RULES[event] : null
}
