// งานตรวจสลิปจากรูปในแชท (Edge Function): อ่าน QR → จำแนก → จับคู่กับออร์เดอร์ที่คุยกันล่าสุด → บันทึกเป็นยอดรอตรวจ + แจ้งกระดิ่ง
// ไม่ยืนยันยอดเอง (QR สลิปไม่มียอดเงินและยืนยันกับธนาคารไม่ได้จากที่นี่) · พนักงานตรวจยอดแล้วยืนยันในหน้าชำระเงินเสมอ (ยกเว้นยืนยันสลิปอัตโนมัติที่เปิดไว้และครบเงื่อนไข)
// เขียนออร์เดอร์แบบเทียบ updated_at (CAS) และเก็บไฟล์ส่วนตัวใน R2 ผ่าน Worker เหมือน customer-order
// กติกาเลขอ้างอิง/ธนาคาร/วัน-เวลาชำระ ใช้ชุดเดียวกับหน้าชำระเงินของลูกค้า (payfields.ts)
import { orderNo } from './slipref.ts'
import { autoConfirmOf, buildSlipPayment, classifyThaiQr, daysUntilPickup, latestOrderId, orderTotals, planAttach, slipKeyOf } from './slip.ts'
import { slipChecksOf } from './schedlib/slipChecks.js'
import { confirmSlipPayment } from './slipautoconfirm.ts'
import { readQrTexts } from './qrimage.ts'
import { bankByCode, normalizeRef, paidAtFromMessage, refTaken } from './payfields.ts'
import { ocrFlagsOf, readSlipFields, readSlipFieldsWorkersAI, type OcrEngine, type SlipFields } from './slipocr.ts'
import { readSlipOnce } from './slipstore.ts'
import { codeOfRef, digitsOf, merchantMismatch, shopPartOf } from './slipref.ts'
import { filesEnv, svcDelete, svcUpload, type FilesEnv } from './filesvc.ts'

export type SlipOutcome =
  | 'matched' | 'duplicate' | 'no_order' | 'order_missing' | 'order_inactive' | 'order_paid' | 'pending_exists'
  | 'upload_failed' | 'busy' | 'chat_missing' | 'disabled' | 'no_slip' | 'error'
  | 'manual' // โหมดแมนนวล: เก็บสลิปไว้ให้พนักงานผูกออร์เดอร์เองในแชท (ยังไม่แนบ)

export const SLIP_REASON_TH: Partial<Record<SlipOutcome, string>> = {
  no_order: 'ยังไม่มีออร์เดอร์ในแชทนี้ — เลือกออร์เดอร์ในแชทแล้วรับชำระ',
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
  ocrWai?: { accountId: string; token: string; model: string } // Workers AI (Cloudflare) · มีค่า = ลองก่อนระบบเดิม (Claude)
  ocrRead?: (o: { bytes: Uint8Array; key: string; model: string }) => Promise<SlipFields | null> // ทดสอบแทนการเรียก API จริง (ใช้กับ Claude)
  ocrReadBy?: Partial<Record<'wai' | 'claude', (o: { bytes: Uint8Array; key: string; model: string }) => Promise<SlipFields | null>>> // ทดสอบลำดับตัวอ่าน
  files?: FilesEnv // เซิร์ฟเวอร์ไฟล์ (R2 ผ่าน Worker) · ไม่ระบุ = ใช้ FILES_URL / FILES_SERVICE_KEY จาก Deno.env
}

const TH_OFFSET = 7 * 3600_000
const pad2 = (n: number) => String(n).padStart(2, '0')
const ddmmyy = (d: Date) => { const t = new Date(d.getTime() + TH_OFFSET); return `${pad2(t.getUTCDate())}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCFullYear() % 100)}` }
const randHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('')

export type SlipMode = 'auto' | 'manual'

// ตั้งค่าจาก punpang_kv (config / slipQr): v.enabled = false ปิด · v.mode = 'manual' โหมดแมนนวล · ไม่มีแถวหรือค่าอื่น = เปิดแบบอัตโนมัติ
// ค่า ocr แยกเป็น 2 สวิตช์: wai (Workers AI) · claude (ระบบเดิม) · ค่าเดิม ocr.enabled = claude (ถ้ายังไม่มี claude)
// ลำดับการลอง: Workers AI → Claude เฉพาะตัวที่เปิดและตั้งค่าไว้ · model ไม่ระบุ = OCR_DEFAULT_MODEL
async function slipConfig(sb: any): Promise<{ enabled: boolean; mode: SlipMode; ocr: { wai: boolean; claude: boolean; model: string }; merchantCode: string; autoConfirm: { enabled: boolean; days: number } }> {
  const r = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'slipQr').maybeSingle()
  const v = r?.data?.data?.v
  // รหัสร้านค้า (ตั้งในหน้าตั้งค่าร้าน เก็บที่ config/shop) · ว่าง = ไม่ตรวจรหัสร้านค้า
  const sh = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  return { enabled: v?.enabled !== false, mode: v?.mode === 'manual' ? 'manual' : 'auto', ocr: ocrFlagsOf(v?.ocr), merchantCode: digitsOf(sh?.data?.data?.v?.merchantCode), autoConfirm: autoConfirmOf(v) }
}

// จับคู่ออร์เดอร์จากรหัสอ้างอิงร้านค้าบนสลิป (แปลงจากเลขเดิม ไม่เก็บเพิ่ม) · ไม่พบ = null
async function orderIdOfShopRef(sb: any, shopRef: string): Promise<string | null> {
  const code = codeOfRef(shopRef)
  if (!code) return null
  const r = await sb.from('punpang_orders').select('id').eq('code', code).maybeSingle()
  return r?.data?.id ?? null
}

// ใส่ผลลงข้อความในแชท (เทียบ updated_at) · ไม่กระทบการแนบ ถ้าเขียนไม่ได้ก็แค่ไม่มีป้าย
// ใส่ผลลงข้อความในแชท (เทียบ updated_at) · แชทที่ถูกเขียนพร้อมกันบ่อยจึงลองใหม่หลายรอบพร้อมหน่วงเวลาสั้น ๆ
// ไม่กระทบการแนบ · เขียนไม่สำเร็จจริง ๆ บันทึก log (มีเฉพาะรหัสแชทและรหัสข้อความ) เพื่อตรวจสอบ
async function annotate(sb: any, chatId: string, msgId: string, value: Record<string, unknown>): Promise<boolean> {
  let reason = 'write_failed'
  for (let i = 0; i < 8; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 80 + Math.floor(Math.random() * 220)))
    const cur = await sb.from('punpang_chats').select('id,data,updated_at').eq('id', chatId).maybeSingle()
    if (cur?.error || !cur?.data) { reason = 'read_failed'; continue }
    const d = cur.data.data || {}
    const msgs: any[] = Array.isArray(d.messages) ? d.messages : []
    if (!msgs.some((m) => m?.id === msgId)) { reason = 'message_missing'; continue }
    const next = { ...d, messages: msgs.map((m) => (m?.id === msgId ? { ...m, slipCheck: value } : m)) }
    const up = await sb.from('punpang_chats').update({ data: next }).eq('id', chatId).eq('updated_at', cur.data.updated_at).select('id')
    if (!up?.error && (up?.data || []).length) return true
    reason = up?.error ? 'write_error' : 'conflict'
  }
  console.error('slip-annotate', reason, chatId, msgId)
  return false
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
  const files: FilesEnv = input.files ?? filesEnv()
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
  const chatOrderId = latestOrderId(messages)
  // เวลาที่ลูกค้าส่งข้อความสลิป → ใช้เป็นวัน-เวลาชำระ (ดู paidAtFromMessage)
  const msgAt = messages.find((m: any) => m?.id === msgId)?.at

  // สลิปเดิมที่เคยเก็บเป็นป้ายในแชทใดก็ได้ (โหมดแมนนวลยังไม่มีรายการชำระ จึงต้องเทียบจากป้ายในแชท) · ตรวจก่อนส่ง AI เสมอ
  const seenInChats = await sb.from('punpang_chats').select('id,data').contains('data', { messages: [{ slipCheck: { slipKey: key } }] })
  if (seenInChats?.error) return 'error'

  // อ่านยอดและวัน-เวลาจากตัวหนังสือบนภาพ (เฉพาะเมื่อร้านเปิดไว้และมีคีย์) · อ่านไม่ได้ = ใช้ค่าเดิมต่อไป
  // หลัง QR พบว่าเป็นสลิป · ลำดับ: Workers AI → ระบบเดิม (Claude) · ตัวที่เปิดไว้และตั้งค่าครบจะลอง · ตัวแรกที่ได้ยอดหรือวัน-เวลาจะหยุด
  const engines: OcrEngine[] = []
  const w = input.ocrWai
  if (cfg.ocr.wai && w?.accountId && w?.token) {
    const read: (o: { bytes: Uint8Array; key: string; model: string }) => Promise<SlipFields | null> = input.ocrReadBy?.wai ?? ((o) => readSlipFieldsWorkersAI({ bytes: o.bytes, accountId: w.accountId, token: w.token, model: w.model }))
    engines.push({ name: 'wai', read: (x) => read({ bytes: x, key: '', model: '' }) })
  }
  if (cfg.ocr.claude && input.ocrKey) {
    const read: (o: { bytes: Uint8Array; key: string; model: string }) => Promise<SlipFields | null> = input.ocrReadBy?.claude ?? input.ocrRead ?? readSlipFields
    engines.push({ name: 'claude', read: (x) => read({ bytes: x, key: input.ocrKey!, model: cfg.ocr.model }) })
  }
  // อ่านผ่าน readSlipOnce: ใช้ผลที่เคยได้ตามเลขอ้างอิงก่อน (ไม่เรียกโมเดลซ้ำ) · ผลที่ตอบแล้วจำไว้ · อ่านไม่ครบเก็บรูปไว้ชุดเทรน
  // สลิปรูปเดิมที่เคยเก็บในแชทและยังไม่ได้แนบเข้าออร์เดอร์ → ซ้ำ (ไม่อ่านซ้ำ) · ที่แนบแล้วซ้ำได้เฉพาะออร์เดอร์เดิมที่ยังไม่ปิด
  const priorImage = (seenInChats?.data || []).flatMap((c: any) => (Array.isArray(c.data?.messages) ? c.data.messages : []).map((m: any) => ({ c, m }))).filter(({ c, m }: any) => m?.slipCheck?.slipKey === key && !(c.id === chatId && m?.id === msgId))
  if (priorImage.some(({ m }: any) => m.slipCheck.status !== 'matched')) return finish('duplicate')
  const fields = await readSlipOnce(sb, { key, bytes, bankCode, source: 'chat', engines, files })

  // ผูกอัตโนมัติได้เฉพาะเมื่อรหัสอ้างอิงร้านค้าบนสลิปตรงกับรหัสออร์เดอร์ (แปลงจากเลขเดิม) · ออร์เดอร์ที่คุยล่าสุดเป็นตัวแนะนำให้พนักงานเท่านั้น
  const refOrderId = fields?.shopRef ? await orderIdOfShopRef(sb, fields.shopRef) : null
  const orderId = refOrderId ?? chatOrderId
  // โหมดอัตโนมัติ: ไม่มีออร์เดอร์ให้จับคู่เลย → แจ้งให้ผูกเอง (โหมดแมนนวลพนักงานเลือกเองในแชทได้)
  if (cfg.mode === 'auto' && !orderId) return finish('no_order')
  // รหัสร้านค้าในสลิปไม่ตรงกับที่ตั้งไว้ (หรืออ่านไม่ได้) → ไม่ผูกอัตโนมัติ ส่งให้พนักงานพร้อมธง
  const flagged = merchantMismatch(cfg.merchantCode, fields?.merchantCode)
  const flagPart = { ...shopPartOf(fields), ...(flagged ? { merchantMismatch: true } : {}) }
  // เครื่องหมายตรวจสลิปกับออร์เดอร์ (ยอด · วัน-เวลาหลังสร้างออร์เดอร์ · รหัสร้านค้า · รหัสอ้างอิง) · บิล POS ยังข้ามไปก่อน
  const orderRow = orderId ? (await sb.from('punpang_orders').select('id,code,status,data').eq('id', orderId).maybeSingle()).data : null
  // เลขอ้างอิงซ้ำ: ซ้ำข้ามออร์เดอร์ = ไม่แนบ · ซ้ำในออร์เดอร์เดิม = แนบได้เมื่อออร์เดอร์ยังไม่ปิด (ไม่ยืนยันอัตโนมัติ) · ออร์เดอร์ปิดแล้ว = ไม่แนบ
  const closedOrder = !!orderRow && ['delivered', 'cancelled'].includes(orderRow.status)
  if (priorImage.some(({ m }: any) => !(orderRow && !closedOrder && m.slipCheck.orderCode === orderRow.code))) return finish('duplicate')
  if (ref && orderId) {
    const seenRef = await sb.from('punpang_orders').select('id,code,data').contains('data', { payments: [{ ref }] })
    if (seenRef?.error) return 'error'
    const other = (seenRef?.data || []).find((r: any) => r.id !== orderId && refTaken(r.data?.payments, ref))
    if (other) return finish('duplicate', other.code, other.id)
  }
  const sameRefDup = !!orderRow && !!ref && refTaken(orderRow.data?.payments, ref)
  if (sameRefDup && closedOrder) return finish('duplicate', orderRow.code, orderRow.id)
  // รายการแจ้งชำระของออร์เดอร์นี้ที่รหัสสุ่ม (Ref 2) ตรงกับสลิป (ยังไม่ส่งสลิป)
  const reqOfSlip = orderRow && fields?.qrRef ? ((orderRow.data?.payments ?? []) as any[]).find((p: any) => p.qrRef === fields.qrRef && p.status === 'reported' && p.customerSubmitted !== true) ?? null : null
  const checks = slipChecksOf({
    fields, configuredMerchantCode: cfg.merchantCode,
    order: orderRow ? { code: orderRow.code, createdAt: orderRow.data?.createdAt } : null,
    balance: orderRow ? orderTotals(orderRow.data).balance : null,
    request: reqOfSlip,
  })
  // ผูกอัตโนมัติเมื่อครบ 5 ข้อเป็น ✓ (ยอด · วัน-เวลา · รหัสร้านค้า · รหัสอ้างอิงร้านค้า (Ref 1) · รหัสสุ่ม (Ref 2) ตรงกับรายการแจ้งชำระ) และรหัสอ้างอิงตรงกับออร์เดอร์ที่พบ · นอกนั้นส่งให้พนักงาน
  const autoOk = cfg.mode === 'auto' && refOrderId !== null && !sameRefDup && checks.every((c) => c.ok === true)
  // เหตุผลที่ไม่ผ่าน ✗ = ไม่ถูกต้อง · – = อ่านไม่ได้หรือยังไม่มีข้อมูลให้เทียบ → ไปที่กระดิ่งและป้าย
  const reasons = checks.filter((c) => c.ok !== true).map((c) => `${c.ok === false ? '✗' : '–'} ${c.text}`)
  const mismatchNote = reasons.length ? ` · ${reasons.join(' · ')}` : ''

  if (!autoOk) {
    // ไม่ผูกอัตโนมัติ (โหมดแมนนวล หรือไม่ครบ 5 ข้อ): เก็บรูปไว้ก่อนแล้วให้พนักงานเลือกออร์เดอร์ในแชท (ที่แนะนำคือออร์เดอร์ที่รหัสอ้างอิงตรง หรือที่คุยล่าสุด) · ไม่สร้างรายการชำระ ไม่แตะออร์เดอร์
    let staged: { key: string; ref: string }
    try { staged = await svcUpload(files, bytes, `manual/${chatId}`) } catch { return finish('upload_failed', undefined, orderId ?? undefined) }
    const sug = orderId ? await sb.from('punpang_orders').select('id,code').eq('id', orderId).maybeSingle() : null
    const sugCode: string | undefined = sug?.data?.code || undefined
    const suggestedId = sugCode && orderId ? orderId : undefined
    await annotate(sb, chatId, msgId, {
      status: 'manual', ...flagPart, checks, ...(suggestedId ? { orderId: suggestedId, orderCode: sugCode } : {}),
      slipRef: staged.ref, slipKey: key, bankCode, ...(bankName ? { bankName } : {}), ref, at: now.toISOString(),
      ...(fields?.amount != null ? { ocrAmount: fields.amount } : {}), ...(fields?.paidAt ? { ocrPaidAt: fields.paidAt } : {}), ...(fields?.receiverAccount ? { ocrReceiverAccount: fields.receiverAccount } : {}),
    })
    const amountNote = fields?.amount != null ? ` · ยอดจากสลิป ${fields.amount.toFixed(2)}` : ''
    await bell(sb, {
      event: 'slip_check', title: 'สลิปในแชทรอรับชำระ',
      text: (sugCode ? `รอรับชำระกับ ${sugCode} หรือเลือกออร์เดอร์อื่นในแชท` : 'ยังไม่มีออร์เดอร์ที่คุยล่าสุด · เลือกออร์เดอร์ในแชท') + amountNote + mismatchNote,
      chatId, orderId: suggestedId,
    }, rand)
    return 'manual'
  }

  let stagedKey: string | null = null
  let stagedRef = ''
  let code = ''
  let paymentId = ''
  const discardStaged = async () => { if (stagedKey) await svcDelete(files, [stagedKey]) }

  for (let attempt = 0; attempt < 3; attempt++) {
    const or = await sb.from('punpang_orders').select('id,code,status,customer_id,data,updated_at').eq('id', orderId).maybeSingle()
    if (or?.error) { await discardStaged(); return 'error' }
    if (!or?.data) { await discardStaged(); return finish('order_missing') }
    const row = or.data
    const d = row.data || {}
    const payments: any[] = Array.isArray(d.payments) ? d.payments : []
    if (closedOrder && refTaken(payments, ref)) { await discardStaged(); return finish('duplicate', row.code, row.id) }
    const plan = planAttach({ status: row.status, data: d })
    if (!plan.ok) { await discardStaged(); return finish(plan.reason, row.code, row.id) }

    // อัปโหลดไฟล์ครั้งเดียวไป R2 (ลองใหม่ใช้ไฟล์เดิม) · ล้มเหลว = ไม่แตะออร์เดอร์
    if (!stagedKey) {
      let s: { key: string; ref: string }
      try { s = await svcUpload(files, bytes, row.id) } catch { return finish('upload_failed', row.code, row.id) }
      stagedKey = s.key
      stagedRef = s.ref
    }
    // รายการแจ้งชำระที่รหัสสุ่ม (Ref 2) ตรงกับสลิป → สลิปนี้ชำระงวดนั้น (ไม่ออกเลขใหม่) · ไม่มี → ออกเลข PAY ครั้งเดียว (เหมือนการแจ้งชำระจากหน้าออร์เดอร์)
    const req: any = fields?.qrRef ? (payments.find((p: any) => p.qrRef === fields.qrRef && p.status === 'reported' && p.customerSubmitted !== true) ?? null) : null
    if (req) {
      code = req.code
      paymentId = req.id
    } else if (!code) {
      const al = await sb.rpc('punpang_alloc_numbers_server', { p_prefix: 'PAY', p_day: ddmmyy(now), p_n: 1 })
      if (al?.error || !Number.isInteger(al?.data)) { await discardStaged(); return 'error' }
      code = `PAY-${ddmmyy(now)}-${String(al.data).padStart(5, '0')}`
      paymentId = `pay${now.getTime().toString(36)}${rand(3)}`
    }

    // ยืนยันอัตโนมัติ: เปิดไว้ และวันนัดรับห่างจากวันนี้อย่างน้อยตามจำนวนวันที่ตั้ง (นัดน้อยกว่า → รอพนักงานยืนยัน)
    const daysLeft = daysUntilPickup(d.pickupAt, now.getTime())
    const autoConfirm = cfg.autoConfirm.enabled && daysLeft !== null && daysLeft >= cfg.autoConfirm.days && req !== null
    const nowIso = now.toISOString()
    const built = buildSlipPayment({
      id: paymentId, code, amount: fields?.amount ?? plan.amount, slipRef: stagedRef, slipKey: key,
      paidAt: fields?.paidAt ?? paidAtFromMessage(msgAt, d.createdAt, now.getTime()), nowIso,
      bankCode, bankName, ref, shopRef: fields?.shopRef, merchantMismatch: flagged,
    })
    // ยืนยันอัตโนมัติ: งวดนี้ยืนยันทันที และยกเลิกยอดที่ร้านแจ้งไว้เดิมซึ่งยังรออยู่ของออร์เดอร์นี้ (ยอดที่ลูกค้าแจ้งเองไม่ถึงขั้นนี้ เพราะกันด้วย pending_exists)
    // งวดที่ลูกค้าขอ QR ไว้รับสลิปนี้: รวมข้อมูลสลิปเข้ากับงวดเดิม (ไม่เพิ่มงวดซ้ำ) · ไม่มี → เพิ่มงวดใหม่
    const attached = req ? { ...req, ...built, source: req.source, requested: req.requested ?? built.requested, reportedBy: req.reportedBy ?? built.reportedBy, createdAt: req.createdAt ?? built.createdAt, dueAt: req.dueAt ?? built.dueAt, extension: req.extension ?? null, qrRef: req.qrRef } : built
    const list = req ? payments.map((p: any) => (p.id === req.id ? attached : p)) : [...payments, built]
    const conf = autoConfirm ? confirmSlipPayment(list, attached.id, nowIso) : { payments: list, cancelled: [] as any[] }
    const cancelledReqs = conf.cancelled
    const next = {
      ...d,
      payments: conf.payments,
      history: [
        ...(Array.isArray(d.history) ? d.history : []),
        { at: nowIso, text: autoConfirm ? 'ลูกค้าส่งสลิปในแชท (QR) · ระบบจับคู่กับออร์เดอร์นี้อัตโนมัติ' : 'ลูกค้าส่งสลิปในแชท (QR) · ระบบจับคู่กับออร์เดอร์นี้อัตโนมัติ (รอตรวจยอด)', by: 'customer' },
        ...(autoConfirm ? [{ at: nowIso, text: `ยืนยันชำระอัตโนมัติ (ครบ 5 ข้อ · นัดรับห่าง ${daysLeft} วัน · ยังไม่ได้ตรวจกับธนาคาร)`, by: 'auto' }] : []),
        ...(cancelledReqs.length ? [{ at: nowIso, text: `ยกเลิกยอดที่แจ้งเดิม ${cancelledReqs.length} รายการ (${cancelledReqs.map((p: any) => (Number(p.amount) || 0).toFixed(2)).join(', ')}) เพราะยืนยันชำระอัตโนมัติแล้ว`, by: 'auto' }] : []),
      ],
    }
    // ยืนยันแล้ว → ออร์เดอร์เป็นยืนยันชำระ (เหมือนพนักงานยืนยันจากหน้าชำระเงิน) · ไม่ยืนยัน → สถานะเดิม
    const status = autoConfirm
      ? (['awaiting_payment', 'payment_reported'].includes(row.status) ? 'payment_confirmed' : row.status)
      : (row.status === 'awaiting_payment' ? 'payment_reported' : row.status)
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
      const bellText = autoConfirm
        ? `${orderNo(row.code)} · ยอด ${shownAmount.toFixed(2)} (ยืนยันอัตโนมัติแล้ว · ยังไม่ได้ตรวจกับธนาคาร · นัดรับห่าง ${daysLeft} วัน${cancelledReqs.length ? ` · ยกเลิกยอดที่แจ้งเดิม ${cancelledReqs.length} รายการ` : ''})${mismatchNote}`
        : `${orderNo(row.code)} · ยอด ${shownAmount.toFixed(2)} (${how})${mismatchNote}`
      await bell(sb, { event: 'team_customer_paid', title: autoConfirm ? 'ยืนยันชำระอัตโนมัติแล้ว' : 'ลูกค้าแจ้งโอน', text: bellText, orderId: row.id, chatId }, rand)
      await annotate(sb, chatId, msgId, { status: 'matched', ...(autoConfirm ? { autoConfirmed: true } : {}), orderCode: row.code, paymentId, at: nowIso, ...flagPart, checks })
      return 'matched'
    }
    // เขียนชน (พนักงานแก้ออร์เดอร์พร้อมกัน) → อ่านใหม่แล้วทำซ้ำ
  }
  await discardStaged()
  return finish('busy', undefined, orderId ?? undefined)
}
