// แผนงานตามเวลาฝั่งเซิร์ฟเวอร์ (ฟังก์ชันล้วน · ทดสอบได้) — ตรรกะเทียบกับ runScheduledChecks / payReminder / notify ใน src/data/store.js
// เวลาในออร์เดอร์และกำหนดชำระเป็นเวลาไทยแบบไม่มีโซน: เทียบเวลาจริงด้วย +07:00 · ข้อความที่แสดงใช้สตริงเดิม (ให้ตรงกับที่พนักงานเห็น)
// โมดูลใน ../schedlib คัดลอกจาก src/lib ด้วย scripts/sync-schedlib.mjs (ห้ามแก้ไฟล์เหล่านั้นโดยตรง)
import { orderNo } from '../slipref.ts'
import { orderTotals } from '../schedlib/pricing.js'
import { overduePayments } from '../schedlib/payDue.js'
import { expiringSoon } from '../schedlib/loyalty.js'
import { daysBetween, nextBirthday } from '../schedlib/birthday.js'
import { dateOnly, formatPhone, money, pad, timeOnly, toDateStr } from '../schedlib/format.js'
import { CHANNELS, CUSTOMER_CHANNEL_ORDER, NOTIFY_EVENTS } from '../schedlib/constants.js'
import { BELL_CUSTOMER, BELL_STAFF, bellText } from '../schedlib/bell.js'
import { customerTargets, withNewRules } from '../schedlib/notifyPlan.js'

export { CHANNELS, CUSTOMER_CHANNEL_ORDER, NOTIFY_EVENTS, BELL_CUSTOMER, BELL_STAFF, bellText, customerTargets, withNewRules }

// deno-lint-ignore no-explicit-any
type Any = any

export const BKK_OFFSET_MIN = 420
const HOUR = 3600e3

// เวลาติดผนังของกรุงเทพในรูป Date ที่เมธอด local (getHours ฯลฯ) อ่านได้เป็นเวลาไทย ไม่ว่าเซิร์ฟเวอร์ตั้งโซนใด
export function wallNow(nowMs: number): Date {
  const serverOff = new Date(nowMs).getTimezoneOffset() // นาที = UTC − local ของเซิร์ฟเวอร์
  return new Date(nowMs + (BKK_OFFSET_MIN + serverOff) * 60000)
}

// เวลาท้องถิ่นไทยแบบไม่มีโซน ('YYYY-MM-DD' หรือ 'YYYY-MM-DDTHH:mm[:ss]') → มิลลิวินาทีจริง (NaN ถ้าอ่านไม่ได้)
export function instantOf(s: unknown): number {
  const v = String(s ?? '').trim()
  if (!v) return NaN
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(`${v}T00:00+07:00`)
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) return Date.parse(v)
  return Date.parse(`${v}+07:00`)
}
// วันที่ปัจจุบันตามเวลาไทย (YYYY-MM-DD)
export const todayBkk = (nowMs: number): string => toDateStr(wallNow(nowMs))
const asInstantIso = (s: unknown): unknown => {
  const t = instantOf(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : s
}
const hmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

// ---------- ตัวแปรข้อความ (ตรงกับ orderVars / dueText ใน store.js) ----------
export function dueTextOf(iso: unknown): string {
  return iso ? `${dateOnly(iso)} ${timeOnly(iso)} น.` : ''
}

export function orderVars(order: Any, extra: Any, shop: Any, customer: Any | null): Record<string, string> {
  const c = customer
  const t = orderTotals(order)
  const items: Any[] = order.items || []
  return {
    ชื่อลูกค้า: c?.name || '',
    เลขออร์เดอร์: orderNo(order.code),
    ยอดรวม: money(t.total),
    คงค้าง: money(Math.max(t.balance, 0)),
    ยอดที่แจ้ง: extra.requested != null ? money(extra.requested) : '',
    ยอดที่ชำระ: extra.paid != null ? money(extra.paid) : '',
    ชำระแล้ว: money(Math.max(t.paid, 0)),
    ชำระก่อน: extra.dueAt ? dueTextOf(extra.dueAt) : 'ไม่กำหนด',
    วันนัด: dateOnly(order.pickupAt),
    เวลานัด: timeOnly(order.pickupAt),
    ส่งมอบ: order.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับ',
    ข้อความรับสินค้า: order.fulfillment === 'delivery' ? '' : `สามารถรับสินค้าได้แล้ว แต่ต้องไม่เกินเวลาร้านปิด ${shop?.close || ''} น.`,
    เวลาปิดร้าน: shop?.close || '',
    // ข้อความขอใช้ภาพผูกกับรูปงานในแอป ไม่ใช้กับเหตุการณ์ตามเวลา → ว่างเสมอฝั่งเซิร์ฟเวอร์
    ข้อความขอใช้ภาพ: '',
    ชื่อวันเกิด: order.birthday?.name || c?.name || '',
    คะแนน: extra.points != null ? String(extra.points) : '',
    ส่วนลดคะแนน: extra.pointsAmount != null ? money(extra.pointsAmount) : '',
    ลิงก์ออร์เดอร์: '',
    เบอร์ลูกค้า: formatPhone(c?.phone || ''),
    รายการสินค้า: items.length
      ? items.map((i) => `• ${i.name || 'สินค้า'} × ${i.qty || 1}${i.note ? ` (${String(i.note).trim()})` : ''} — ${money((Number(i.unitPrice) || 0) * (Number(i.qty) || 1))}`).join('\n')
      : '• -',
    บรรทัดที่อยู่: order.fulfillment === 'delivery' && order.address ? `📍 ${[order.placeName, order.address, order.detail].filter(Boolean).map((s: unknown) => String(s).trim()).join(' · ')}` : '',
    บรรทัดค่าส่ง: order.fulfillment === 'delivery' && t.shipping > 0 ? `🚚 ค่าส่ง ${money(t.shipping)}` : '',
    บรรทัดหมายเหตุ: c?.note ? `📝 หมายเหตุลูกค้า: ${String(c.note).trim()}` : '',
  }
}

// ---------- เทมเพลต / การเรนเดอร์ (ตรงกับ fillTemplate / plainText / renderFor ใน store.js) ----------
const PAY_REMINDER_OLD = 'พรุ่งนี้มีนัดออร์เดอร์ {เลขออร์เดอร์} ({วันนัด} {เวลานัด}) ยังไม่ได้ชำระ คงค้าง {คงค้าง} ชำระก่อน {ชำระก่อน} ชำระที่ {ลิงก์ออร์เดอร์}'
const PAY_REMINDER_TPL = 'โปรดชำระเงินก่อน {ชำระก่อน} เพื่อยืนยันการสั่งซื้อ {เลขออร์เดอร์} {วันนัด} {เวลานัด} เพื่อยืนยันการสั่งซื้อ หากชำระแล้ว ต้องขออภัย และสามารถแจ้งเพื่อตรวจสอบอีกครั้ง ขอบคุณค่ะ\nดูออร์เดอร์: {ลิงก์ออร์เดอร์}'
// เทมเพลตเก่าของ payment_reminder → เทมเพลตปัจจุบัน (ตรงกับ DEFAULT_UPGRADES ในแอป)
// ทีม "ใกล้เวลาต้องเสร็จ": จำนวนชั่วโมงเปลี่ยนตามที่ร้านตั้งได้ (ตรงกับ DUE_SOON ในแอป)
const DUE_SOON_OLD = '[ใกล้เวลา] {เลขออร์เดอร์} ต้องเสร็จภายใน 2 ชม. (นัด {เวลานัด})'
const DUE_SOON_TPL = '[ใกล้เวลา] {เลขออร์เดอร์} ต้องเสร็จภายใน {ชั่วโมง} ชม. (นัด {เวลานัด})'
const TPL_UPGRADES: Record<string, [string, string]> = { payment_reminder: [PAY_REMINDER_OLD, PAY_REMINDER_TPL], team_due_soon: [DUE_SOON_OLD, DUE_SOON_TPL] }
// เทมเพลตเฉพาะ Facebook ของเหตุการณ์ตามเวลา (ตรงกับ FB_TPL ในแอป)
const FB_TPL: Record<string, string> = {
  payment_reminder: PAY_REMINDER_TPL,
  pickup_reminder: 'เตือนนัด{ส่งมอบ}ออร์เดอร์ {เลขออร์เดอร์}\nวันที่ {วันนัด} เวลา {เวลานัด}',
  birthday: 'สุขสันต์วันเกิดล่วงหน้า {ชื่อวันเกิด}\nสั่งเค้กกับเราได้เลยค่ะ',
  points_expiring: '{ชื่อลูกค้า} มี {คะแนน} คะแนนใกล้หมดอายุ\nใช้ก่อนหมดนะคะ',
}

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v ?? ''), tpl || '')
}
// ข้อความธรรมดา (SMS/Facebook): ตัดอีโมจิและเส้นตกแต่ง แล้วยุบบรรทัดว่าง
export function plainText(s: unknown): string {
  return String(s ?? '')
    .replace(/[\p{Extended_Pictographic}‍️━]/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
// Telegram HTML: escape ค่าตัวแปรก่อนแทรกลงเทมเพลต
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export const escapeVars = (v: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, escapeHtml(x)]))

export function tplOf(rule: Any): string {
  const u = TPL_UPGRADES[rule.event]
  return u && u[0] === String(rule.template || '').trim() ? u[1] : rule.template
}
// เทมเพลตของช่อง: กฎที่บันทึกไว้ → ค่าเริ่มต้นของเหตุการณ์ (Facebook) → เทมเพลตหลัก
export function channelTplOf(rule: Any, ch: string): string {
  return rule.channelTemplates?.[ch] || (ch === 'facebook' ? FB_TPL[rule.event] : undefined) || tplOf(rule)
}
// ลิงก์เป็นข้อความเฉพาะ SMS (และทีม Telegram) · ช่องทางอื่นแสดงเป็นปุ่มด้านล่างของการ์ด (ไม่มีลิงก์ในข้อความ)
export const linkAsText = (ch: string) => ch === 'sms' || ch === 'telegram'
// ตัดป้ายลิงก์ที่เหลือท้ายข้อความ เช่น "ดูออร์เดอร์:" (เมื่อไม่มีลิงก์ให้ต่อ)
export function stripLinkLabel(s: string): string {
  return s.replace(/\s*(ดูออร์เดอร์|ดู\/ชำระที่|ชำระที่|ดูได้ที่)\s*:?\s*$/, '').trim()
}
export function renderFor(rule: Any, ch: string, v: Record<string, string>, link: string): { tpl: string; text: string } {
  const tpl = channelTplOf(rule, ch)
  const withLink = linkAsText(ch)
  const lines = tpl.split('\n')
  const body = lines
    .map((ln) => fillTemplate(ln, { ...v, ลิงก์ออร์เดอร์: withLink ? link : '' }))
    .filter((ln, i) => ln.trim() !== '' || lines[i].trim() === '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!withLink) return { tpl, text: stripLinkLabel(body) }
  return { tpl, text: link && !tpl.includes('{ลิงก์ออร์เดอร์}') ? `${body}\nดูออร์เดอร์: ${link}` : body }
}

// ---------- ช่องทาง (ตรงกับ effectiveChannels / customerAddr ใน store.js) ----------
export function effectiveChannels(rule: Any, customer: Any | null, order: Any | null): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const k of CUSTOMER_CHANNEL_ORDER) {
    const o = order?.notifyChannels?.[k]
    const c = customer?.notifyChannels?.[k]
    if (typeof o === 'boolean') out[k] = o
    else if (typeof c === 'boolean') out[k] = c
    else out[k] = !!rule?.channels?.includes(k)
  }
  return out
}
export function customerAddr(c: Any | null, ch: string): string {
  const v = ch === 'line' ? c?.lineUserId : ch === 'facebook' ? c?.fbPsid : ch === 'sms' ? c?.phone : ''
  return v ? String(v) : ''
}

// ---------- แผนงานตามเวลา ----------
export type Plan = {
  key: string
  kind: 'customer' | 'team'
  event: string
  orderId: string | null
  order: Any | null
  customer: Any | null
  vars: Record<string, string>
}
export type PlanInput = {
  nowMs: number
  shop: Any
  rules: Any[]
  orders: Any[]
  customers: Any[]
  sent: Set<string> // คีย์ที่ส่งแล้ว (ตาราง punpang_records collection notifySent)
}

// งวดที่เลยกำหนดของออร์เดอร์ (เทียบเวลาจริง) · คืนงวดจากออร์เดอร์เดิม (dueAt ยังเป็นสตริงท้องถิ่น)
function overdueOf(o: Any, nowMs: number): Any[] {
  const payments: Any[] = o.payments || []
  const view = { ...o, payments: payments.map((p) => ({ ...p, dueAt: p.dueAt ? asInstantIso(p.dueAt) : p.dueAt })) }
  const ids = new Set(overduePayments(view, new Date(nowMs)).map((p: Any) => p.id))
  return payments.filter((p) => ids.has(p.id))
}

// กลุ่มวันเกิดจากออร์เดอร์ (ไม่นับยกเลิก) ตาม ลูกค้า + ชื่อ + วัน ใช้ออร์เดอร์ที่นัดล่าสุด (ตรงกับ birthdayList ในแอป)
export function birthdayListOf(orders: Any[]): Any[] {
  const map = new Map<string, Any>()
  for (const o of orders) {
    if (!o.birthday?.md || o.status === 'cancelled') continue
    const name = String(o.birthday.name || '').trim()
    const k = `${o.customerId}|${name}|${o.birthday.md}`
    const cur = map.get(k)
    if (!cur || cur.order.pickupAt < o.pickupAt) map.set(k, { customerId: o.customerId, name, md: o.birthday.md, order: o })
  }
  return [...map.values()]
}

export function planScheduled(inp: PlanInput): Plan[] {
  const wall = wallNow(inp.nowMs)
  const today = toDateStr(wall)
  const hm = hmOf(wall)
  const custOf = new Map<string, Any>(inp.customers.map((c) => [c.id, c]))
  const out: Plan[] = []
  const seen = new Set<string>()
  const add = (key: string, p: Omit<Plan, 'key'>) => {
    if (inp.sent.has(key) || seen.has(key)) return
    seen.add(key)
    out.push({ key, ...p })
  }
  const custFor = (o: Any): Any | null => custOf.get(o.customerId) ?? null
  const varsOf = (o: Any, extra: Any = {}) => orderVars(o, extra, inp.shop, custFor(o))

  // ค่าเวลาแจ้งเตือนที่ร้านตั้งไว้ (ค่าเริ่มต้นเท่าการทำงานเดิม)
  const pickupHours = Number(inp.shop?.pickupRemindHours ?? 24)
  const dueHours = Number(inp.shop?.dueSoonHours ?? 2)
  const pointsDays = Number(inp.shop?.pointsExpireDays ?? 30)
  // กฎ "เตือนก่อนนัดรับ" ปิดอยู่ → ไม่วางแผนเตือนนัดรับเลย (ไม่ส่งและไม่ขึ้นกระดิ่งลูกค้า) · ไม่มีกฎ = เปิด
  const pickupOn = inp.rules.find((r) => r?.event === 'pickup_reminder')?.enabled !== false
  for (const o of inp.orders) {
    if (['draft', 'delivered', 'cancelled'].includes(o.status)) continue
    // เตือนนัดรับ: ภายในจำนวนชั่วโมงที่ร้านตั้งไว้ก่อนนัด
    const toPickup = instantOf(o.pickupAt) - inp.nowMs
    if (pickupOn && toPickup > 0 && toPickup <= pickupHours * HOUR) {
      add(`pickup|${o.id}`, { kind: 'customer', event: 'pickup_reminder', orderId: o.id, order: o, customer: custFor(o), vars: varsOf(o) })
    }
    // ยืนยันสลิปอัตโนมัติ: แจ้งลูกค้าว่ายืนยันชำระแล้ว (ตามกฎ payment_confirmed ของร้าน) · เฉพาะงวดที่ระบบยืนยันเอง ภายใน 24 ชม. · ส่งครั้งเดียวต่องวด
    for (const p of Array.isArray(o.payments) ? o.payments : []) {
      if (p?.status !== 'confirmed' || p.confirmedBy !== 'auto' || p.autoNotified === true) continue // autoNotified = ระบบแจ้งลูกค้าไปแล้วตอนยืนยัน
      const at = Date.parse(String(p.confirmedAt || ''))
      if (!Number.isFinite(at) || inp.nowMs - at > 24 * HOUR) continue
      add(`payconf|${p.id}`, { kind: 'customer', event: 'payment_confirmed', orderId: o.id, order: o, customer: custFor(o), vars: varsOf(o, { paid: p.amount }) })
    }
    // ทีม: งวดชำระเลยกำหนด
    for (const p of overdueOf(o, inp.nowMs)) {
      add(`overdue|${p.id}|${p.dueAt}`, { kind: 'team', event: 'team_pay_overdue', orderId: o.id, order: o, customer: null, vars: { ...varsOf(o), ชำระก่อน: dueTextOf(p.dueAt) } })
    }
    // เตือนลูกค้าที่ยังไม่ชำระของพรุ่งนี้ ตั้งแต่ payReminderTime (ครั้งเดียวต่อออร์เดอร์)
    if (!['draft', 'cancelled', 'delivered', 'order_confirmed'].includes(o.status) && hm >= String(inp.shop?.payReminderTime || '09:00')) {
      const tmrStr = toDateStr(new Date(wall.getFullYear(), wall.getMonth(), wall.getDate() + 1))
      if (String(o.pickupAt).slice(0, 10) === tmrStr) {
        const payments: Any[] = o.payments || []
        const asked = payments.filter((p) => p.source !== 'customer')
        const t = orderTotals(o)
        const blocked =
          !asked.some((p) => p.status === 'reported') ||
          payments.some((p) => p.status === 'confirmed') ||
          t.paid > 0 ||
          payments.some((p) => p.status === 'reported' && (p.slip || p.source === 'customer')) ||
          t.balance <= 0
        if (!blocked) {
          const open = asked.filter((p) => p.status === 'reported').sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0]
          add(`payrem|${o.id}|${tmrStr}`, { kind: 'customer', event: 'payment_reminder', orderId: o.id, order: o, customer: custFor(o), vars: varsOf(o, { dueAt: open?.dueAt || '' }) })
        }
      }
    }
    // ทีม: ใกล้เวลาต้องเสร็จ (เหลือไม่เกินชั่วโมงที่ร้านตั้งไว้ ตามเวลาผลิต = นัดลบเวลาเตรียม)
    const lead = Number(o.fulfillment === 'delivery' ? inp.shop?.leadDelivery : inp.shop?.leadPickup) || 0
    const dueMs = instantOf(o.pickupAt) - lead * 60000
    if (dueMs - inp.nowMs <= dueHours * HOUR) {
      add(`due|${o.id}`, { kind: 'team', event: 'team_due_soon', orderId: o.id, order: o, customer: null, vars: { ...varsOf(o), ชั่วโมง: String(dueHours) } })
    }
  }

  // วันเกิดที่จะถึงภายในจำนวนวันที่ตั้งไว้ (วันนี้ = 0) · ไม่มีรายการกระดิ่งฝั่งลูกค้า แต่ส่งข้อความได้
  const birthdayDays = Number(inp.shop?.birthdayDays ?? 0)
  for (const b of birthdayListOf(inp.orders)) {
    const c = custOf.get(b.customerId) ?? null
    const date: string = nextBirthday(b.md, wall)
    const year = Number(date.slice(0, 4))
    const inDays = daysBetween(today, date)
    if (inDays > birthdayDays) continue
    add(`bd|${b.customerId}|${b.name}|${b.md}|${year}`, {
      kind: 'customer', event: 'birthday', orderId: b.order.id, order: b.order, customer: c,
      vars: { ...orderVars(b.order, {}, inp.shop, c), ชื่อวันเกิด: b.name || c?.name || '' },
    })
  }

  // คะแนนใกล้หมดอายุ (ภายในจำนวนวันที่ร้านตั้งไว้)
  for (const c of inp.customers) {
    const soon: Any = expiringSoon(c.ledger || [], today, pointsDays)
    if (soon && soon.points > 0) {
      add(`pts|${c.id}|${soon.date}`, { kind: 'customer', event: 'points_expiring', orderId: null, order: null, customer: c, vars: { ชื่อลูกค้า: c.name, คะแนน: String(soon.points) } })
    }
  }
  return out
}

export const HOUR_MS = HOUR
