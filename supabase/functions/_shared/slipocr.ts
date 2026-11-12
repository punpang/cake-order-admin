// อ่านยอดเงิน วัน-เวลาทำรายการ ชื่อผู้รับโอน และเลขที่บัญชีผู้รับโอน จากภาพสลิป ด้วยโมเดล Claude (vision) · ทำงานเฉพาะเมื่อร้านเปิดไว้ (config slipQr.ocr.enabled)
// QR บนสลิปไม่มียอดเงินและเวลา จึงต้องอ่านจากตัวหนังสือบนภาพ · ผลเป็น "ค่าที่อ่านได้" ยังไม่ใช่ยอดที่ธนาคารยืนยัน
// ส่งเฉพาะรูปสลิปไปยัง API (ไม่ส่งข้อมูลลูกค้า/ออร์เดอร์) · คีย์ API รับเป็นพารามิเตอร์ ไม่เขียนลง log
// ไม่อ่าน Deno.env ที่นี่ เพื่อให้ทดสอบด้วยตัวจำลอง fetch ได้
import { imageSize } from './qrimage.ts'

// paidAt = "YYYY-MM-DDTHH:mm" เวลาไทย (รูปแบบเดียวกับวันชำระในระบบ) · receiverAccount = ตามที่เห็นบนสลิป (มักถูกปิดบางหลัก เช่น xxx-x-x1234-x)
export type SlipFields = { amount: number | null; paidAt: string | null; receiverName?: string | null; receiverAccount?: string | null }

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
  'ค่าใดไม่เห็นในภาพ หรืออ่านได้ไม่ชัดพอจะมั่นใจ ให้ใส่ null ห้ามเดา',
  'ตอบเป็น JSON อย่างเดียว เช่น {"amount": 178, "datetime": "2026-11-11T14:48", "receiver_name": "นาย ตัวอย่าง ใจดี", "receiver_account": "xxx-x-x1234-x"}',
].join('\n')

// โครงคำตอบ (structured outputs): บังคับให้คำตอบเป็น JSON ตามนี้เสมอ
const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { amount: nullable('number'), datetime: nullable('string'), receiver_name: nullable('string'), receiver_account: nullable('string') },
  required: ['amount', 'datetime', 'receiver_name', 'receiver_account'],
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
  return { amount, paidAt, receiverName, receiverAccount }
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
