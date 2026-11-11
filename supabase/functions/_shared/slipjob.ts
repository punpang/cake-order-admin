// งานตรวจสลิปจากรูปในแชท (Edge Function): อ่าน QR → จำแนก → จับคู่กับออร์เดอร์ที่คุยกันล่าสุด → บันทึกเป็นยอดรอตรวจ + แจ้งกระดิ่ง
// ไม่ยืนยันยอดเอง (QR สลิปไม่มียอดเงินและยืนยันกับธนาคารไม่ได้จากที่นี่) · พนักงานตรวจยอดแล้วยืนยันในหน้าชำระเงินเสมอ
// เขียนออร์เดอร์แบบเทียบ updated_at (CAS) และเก็บไฟล์ในบัคเก็ตส่วนตัว punpang-slips เหมือน customer-order
// กติกาเลขอ้างอิง/ธนาคาร/วัน-เวลาชำระ ใช้ชุดเดียวกับหน้าชำระเงินของลูกค้า (payfields.ts)
import { buildSlipPayment, classifyThaiQr, latestOrderId, planAttach, slipKeyOf } from './slip.ts'
import { imageSize, readQrTexts } from './qrimage.ts'
import { bankByCode, normalizeRef, paidAtFromMessage, refTaken } from './payfields.ts'
import { OCR_DEFAULT_MODEL, readSlipFields, type SlipFields } from './slipocr.ts'

export type SlipOutcome =
  | 'matched' | 'duplicate' | 'no_order' | 'order_missing' | 'order_inactive' | 'order_paid' | 'pending_exists'
  | 'upload_failed' | 'busy' | 'chat_missing' | 'disabled' | 'no_slip' | 'error'
  | 'manual' // โหมดแมนนวล: เก็บสลิปไว้ให้พนักงานผูกออร์เดอร์เองในแชท (ยังไม่แนบ)

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
  ocrKey?: string // คีย์ Anthropic (จาก Deno.env ของ fb-webhook) · ว่าง = ไม่อ่านยอดจากภาพ
  ocrRead?: (o: { bytes: Uint8Array; key: string; model: string }) => Promise<SlipFields | null> // ทดสอบแทนการเรียก API จริง
}

const TH_OFFSET = 7 * 3600_000
const pad2 = (n: number) => String(n).padStart(2, '0')
const ddmmyy = (d: Date) => { const t = new Date(d.getTime() + TH_OFFSET); return `${pad2(t.getUTCDate())}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCFullYear() % 100)}` }
const randHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('')

export type SlipMode = 'auto' | 'manual'

// ตั้งค่าจาก punpang_kv (config / slipQr): v.enabled = false ปิด · v.mode = 'manual' โหมดแมนนวล · ไม่มีแถวหรือค่าอื่น = เปิดแบบอัตโนมัติ
// ค่า ocr: { enabled: true } เปิดอ่านยอด/วันเวลาจากภาพ (ค่าเริ่มต้นปิด) · model ไม่ระบุ = OCR_DEFAULT_MODEL
async function slipConfig(sb: any): Promise<{ enabled: boolean; mode: SlipMode; ocr: { enabled: boolean; model: string } }> {
  const r = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'slipQr').maybeSingle()
  const v = r?.data?.data?.v
  const model = typeof v?.ocr?.model === 'string' && v.ocr.model.trim() ? v.ocr.model.trim() : OCR_DEFAULT_MODEL
  return { enabled: v?.enabled !== false, mode: v?.mode === 'manual' ? 'manual' : 'auto', ocr: { enabled: v?.ocr?.enabled === true, model } }
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
  const cfg = await slipConfig(sb)
  if (!cfg.enabled) return 'disabled'

  const texts = await readQrTexts(bytes)
  let slip: { sendingBank: string; transRef: string } | null = null
  for (const t of texts) {
    const c = classifyThaiQr(t)
    if (c.kind === 'slip') { slip = c; break }
  }
  if (!slip) return 'no_slip'
  const ref = normalizeRef(slip.transRef)
  const bankCode = slip.sendingBank
  const bankName = bankByCode(bankCode)?.name ?? null
  const key = slipKeyOf(bankCode, ref)

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
  const messages: any[] = Array.isArray(ch.data.data?.messages) ? ch.data.data.messages : []
  const orderId = latestOrderId(messages)
  // โหมดอัตโนมัติ: ไม่มีออร์เดอร์ที่คุยล่าสุดให้จับคู่ → แจ้งให้ผูกเอง (โหมดแมนนวลพนักงานเลือกเองในแชทได้)
  if (cfg.mode === 'auto' && !orderId) return finish('no_order')
  // เวลาที่ลูกค้าส่งข้อความสลิป → ใช้เป็นวัน-เวลาชำระ (ดู paidAtFromMessage)
  const msgAt = messages.find((m: any) => m?.id === msgId)?.at

  // กันแนบซ้ำทั้งระบบ (ทั้งสองโหมด): เลขอ้างอิงเดียวกันในรายการชำระที่ยังไม่ยกเลิกของออร์เดอร์ใดก็ได้
  const seen = await sb.from('punpang_orders').select('id,code,data').contains('data', { payments: [{ ref }] })
  if (seen?.error) return 'error'
  const hit = (seen?.data || []).find((r: any) => refTaken(r.data?.payments, ref))
  if (hit) return finish('duplicate', hit.code, hit.id)

  // อ่านยอดและวัน-เวลาจากตัวหนังสือบนภาพ (เฉพาะเมื่อร้านเปิดไว้และมีคีย์) · อ่านไม่ได้ = ใช้ค่าเดิมต่อไป
  const fields: SlipFields | null = cfg.ocr.enabled && input.ocrKey
    ? await (input.ocrRead ?? readSlipFields)({ bytes, key: input.ocrKey, model: cfg.ocr.model }).catch(() => null)
    : null

  if (cfg.mode === 'manual') {
    // โหมดแมนนวล: เก็บรูปไว้ก่อนแล้วให้พนักงานเลือกออร์เดอร์ในแชท (ที่แนะนำคือออร์เดอร์ที่คุยล่าสุด) · ไม่สร้างรายการชำระ ไม่แตะออร์เดอร์
    const kind = imageSize(bytes)?.type === 'png' ? 'png' : 'jpg'
    const path = `manual/${chatId}/${rand(16)}.${kind}`
    const up = await sb.storage.from('punpang-slips').upload(path, bytes, { contentType: kind === 'png' ? 'image/png' : 'image/jpeg', upsert: false })
    if (up?.error) return finish('upload_failed', undefined, orderId ?? undefined)
    const sug = orderId ? await sb.from('punpang_orders').select('id,code').eq('id', orderId).maybeSingle() : null
    const sugCode: string | undefined = sug?.data?.code || undefined
    const suggestedId = sugCode && orderId ? orderId : undefined
    await annotate(sb, chatId, msgId, {
      status: 'manual', ...(suggestedId ? { orderId: suggestedId, orderCode: sugCode } : {}),
      slipRef: `sb://punpang-slips/${path}`, slipKey: key, bankCode, ...(bankName ? { bankName } : {}), ref, at: now.toISOString(),
      ...(fields?.amount != null ? { ocrAmount: fields.amount } : {}), ...(fields?.paidAt ? { ocrPaidAt: fields.paidAt } : {}),
    })
    const amountNote = fields?.amount != null ? ` · ยอดจากสลิป ${fields.amount.toFixed(2)}` : ''
    await bell(sb, {
      event: 'slip_check', title: 'สลิปในแชทรอผูกออร์เดอร์',
      text: (sugCode ? `รอผูกกับ ${sugCode} หรือเลือกออร์เดอร์อื่นในแชท` : 'ยังไม่มีออร์เดอร์ที่คุยล่าสุด · เลือกออร์เดอร์ในแชท') + amountNote,
      chatId, orderId: suggestedId,
    }, rand)
    return 'manual'
  }

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
    if (refTaken(payments, ref)) { await discardStaged(); return finish('duplicate', row.code, row.id) }
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
      id: paymentId, code, amount: fields?.amount ?? plan.amount, slipRef: `sb://punpang-slips/${stagedPath}`, slipKey: key,
      paidAt: fields?.paidAt ?? paidAtFromMessage(msgAt, d.createdAt, now.getTime()), nowIso: now.toISOString(),
      bankCode, bankName, ref,
    })
    const next = {
      ...d,
      payments: [...payments, payment],
      history: [...(Array.isArray(d.history) ? d.history : []), { at: now.toISOString(), text: 'ลูกค้าส่งสลิปในแชท (QR) · ระบบจับคู่กับออร์เดอร์นี้อัตโนมัติ (รอตรวจยอด)', by: 'customer' }],
    }
    const status = row.status === 'awaiting_payment' ? 'payment_reported' : row.status
    const up = await sb.from('punpang_orders').update({ data: next, status }).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (up?.error) {
      await discardStaged()
      // ชนกับตัวกันเลขอ้างอิงซ้ำระดับฐานข้อมูล (SQLSTATE 23505) = สลิปซ้ำจริง ไม่ใช่ระบบขัดข้อง
      if (up.error.code === '23505') return finish('duplicate')
      return 'error'
    }
    if ((up?.data || []).length) {
      const shownAmount = fields?.amount ?? plan.amount
      const how = fields?.amount != null ? 'ยอดอ่านจากภาพสลิป ยังไม่ได้ตรวจกับธนาคาร' : 'สลิป QR ยังไม่ได้ตรวจยอด'
      await bell(sb, { event: 'team_customer_paid', title: 'ลูกค้าแจ้งโอน', text: `${row.code} · ยอด ${shownAmount.toFixed(2)} (${how})`, orderId: row.id, chatId }, rand)
      await annotate(sb, chatId, msgId, { status: 'matched', orderCode: row.code, paymentId, at: now.toISOString() })
      return 'matched'
    }
    // เขียนชน (พนักงานแก้ออร์เดอร์พร้อมกัน) → อ่านใหม่แล้วทำซ้ำ
  }
  await discardStaged()
  return finish('busy', undefined, orderId ?? undefined)
}
