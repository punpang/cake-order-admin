// อ่านยอดเงิน วัน-เวลาทำรายการ ชื่อผู้รับโอน และเลขที่บัญชีผู้รับโอน จากภาพสลิป ด้วยโมเดล Claude (vision) · ทำงานเฉพาะเมื่อร้านเปิดไว้ (config slipQr.ocr.claude)
// QR บนสลิปไม่มียอดเงินและเวลา จึงต้องอ่านจากตัวหนังสือบนภาพ · ผลเป็น "ค่าที่อ่านได้" ยังไม่ใช่ยอดที่ธนาคารยืนยัน
// ส่งเฉพาะรูปสลิปไปยัง API (ไม่ส่งข้อมูลลูกค้า/ออร์เดอร์) · คีย์ API รับเป็นพารามิเตอร์ ไม่เขียนลง log
// ไม่อ่าน Deno.env ที่นี่ เพื่อให้ทดสอบด้วยตัวจำลอง fetch ได้
import { imageSize } from './qrimage.ts'
import { inferThaiDateTime, parseThaiDateTime } from './slipText.ts'
import { readShopFields } from './slipref.ts'

// paidAt = "YYYY-MM-DDTHH:mm" เวลาไทย (รูปแบบเดียวกับวันชำระในระบบ) · receiverAccount = ตามที่เห็นบนสลิป (มักถูกปิดบางหลัก เช่น xxx-x-x1234-x)
export type SlipFields = { amount: number | null; paidAt: string | null; receiverName?: string | null; receiverAccount?: string | null; merchantCode?: string; shopRef?: string; qrRef?: string }

export const OCR_DEFAULT_MODEL = 'claude-sonnet-5-5'
const TIMEOUT_MS = 30_000
const MAX_TOKENS = 4000 // เผื่อโทเคนที่โมเดลใช้คิดก่อนตอบ (เดิม 100 ทำให้คำตอบถูกตัดกลางทาง)
const MAX_AMOUNT = 10_000_000

const PROMPT = [
  'ภาพนี้คือสลิปโอนเงินของธนาคารหรือแอปกระเป๋าเงินในประเทศไทย (ข้อความอาจเป็นภาษาไทยหรืออังกฤษ) อ่านตัวหนังสือทุกส่วนของภาพอย่างละเอียดก่อน แล้วแยกค่าต่อไปนี้',
  '1) amount: จำนวนเงินที่โอน (ป้าย "จำนวนเงิน" / "จำนวน" / "Amount") เป็นตัวเลขบาท ไม่มีคอมมา ไม่มีสกุลเงิน · ไม่ใช่ค่าธรรมเนียม (Fee) และไม่ใช่ยอดคงเหลือ',
  '2) datetime: วันและเวลาที่ทำรายการ รูปแบบ "YYYY-MM-DDTHH:mm" เวลาไทย ปีคริสต์ศักราช · ปีพุทธศักราชให้ลบ 543 (ปี 2 หลักเช่น 69 คือ พ.ศ. 2569 = ค.ศ. 2026) · เดือนอาจเป็นตัวย่อไทย (ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.) หรืออังกฤษ',
  '3) receiver_name: ชื่อผู้รับโอน (ฝั่ง "ไปยัง" / "ถึง" / "To" / "ผู้รับ" — ปกติอยู่ส่วนล่างถัดจากผู้โอน) คัดลอกตามที่เห็น รวมคำนำหน้า ไม่ใช่ชื่อผู้โอน และไม่ใช่ชื่อธนาคาร',
  '4) receiver_account: เลขที่บัญชี / หมายเลขพร้อมเพย์ / เลข e-Wallet ของผู้รับโอน คัดลอกตามที่เห็นทุกตัวอักษร รวมตัวที่ถูกปิด (x, X, *) และขีด เช่น "xxx-x-x1234-x" · ไม่ใช่บัญชีผู้โอน และไม่ใช่รหัสอ้างอิง',
  '5) merchant_code (Ref 1): รหัสร้านค้าผู้รับชำระ (ป้าย "รหัสร้านค้า" / "Ref 1" / "Company code" / "Merchant code") เป็นตัวเลขยาว คัดลอกทุกหลักตามที่เห็น · ไม่ใช่เลขบัญชีและไม่ใช่เลขอ้างอิง · ถ้าค่าใต้ป้ายนี้ขึ้นต้นด้วย POS หรือ ORD ให้ใส่ null (เป็นรหัสอ้างอิง ไม่ใช่รหัสร้านค้า)',
  '6) shop_ref (Ref 2): ค่าที่ขึ้นต้นด้วย POS หรือ ORD ตามด้วยตัวเลข (อาจมีรหัสสุ่ม 5 ตัวต่อท้าย) อยู่ใต้ป้ายใดก็ได้ (เช่น "Ref 2" / "รหัสอ้างอิงร้านค้า") คัดลอกทั้งหมดตามที่เห็น · POS/ORD ห้ามใส่ใน merchant_code · ไม่ใช่เลขอ้างอิงของธนาคาร',
  'ค่าใดไม่เห็นในภาพ หรืออ่านได้ไม่ชัดพอจะมั่นใจ ให้ใส่ null ห้ามเดา',
  'ตอบเป็น JSON อย่างเดียว เช่น {"amount": 178, "datetime": "2026-11-11T14:48", "receiver_name": "นาย ตัวอย่าง ใจดี", "receiver_account": "xxx-x-x1234-x", "merchant_code": null, "shop_ref": null}',
].join('\n')

// โครงคำตอบ (structured outputs): บังคับให้คำตอบเป็น JSON ตามนี้เสมอ
const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { amount: nullable('number'), datetime: nullable('string'), receiver_name: nullable('string'), receiver_account: nullable('string'), merchant_code: nullable('string'), shop_ref: nullable('string') },
  required: ['amount', 'datetime', 'receiver_name', 'receiver_account', 'merchant_code', 'shop_ref'],
  additionalProperties: false,
}
const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

// อ่านค่าจากข้อความตอบของโมเดล · ค่าที่ผิดรูปแบบถูกทิ้งเป็น null ทั้งฟิลด์
export function parseSlipFields(text: string, nowMs = Date.now()): SlipFields {
  const empty: SlipFields = { amount: null, paidAt: null, receiverName: null, receiverAccount: null }
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return empty
  let obj: any
  try { obj = JSON.parse(text.slice(s, e + 1)) } catch { return empty }

  let amount: number | null = null
  const rawAmount = typeof obj?.amount === 'string' ? Number(obj.amount.replace(/,/g, '')) : obj?.amount
  if (typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount > 0 && rawAmount <= MAX_AMOUNT) {
    amount = Math.round(rawAmount * 100) / 100
  }

  let paidAt: string | null = null
  const m = typeof obj?.datetime === 'string' ? obj.datetime.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/) : null
  if (m) {
    const [y, mo, d, h, mi] = m.slice(1).map(Number)
    const dt = new Date(Date.UTC(y, mo - 1, d, h, mi))
    const okDate = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60
    // กันปีที่ผิดชัดเจน: ไม่ย้อนหลังเกิน 2 ปี และไม่เกินพรุ่งนี้
    const nowYear = new Date(nowMs).getUTCFullYear()
    if (okDate && y >= nowYear - 2 && y <= nowYear + 1) paidAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`
  }
  const receiverName = cleanText(obj?.receiver_name, 100) || null
  // เลขบัญชี: เก็บเฉพาะตัวเลข ตัวปิด (x, X, *) ขีด และช่องว่าง · ต้องมีตัวเลขอย่างน้อย 3 ตัว
  const acc = cleanText(obj?.receiver_account, 40).replace(/[^0-9xX*\- ]/g, '').trim()
  const receiverAccount = (acc.match(/\d/g) || []).length >= 3 ? acc : null
  return { amount, paidAt, receiverName, receiverAccount, ...readShopFields(obj, receiverAccount) }
}

const toBase64 = (b: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(bin)
}

// เรียก Messages API พร้อมรูปสลิป · ล้มเหลว/หมดเวลา/ผิดรูปแบบ = null (ระบบจะใช้ค่าเดิมต่อไป)
export async function readSlipFields(o: { bytes: Uint8Array; key: string; model: string; nowMs?: number; fetchImpl?: typeof fetch }): Promise<SlipFields | null> {
  if (!o.key) return null
  const kind = imageSize(o.bytes)?.type === 'png' ? 'image/png' : 'image/jpeg'
  const doFetch = o.fetchImpl ?? fetch
  // structured = บังคับคำตอบเป็น JSON ตามโครง + ให้โมเดลคิดระดับกลาง · รุ่นที่ไม่รองรับ (400) → ลองใหม่แบบเดิมที่สั่งรูปแบบในข้อความอย่างเดียว
  const call = (structured: boolean) => doFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': o.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: o.model || OCR_DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      ...(structured ? { output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } } } : {}),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: kind, data: toBase64(o.bytes) } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  try {
    let res = await call(true)
    if (res.status === 400) res = await call(false)
    if (!res.ok) return null
    const data: any = await res.json()
    if (data?.stop_reason === 'refusal') return null
    const text = (Array.isArray(data?.content) ? data.content : []).filter((x: any) => x?.type === 'text').map((x: any) => String(x.text ?? '')).join('')
    return parseSlipFields(text, o.nowMs)
  } catch {
    return null
  }
}

// อ่านด้วย Workers AI (โมเดลอ่านภาพของ Cloudflare) · โมเดลคัดลอกข้อความวันที่ตามที่เห็น แล้วโค้ดของเราแปลงเป็นวัน-เวลา
// ส่งรูปสลิปเต็มไป Cloudflare ตามที่ร้านอนุมัติ (มีชื่อและเลขบัญชีในรูป) · ผิดพลาด/หมดเวลา = null
export const WAI_DEFAULT_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'
const WAI_PROMPT = [
  'ภาพนี้คือสลิปโอนเงินของธนาคารหรือแอปในประเทศไทย อ่านเฉพาะตัวหนังสือในภาพ',
  'ตอบเป็น JSON อย่างเดียว รูปแบบ {"amount": ตัวเลขบาท ใช้จุดเป็นทศนิยม ไม่มีคอมมา, "date_text": "ข้อความวันที่และเวลาตามที่เห็น", "receiver_account": "เลขบัญชีหรือพร้อมเพย์ของผู้รับ ที่อยู่ใต้ป้ายไปยัง/ไปที่/To หรือ null", "sender_account": "เลขบัญชีหรือเลขพร้อมเพย์ของผู้โอนตามที่เห็น", "merchant_code": "ตัวเลขหลังป้ายรหัสร้านค้าเท่านั้น หรือ null", "shop_ref": "ค่าที่ขึ้นต้นด้วย POS หรือ ORD หรือ null"}',
  'ผู้รับคือฝั่งที่มีป้าย "ไปยัง" "ไปที่" หรือ "To" ผู้โอนคือฝั่งที่มีป้าย "จาก" หรือ "From"',
  'ให้ยึดป้ายกำกับเป็นหลัก ห้ามเดาจากตำแหน่งบนหรือล่างของสลิป',
  'ห้ามสลับค่า: รหัสร้านค้า (merchant_code) ไม่ใช่เลขบัญชี · เลขบัญชีผู้รับ (receiver_account) ไม่ใช่รหัสร้านค้า · รหัสอ้างอิงร้านค้า (shop_ref) ไม่ใช่รหัสร้านค้า',
  'merchant_code ใช้เฉพาะตัวเลขที่อยู่หลังป้าย "รหัสร้านค้า" "Company code" หรือ "Merchant code" คัดลอกทุกหลักตามที่เห็น ห้ามดึงตัวเลขจากรหัสอ้างอิง รหัส POS/ORD หรือ Biller ID',
  'merchant_code อ่านทีละหลักจากซ้ายไปขวา นับจำนวนหลักให้ครบก่อนตอบ ห้ามตัด ห้ามข้ามหลัก และห้ามเติมหรือเดาเลขที่มองไม่ชัด (เช่น 0 ที่อยู่ติดกัน) ถ้าอ่านไม่ครบทุกหลักหรือไม่แน่ใจ ให้ใส่ null',
  'receiver_account ห้ามคัดลอกค่าที่อยู่หลังป้าย "รหัสร้านค้า" "Biller ID" "รหัสอ้างอิง" "หมายเลขอ้างอิง" หรือ "เลขที่รายการ" ถ้าไม่มีเลขบัญชีหรือพร้อมเพย์ใต้ป้ายผู้รับ ให้ใส่ null',
  'shop_ref คือค่าที่ขึ้นต้นด้วย POS หรือ ORD ตามด้วยตัวเลข อยู่ใต้ป้ายใดก็ได้ คัดลอกพร้อมคำนำหน้า ห้ามแปลงเป็นตัวเลขล้วน · อาจมีรหัสสุ่ม 5 ตัวต่อท้ายให้คัดลอกทั้งหมด · POS/ORD เป็น shop_ref (Ref 2) เท่านั้น ห้ามใส่ใน merchant_code',
  'amount คือจำนวนเงินหลักของรายการ (ตัวเลขใหญ่ หรือ "ยอดเงินที่ชำระ") ไม่ใช่ค่าธรรมเนียม ดอกเบี้ย หรือยอดคงเหลือ',
  'date_text คัดลอกตามที่เห็น ห้ามแปลงปีหรือเดือนเอง',
  'ตัวเลขที่ถูกปิดแสดงเป็นจุด • ให้คงจุดไว้ตามจำนวนที่เห็น เช่น "••• ••• 5562" ตอบ "••••••5562" และไม่แปลงจุดเป็น x',
  'ค่าใดอ่านไม่ได้ให้ใส่ null ห้ามเดา',
].join('\n')

export async function readSlipFieldsWorkersAI(o: { bytes: Uint8Array; accountId: string; token: string; model?: string; nowMs?: number; fetchImpl?: typeof fetch }): Promise<SlipFields | null> {
  if (!o.accountId || !o.token) return null
  const doFetch = o.fetchImpl ?? fetch
  const type = o.bytes[0] === 0x89 ? 'image/png' : 'image/jpeg'
  const dataUrl = `data:${type};base64,${toBase64(o.bytes)}`
  try {
    const res = await doFetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(o.accountId)}/ai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: o.model || WAI_DEFAULT_MODEL,
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: WAI_PROMPT }] }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const text = String(data?.choices?.[0]?.message?.content ?? '')
    const s = text.indexOf('{'), e = text.lastIndexOf('}')
    if (s < 0 || e <= s) return null
    const j = JSON.parse(text.slice(s, e + 1))
    const rawAmount = typeof j?.amount === 'string' ? Number(j.amount.replace(/,/g, '')) : j?.amount
    const amount = typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount > 0 && rawAmount <= MAX_AMOUNT ? Math.round(rawAmount * 100) / 100 : null
    const dateText = typeof j?.date_text === 'string' ? j.date_text.slice(0, 80) : ''
    const paidAt = dateText ? (parseThaiDateTime(dateText) ?? inferThaiDateTime(dateText, o.nowMs ?? Date.now())) : null
    // ผู้รับจากป้าย "ไปยัง/ไปที่/To" ที่โมเดลระบุ (ไม่เดาจากตำแหน่งบนล่าง) · ต้องมีตัวเลขอย่างน้อยหนึ่งตัว
    const rv = typeof j?.receiver_account === 'string' ? j.receiver_account.trim() : ''
    const receiverAccount = /\d/.test(rv) ? rv.slice(0, 40) : null
    return { amount, paidAt, receiverName: null, receiverAccount, ...readShopFields(j, receiverAccount) }
  } catch {
    return null
  }
}

// ---------- ลำดับอ่านยอดและวัน-เวลาจากภาพสลิป (ใช้ทั้งสลิปในแชทและหน้าสั่งของลูกค้า) ----------
// ทำหลัง QR พบว่าเป็นสลิปธนาคารแล้วเท่านั้น · ตัวแรกที่ได้ยอดหรือวัน-เวลาจะหยุด · ผลว่างหรือ error ไปตัวถัดไป
// ไม่มีตัวไหนได้ผลครบ → ใช้ผลบางส่วนของตัวแรกที่ตอบ
export type OcrEngine = { name: string; read: (bytes: Uint8Array) => Promise<SlipFields | null> }
// status.errored = true เมื่อมีตัวอ่านที่ผิดพลาดหรือไม่ตอบ (null) · ใช้ตัดสินว่าผลที่ได้ควรจำไว้ใช้ซ้ำหรือไม่
// อ่านทุกตัวที่เปิดอยู่ · ยอด/วัน-เวลาเอาจากตัวแรกที่ได้ค่า (เหมือนเดิม)
// รหัสร้านค้าใช้ค่าเฉพาะเมื่อตัวอ่านอิสระอย่างน้อย 2 ตัวได้ค่าเดียวกัน · ไม่ตรงกันหรือมีตัวเดียว = ไม่ใช้ค่า (ให้พนักงานตรวจ)
export async function readSlipFieldsChain(bytes: Uint8Array, engines: OcrEngine[], status?: { errored: boolean }): Promise<SlipFields | null> {
  let partial: SlipFields | null = null
  let main: SlipFields | null = null
  const codes: string[] = []
  for (const e of engines) {
    let f: SlipFields | null = null
    try { f = await e.read(bytes) } catch { f = null }
    if (f == null && status) status.errored = true
    if (f?.merchantCode) codes.push(f.merchantCode)
    if (main == null && (f?.amount != null || f?.paidAt != null)) main = f
    partial ??= f
  }
  const base = main ?? partial
  if (!base) return null
  const { merchantCode: _unverified, ...rest } = base
  const agreed = codes.length >= 2 && codes.every((c) => c === codes[0]) ? codes[0] : null
  return agreed ? { ...rest, merchantCode: agreed } : rest
}

// ค่าสวิตช์จาก punpang_kv config slipQr.ocr: wai (Workers AI) · claude (ระบบเดิม) · ค่าเดิม ocr.enabled = claude เมื่อยังไม่มี claude
// model ไม่ระบุ = OCR_DEFAULT_MODEL
export function ocrFlagsOf(ocr: any): { wai: boolean; claude: boolean; model: string } {
  const claude = ocr?.claude !== undefined ? ocr.claude === true : ocr?.enabled === true
  const model = typeof ocr?.model === 'string' && ocr.model.trim() ? ocr.model.trim() : OCR_DEFAULT_MODEL
  return { wai: ocr?.wai === true, claude, model }
}
