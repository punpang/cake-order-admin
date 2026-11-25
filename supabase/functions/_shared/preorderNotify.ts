// ส่งข้อความแจ้งลูกค้าสั่งล่วงหน้า: กันซ้ำด้วยการจองสิทธิ์ · เลือก LINE ก่อน (ถ้าผูกแล้ว) ไม่เช่นนั้น SMS สำรอง
// ล้มเหลวไม่ทำให้รายการหลักล้มเหลว (ผู้เรียกต้องห่อ try ตามแต่ละจุด) · ทดสอบด้วย deps ที่เป็นตัวปลอม
import { pickFollowedLineUser } from './linepush.ts'
import { sendSmsGateway } from './sms.ts'

export const SMS_MAX = 300
export type NotifyResult = 'sent' | 'skipped' | 'failed'
export type NotifyInput = { orderId: string; customerId: string | null; phoneLocal: string | null; event: string; text: string; link?: string }
export type NotifyDeps = {
  sendSms: (local: string, text: string, idem: string) => Promise<boolean>
  sendLine: (to: string, text: string) => Promise<boolean>
}

export const defaultDeps: NotifyDeps = {
  sendSms: (local, text, idem) => sendSmsGateway(local, text, idem),
  sendLine: async (to, text) => {
    const token = (Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || '').trim()
    if (!token) return false
    try {
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(15000),
      })
      return r.ok
    } catch { return false }
  },
}

// ข้อความที่ส่ง SMS ได้: ไม่เกิน SMS_MAX และไม่มีค่าว่างหลุดมา (undefined/NaN)
export function smsOk(text: string): boolean {
  return text.length <= SMS_MAX && !text.includes('undefined') && !text.includes('NaN')
}

// ใส่ลิงก์แทน {LINK} · ไม่มีลิงก์ให้ตัดตัวแปรทิ้ง
export function fillLink(text: string, link?: string): string {
  return text.replace(/\{LINK\}/g, link || '').replace(/\s+/g, ' ').trim()
}

// sb = ไคลเอนต์ฐานข้อมูล (service role) · คืน sent | skipped (เคยส่งแล้วหรือไม่มีช่องทาง) | failed
export async function notifyCustomer(sb: any, input: NotifyInput, deps: NotifyDeps = defaultDeps): Promise<NotifyResult> {
  const { orderId, event } = input
  const text = fillLink(input.text, input.link)
  try {
    const claim = await sb.rpc('punpang_preorder_notify_claim', { p_order: orderId, p_event: event })
    if (claim.error) return 'failed'
    if (claim.data !== true) return 'skipped'

    if (input.customerId) {
      const lr = await sb.from('punpang_line_users').select('line_user_id,followed,updated_at').eq('customer_id', input.customerId).order('updated_at', { ascending: false }).limit(5)
      const lineId = pickFollowedLineUser(lr?.data ?? [])
      if (lineId && await deps.sendLine(lineId, text)) {
        await sb.rpc('punpang_preorder_notify_mark_sent', { p_order: orderId, p_event: event, p_channel: 'line' })
        return 'sent'
      }
    }

    if (input.phoneLocal && smsOk(text) && await deps.sendSms(input.phoneLocal, text, `pp-${orderId}-${event}`)) {
      await sb.rpc('punpang_preorder_notify_mark_sent', { p_order: orderId, p_event: event, p_channel: 'sms' })
      return 'sent'
    }

    // ไม่มีช่องทางที่ส่งได้ → ปลดการจองให้ลองใหม่ได้ในรอบถัดไป
    await sb.rpc('punpang_preorder_notify_release', { p_order: orderId, p_event: event })
    return input.phoneLocal || input.customerId ? 'failed' : 'skipped'
  } catch {
    await sb.rpc('punpang_preorder_notify_release', { p_order: orderId, p_event: event }).catch(() => {})
    return 'failed'
  }
}

// แจ้งลูกค้าหนึ่งเหตุการณ์ของออเดอร์ (ค้นข้อมูลออเดอร์และเบอร์ลูกค้าเอง) · ข้อความกลางจาก schedlib · ไม่โยนข้อผิดพลาดออกไป
// ลิงก์ไปหน้า "ออร์เดอร์ของฉัน" จาก PUBLIC_SITE_URL (ถ้าไม่ตั้ง ลิงก์เป็นค่าว่าง)
import { notifyText } from './schedlib/preorderNotify.js'

export async function notifyOrderEvent(sb: any, orderId: string, event: string, extra: { refund?: number; key?: string } = {}, deps: NotifyDeps = defaultDeps): Promise<void> {
  try {
    const o = (await sb.from('punpang_preorder_orders').select('id,code,customer_id,data').eq('id', orderId).maybeSingle()).data
    if (!o) return
    const cust = o.customer_id ? (await sb.from('punpang_customers').select('phone').eq('id', o.customer_id).maybeSingle()).data : null
    const d = o.data || {}
    const site = (Deno.env.get('PUBLIC_SITE_URL') || '').replace(/\/$/, '')
    const text = notifyText(event, {
      code: o.code, due: Math.max(0, (Number(d.total) || 0) - (Number(d.paid) || 0)), paid: Number(d.paid) || 0,
      refund: extra.refund ?? 0, payDueAt: event === 'extended' ? extra.key : d.payDueAt,
      carrier: d.shipping?.carrier, tracking: d.shipping?.trackingNo, fulfillment: d.fulfillment,
    })
    const key = extra.key ? `${event}:${extra.key}` : event
    await notifyCustomer(sb, { orderId, customerId: o.customer_id ?? null, phoneLocal: cust?.phone ?? null, event: key, text, link: site ? `${site}/#/preorder/orders` : '' }, deps)
  } catch {
    // ข้ามการแจ้งเตือนเมื่อเกิดข้อผิดพลาด (ไม่กระทบการทำรายการ)
  }
}
