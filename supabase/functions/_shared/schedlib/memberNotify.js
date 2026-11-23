// แจ้งเตือนสิทธิ์สมาชิก (ฟังก์ชันล้วน ทดสอบได้): เลื่อนระดับ · โบนัสคะแนน · คูปองวันเกิด
// ดูเหตุการณ์จากสมุดคะแนนของลูกค้า (lot ที่ reason ขึ้นต้นด้วย "โบนัส") และคูปองเดือนเกิด (source = member_birthday)
// กันส่งซ้ำด้วยคีย์ต่อรายการ (lot id / coupon id) ผ่านตาราง notifySent เดิม · เฉพาะเหตุการณ์ในช่วงเวลาที่กำหนด
// การยินยอม SMS แยกจากโปรโมชัน: smsOptIn + smsConsentAt · ใช้กับเหตุการณ์กลุ่มนี้เท่านั้น (ออเดอร์เดิมไม่เปลี่ยน)

export const LOYALTY_EVENTS = ['tier_up', 'member_bonus', 'birthday_coupon']
export const LOYALTY_WINDOW_MS = 24 * 3600 * 1000

// ความยินยอม SMS: เปิดเองในบัญชี (ต้องมีเวลายินยอม) · ข้อมูลเดิมที่ไม่มีเวลา = ยังไม่นับ
export function smsConsentPatch(prev, smsOptIn, nowIso) {
  const base = { ...(prev || {}) }
  delete base.smsConsentAt
  if (smsOptIn !== true) return { ...base, smsOptIn: false }
  if (prev?.smsOptIn !== true) return { ...base, smsOptIn: true, smsConsentAt: nowIso }
  if (typeof prev.smsConsentAt === 'string' && prev.smsConsentAt) return { ...base, smsOptIn: true, smsConsentAt: prev.smsConsentAt }
  return { ...base, smsOptIn: true }
}

export function smsAllowed(c) {
  return c?.smsOptIn === true && typeof c.smsConsentAt === 'string' && c.smsConsentAt !== ''
}

const inWindow = (at, nowMs) => {
  const t = Date.parse(String(at || ''))
  return Number.isFinite(t) && t <= nowMs && nowMs - t <= LOYALTY_WINDOW_MS
}

// แผนแจ้งเตือนสิทธิ์สมาชิกที่เกิดในช่วงเวลา · คืนรายการรูปแบบเดียวกับ Plan ของตัวส่งตามแผน
export function planLoyalty({ nowMs, customers = /** @type {any[]} */ ([]), coupons = /** @type {any[]} */ ([]) }) {
  const out = []
  const custOf = new Map(customers.map((c) => [c.id, c]))
  for (const c of customers) {
    for (const lot of Array.isArray(c.ledger) ? c.ledger : []) {
      if (!lot?.id || !inWindow(lot.at, nowMs)) continue
      const reason = String(lot.reason || '')
      const lvl = /^โบนัสเลื่อนเป็น LV(\d)/.exec(reason)
      const vars = { ชื่อลูกค้า: c.name || '', โบนัส: String(Number(lot.delta) || 0) }
      if (lvl) {
        out.push({ key: `tier|${c.id}|${lot.id}`, kind: 'customer', event: 'tier_up', orderId: null, order: null, customer: c, vars: { ...vars, ระดับ: `LV${lvl[1]}` } })
      } else if (reason.startsWith('โบนัส')) {
        out.push({ key: `bonus|${c.id}|${lot.id}`, kind: 'customer', event: 'member_bonus', orderId: null, order: null, customer: c, vars })
      }
    }
  }
  for (const r of coupons) {
    const d = r?.data || r || {}
    if (d.source !== 'member_birthday' || !d.id || !inWindow(d.createdAt, nowMs)) continue
    const c = custOf.get(d.customerId) || null
    out.push({
      key: `bdaycoupon|${d.id}`, kind: 'customer', event: 'birthday_coupon', orderId: null, order: null, customer: c,
      vars: { ชื่อลูกค้า: c?.name || '', ชื่อคูปอง: String(d.name || ''), ยอดลด: String(d.amount ?? ''), หมดอายุ: String(d.expiresAt || '') },
    })
  }
  return out
}
