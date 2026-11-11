// งานตรวจสลิปจากรูปในแชท (Edge Function): อ่าน QR → จำแนก → จับคู่กับออร์เดอร์ที่คุยกันล่าสุด → บันทึกเป็นยอดรอตรวจ + แจ้งกระดิ่ง
// ไม่ยืนยันยอดเอง (QR สลิปไม่มียอดเงินและยืนยันกับธนาคารไม่ได้จากที่นี่) · พนักงานตรวจยอดแล้วยืนยันในหน้าชำระเงินเสมอ
// เขียนออร์เดอร์แบบเทียบ updated_at (CAS) และเก็บไฟล์ในบัคเก็ตส่วนตัว punpang-slips เหมือน customer-order
import { buildSlipPayment, classifyThaiQr, latestOrderId, planAttach, slipKeyOf } from './slip.ts'
import { imageSize, readQrTexts } from './qrimage.ts'

export type SlipOutcome =
  | 'matched' | 'duplicate' | 'no_order' | 'order_missing' | 'order_inactive' | 'order_paid' | 'pending_exists'
  | 'upload_failed' | 'busy' | 'chat_missing' | 'disabled' | 'no_slip' | 'error'

export const SLIP_REASON_TH: Partial<Record<SlipOutcome, string>> = {
  no_order: 'ยังไม่มีออร์เดอร์ในแชทนี้ — ผูกออร์เดอร์เองในแชท',
  duplicate: 'สลิปนี้เคยส่งมาแล้ว — ไม่แนบซ้ำ',
  order_missing: 'ไม่พบออร์เดอร์ที่คุยกันล่าสุด',
  order_inactive: 'ออร์เดอร์ถูกยกเลิกหรือยังเป็นร่าง',
  order_paid: 'ออร์เดอร์นี้ชำระครบแล้ว',
  pending_exists: 'มียอดรอตรวจของออร์เดอร์นี้อยู่แล้ว',
  upload_failed: 'บันทึกไฟล์สลิปไม่สำเร็จ — ให้ลูกค้าส่งใหม่',
  busy: 'ออร์เดอร์กำลังถูกแก้ไขพร้อมกัน — ให้ลูกค้าส่งสลิปอีกครั้ง',
}

export type SlipJobInput = {
  sb: any // SupabaseClient (ใช้เฉพาะ from / rpc / storage) เพื่อให้ทดสอบด้วยตัวจำลองได้
  chatId: string
  msgId: string
  bytes: Uint8Array
  nowMs?: number
  rand?: (n: number) => string
}

const TH_OFFSET = 7 * 3600_000
const pad2 = (n: number) => String(n).padStart(2, '0')
const ddmmyy = (d: Date) => { const t = new Date(d.getTime() + TH_OFFSET); return `${pad2(t.getUTCDate())}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCFullYear() % 100)}` }
const localNow = (d: Date) => new Date(d.getTime() + TH_OFFSET).toISOString().slice(0, 16) // เวลาไทย YYYY-MM-DDTHH:mm
const randHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('')

// เปิด/ปิดได้จาก punpang_kv (config / slipQr · v.enabled = false) · ไม่มีแถว = เปิด
async function slipEnabled(sb: any): Promise<boolean> {
  const r = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'slipQr').maybeSingle()
  return r?.data?.data?.v?.enabled !== false
}

// ใส่ผลลงข้อความในแชท (เทียบ updated_at) · ไม่กระทบการแนบ ถ้าเขียนไม่ได้ก็แค่ไม่มีป้าย
async function annotate(sb: any, chatId: string, msgId: string, value: Record<string, unknown>) {
  for (let i = 0; i < 4; i++) {
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chatId).maybeSingle()
    if (cur?.error || !cur?.data) return
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    if (!msgs.some((m) => m?.id === msgId)) return
    const next = { ...d, messages: msgs.map((m) => (m?.id === msgId ? { ...m, slipCheck: value } : m)) }
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (!up?.error && (up?.data || []).length) return
  }
}

async function bell(sb: any, rec: { event: string; title: string; text: string; orderId?: string; chatId?: string }, rand: (n: number) => string) {
  await sb.from('punpang_records').insert({
    collection: 'bell', id: `bl${rand(6)}`,
    data: { audience: 'staff', event: rec.event, title: rec.title, text: rec.text, orderId: rec.orderId ?? null, chatId: rec.chatId ?? null, readBy: [], at: new Date().toISOString() },
  })
}

// จุดเข้า: รูปหนึ่งรูปจากข้อความลูกค้า · คืนผลลัพธ์ (ทุกกรณีที่ไม่ใช่สลิปไม่แตะข้อมูล)
export async function checkSlipImage(input: SlipJobInput): Promise<SlipOutcome> {
  const { sb, chatId, msgId, bytes } = input
  const now = new Date(input.nowMs ?? Date.now())
  const rand = input.rand ?? randHex
  if (!(await slipEnabled(sb))) return 'disabled'

  const texts = await readQrTexts(bytes)
  let slip: { sendingBank: string; transRef: string } | null = null
  for (const t of texts) {
    const c = classifyThaiQr(t)
    if (c.kind === 'slip') { slip = c; break }
  }
  if (!slip) return 'no_slip'
  const key = slipKeyOf(slip.sendingBank, slip.transRef)

  // จบแบบไม่แนบ: บันทึกป้ายในแชท + แจ้งพนักงานให้ตรวจเอง
  const finish = async (outcome: SlipOutcome, orderCode?: string, orderId?: string): Promise<SlipOutcome> => {
    await annotate(sb, chatId, msgId, { status: outcome, ...(orderCode ? { orderCode } : {}), at: now.toISOString() })
    const reason = SLIP_REASON_TH[outcome] ?? 'ไม่สามารถจับคู่สลิปอัตโนมัติ'
    await bell(sb, { event: 'slip_check', title: 'สลิปในแชทรอตรวจเอง', text: orderCode ? `${reason} · ${orderCode}` : reason, chatId, orderId }, rand)
    return outcome
  }

  const ch = await sb.from('punpang_chats').select('id,data').eq('id', chatId).maybeSingle()
  if (ch?.error) return 'error'
  if (!ch?.data) return 'chat_missing'
  const orderId = latestOrderId(ch.data.data?.messages)
  if (!orderId) return finish('no_order')

  // กันแนบซ้ำทั้งระบบ: เลขอ้างอิงเดียวกันเคยอยู่ในยอดของออร์เดอร์ใดก็ได้
  const seen = await sb.from('punpang_orders').select('id,code').contains('data', { payments: [{ slipKey: key }] }).limit(1)
  if (seen?.error) return 'error'
  if ((seen?.data || []).length) return finish('duplicate', seen.data[0].code, seen.data[0].id)

  const ext = imageSize(bytes)?.type === 'png' ? 'png' : 'jpg'
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
  let stagedPath: string | null = null
  let code = ''
  let paymentId = ''
  const discardStaged = async () => { if (stagedPath) await sb.storage.from('punpang-slips').remove([stagedPath]) }

  for (let attempt = 0; attempt < 3; attempt++) {
    const or = await sb.from('punpang_orders').select('id,code,status,customer_id,data,updated_at').eq('id', orderId).maybeSingle()
    if (or?.error) { await discardStaged(); return 'error' }
    if (!or?.data) { await discardStaged(); return finish('order_missing') }
    const row = or.data
    const d = row.data || {}
    const payments: any[] = Array.isArray(d.payments) ? d.payments : []
    if (payments.some((p) => p?.slipKey === key)) { await discardStaged(); return finish('duplicate', row.code, row.id) }
    const plan = planAttach({ status: row.status, data: d })
    if (!plan.ok) { await discardStaged(); return finish(plan.reason, row.code, row.id) }

    // อัปโหลดไฟล์ครั้งเดียว (ลองใหม่ใช้ไฟล์เดิม) · ล้มเหลว = ไม่แตะออร์เดอร์
    if (!stagedPath) {
      const path = `${row.id}/${rand(16)}.${ext}`
      const up = await sb.storage.from('punpang-slips').upload(path, bytes, { contentType, upsert: false })
      if (up?.error) return finish('upload_failed', row.code, row.id)
      stagedPath = path
    }
    // ออกเลข PAY ครั้งเดียว (เหมือนการแจ้งชำระจากหน้าออร์เดอร์)
    if (!code) {
      const al = await sb.rpc('punpang_alloc_numbers_server', { p_prefix: 'PAY', p_day: ddmmyy(now), p_n: 1 })
      if (al?.error || !Number.isInteger(al?.data)) { await discardStaged(); return 'error' }
      code = `PAY-${ddmmyy(now)}-${String(al.data).padStart(5, '0')}`
      paymentId = `pay${now.getTime().toString(36)}${rand(3)}`
    }

    const payment = buildSlipPayment({
      id: paymentId, code, amount: plan.amount, slipRef: `sb://punpang-slips/${stagedPath}`, slipKey: key,
      paidAt: localNow(now), nowIso: now.toISOString(),
    })
    const next = {
      ...d,
      payments: [...payments, payment],
      history: [...(Array.isArray(d.history) ? d.history : []), { at: now.toISOString(), text: 'ลูกค้าส่งสลิปในแชท (QR) · ระบบจับคู่กับออร์เดอร์นี้อัตโนมัติ (รอตรวจยอด)', by: 'customer' }],
    }
    const status = row.status === 'awaiting_payment' ? 'payment_reported' : row.status
    const up = await sb.from('punpang_orders').update({ data: next, status }).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (up?.error) { await discardStaged(); return 'error' }
    if ((up?.data || []).length) {
      await bell(sb, { event: 'team_customer_paid', title: 'ลูกค้าแจ้งโอน', text: `${row.code} · ยอด ${plan.amount.toFixed(2)} (สลิป QR ยังไม่ได้ตรวจยอด)`, orderId: row.id, chatId }, rand)
      await annotate(sb, chatId, msgId, { status: 'matched', orderCode: row.code, paymentId, at: now.toISOString() })
      return 'matched'
    }
    // เขียนชน (พนักงานแก้ออร์เดอร์พร้อมกัน) → อ่านใหม่แล้วทำซ้ำ
  }
  await discardStaged()
  return finish('busy', undefined, orderId)
}
