// แจ้งลูกค้าทันทีเมื่อระบบยืนยันชำระอัตโนมัติ (สลิปในแชท และสลิปจากหน้าออร์เดอร์) · ไม่รอรอบ scheduled
// ใช้กติกา payment_confirmed ที่ร้านตั้งไว้ (config/notifyRules): ปิดไว้ = ไม่ส่ง · ช่องทางตามกติกา (Facebook ก่อน ถ้าส่งไม่ได้ → SMS)
// งานพื้นหลัง: ไม่ทำให้การยืนยันล้มเหลว · ข้อความที่ส่งไม่ได้แจ้งกระดิ่งพนักงาน
import { fillTemplate, orderVars } from './scheduled/plan.ts'
import { inFbWindow } from './slipnotice.ts'
import { sendSmsGateway } from './sms.ts'

// ข้อความค่าเริ่มต้น (เหมือน PAY_CONFIRMED_TPL ในแอป แต่ไม่มีลิงก์ออร์เดอร์)
const PAY_CONFIRMED_V2 = 'ได้รับชำระ {ยอดที่ชำระ} ออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณค่ะ\nยอดรวม {ยอดรวม} · ชำระแล้ว {ชำระแล้ว} · คงค้าง {คงค้าง}\nนัด{ส่งมอบ} {วันนัด} {เวลานัด}\nดูออร์เดอร์: {ลิงก์ออร์เดอร์}'
const RESERVE = 'หลังชำระเงินแล้ว ร้านสงวนสิทธิ์ตรวจสอบรายละเอียดรายการสั่งซื้อ และลูกค้าได้ศึกษาข้อตกลง PDPA และอื่น ๆ แล้ว'
export const PAY_CONFIRMED_DEFAULT = 'ได้รับชำระ {ยอดที่ชำระ} ออร์เดอร์ {เลขออร์เดอร์} แล้ว ขอบคุณค่ะ\nยอดรวม {ยอดรวม} · ชำระแล้ว {ชำระแล้ว} · คงค้าง {คงค้าง}\nนัด{ส่งมอบ} {วันนัด} {เวลานัด}\nหลังชำระเงินแล้ว ร้านสงวนสิทธิ์ตรวจสอบรายละเอียดรายการสั่งซื้อ และลูกค้าได้ศึกษาข้อตกลง PDPA และอื่น ๆ แล้ว'

type Rule = { event?: string; enabled?: boolean; channels?: string[]; template?: string }

// กติกาที่ใช้ได้: null = ร้านปิดการแจ้งนี้ · ยังไม่มีกติกา = ใช้ค่าเริ่มต้นและช่องทางทั้งหมด
export function paidNoticeRule(notifyRules: unknown): { template: string; channels: string[] } | null {
  const list: Rule[] = Array.isArray(notifyRules) ? notifyRules : []
  const r = list.find((x) => x?.event === 'payment_confirmed')
  if (r && r.enabled === false) return null
  const saved = typeof r?.template === 'string' ? r.template.trim() : ''
  // เทมเพลตเดิมที่ยังไม่มีข้อความสงวนสิทธิ์ → ใช้ค่าเริ่มต้นใหม่
  const template = saved && saved !== PAY_CONFIRMED_V2 ? r!.template! : PAY_CONFIRMED_DEFAULT
  const channels = Array.isArray(r?.channels) ? r.channels : ['facebook', 'sms']
  return { template, channels }
}

// ข้อความที่ส่ง: ใส่ค่าตัวแปร แล้วลบตัวแปรที่ไม่มีค่าออก
export function paidNoticeText(template: string, vars: Record<string, string>): string {
  return fillTemplate(template, vars).replace(/\{[^{}]+\}/g, '').replace(/[ \t]+\n/g, '\n').trim()
}

export async function notifyPaymentConfirmed(sb: any, n: { order: any; customerId: string; amount: number }): Promise<boolean> {
  try {
    const cu = await sb.from('punpang_customers').select('id,name,phone,data').eq('id', n.customerId).maybeSingle()
    if (!cu?.data) return false
    const customer = { ...(cu.data.data || {}), id: cu.data.id, name: cu.data.name || '', phone: cu.data.phone || '' }
    const kv = await sb.from('punpang_kv').select('id,data').eq('collection', 'config').in('id', ['notifyRules', 'integrations', 'shop'])
    const cfg: Record<string, any> = {}
    for (const r of kv.data || []) cfg[r.id] = r.data?.v
    const rule = paidNoticeRule(cfg.notifyRules)
    if (!rule) return false
    const text = paidNoticeText(rule.template, orderVars(n.order, { paid: n.amount }, cfg.shop || {}, customer))
    if (!text) return false

    let sent = false
    // Facebook: ต้องผูก PSID · อยู่ในช่วง 24 ชม. หลังลูกค้าทักล่าสุด · มี Page token
    if (rule.channels.includes('facebook') && cfg.integrations?.facebook?.enabled !== false) {
      const psid = String(customer.fbPsid || '')
      const pg = await sb.from('punpang_fb_pages').select('token').limit(1).maybeSingle()
      const chat = /^\d{5,30}$/.test(psid) && pg?.data?.token ? await sb.from('punpang_chats').select('id,data,updated_at').eq('channel', 'facebook').eq('external_id', psid).maybeSingle() : null
      if (chat?.data && inFbWindow(chat.data.data?.lastInboundAt, Date.now())) {
        const ver = (Deno.env.get('FB_GRAPH_VERSION') || 'v24.0').trim()
        try {
          const r = await fetch(`https://graph.facebook.com/${ver}/me/messages?${new URLSearchParams({ access_token: pg.data.token })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } }), signal: AbortSignal.timeout(10000) })
          sent = r.ok
        } catch { sent = false }
        if (sent) await appendChatMessage(sb, chat.data.id, text, n.order.id)
      }
    }
    // SMS: เมื่อ Facebook ส่งไม่ได้ และกติกาเปิด SMS ไว้ · เบอร์ต้องเป็นมือถือไทย
    if (!sent && rule.channels.includes('sms')) {
      const phone = String(customer.phone || '').replace(/\D/g, '')
      if (/^0[689]\d{8}$/.test(phone)) sent = await sendSmsGateway(phone, text, `paid-${n.order.id}-${Date.now().toString(36)}`)
    }
    if (!sent) await bellFailed(sb, n.order, 'แจ้งลูกค้าว่ายืนยันชำระไม่สำเร็จ (ยืนยันแล้ว)')
    return sent
  } catch (e) {
    console.error('payment-confirm-notify', String((e as Error)?.message || e))
    return false
  }
}

// บันทึกข้อความลงแชทของลูกค้า (เขียนแบบเทียบ updated_at กันชนกับ webhook)
async function appendChatMessage(sb: any, chatId: string, text: string, orderId: string): Promise<void> {
  const sm = { id: `cm${Math.random().toString(36).slice(2, 10)}`, from: 'staff', kind: 'text', text, orderId, quoteId: null, replyTo: null, ask: null, answerFor: null, filled: null, at: new Date().toISOString(), by: 'ระบบ', delivery: 'sent' }
  for (let i = 0; i < 4; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chatId).maybeSingle()
    if (cur.error || !cur.data) break
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    const up = await sb.from('punpang_chats').update({ data: { ...d, messages: [...msgs, sm] } }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (!up.error && (up.data || []).length) break
  }
}

async function bellFailed(sb: any, order: any, reason: string): Promise<void> {
  await sb.from('punpang_records').insert({ collection: 'bell', id: `bl${Math.random().toString(36).slice(2, 8)}`, data: { audience: 'staff', event: 'notify_failed', title: 'แจ้งลูกค้าไม่สำเร็จ', text: `${order?.code ?? ''} · ${reason}`, orderId: order?.id ?? null, readBy: [], at: new Date().toISOString() } })
}

