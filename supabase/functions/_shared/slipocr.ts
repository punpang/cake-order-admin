// อ่านยอดเงินและวัน-เวลาทำรายการจากภาพสลิป ด้วยโมเดล Claude (vision) · ทำงานเฉพาะเมื่อร้านเปิดไว้ (config slipQr.ocr.enabled)
// QR บนสลิปไม่มียอดเงินและเวลา จึงต้องอ่านจากตัวหนังสือบนภาพ · ผลเป็น "ค่าที่อ่านได้" ยังไม่ใช่ยอดที่ธนาคารยืนยัน
// ส่งเฉพาะรูปสลิปไปยัง API (ไม่ส่งข้อมูลลูกค้า/ออร์เดอร์) · คีย์ API รับเป็นพารามิเตอร์ ไม่เขียนลง log
// ไม่อ่าน Deno.env ที่นี่ เพื่อให้ทดสอบด้วยตัวจำลอง fetch ได้
import { imageSize } from './qrimage.ts'

export type SlipFields = { amount: number | null; paidAt: string | null } // paidAt = "YYYY-MM-DDTHH:mm" เวลาไทย (รูปแบบเดียวกับวันชำระในระบบ)

export const OCR_DEFAULT_MODEL = 'claude-sonnet-5-5'
const TIMEOUT_MS = 20_000
const MAX_AMOUNT = 10_000_000

const PROMPT = [
  'ภาพนี้คือสลิปโอนเงินของธนาคารไทย ให้อ่านเฉพาะตัวหนังสือที่เห็นในภาพ',
  '1) amount: ยอดเงินที่โอน เป็นตัวเลขบาท (ไม่มีคอมมา ไม่มีสกุลเงิน) ถ้าอ่านไม่ชัดให้ใส่ null',
  '2) datetime: วันและเวลาที่ทำรายการ รูปแบบ "YYYY-MM-DDTHH:mm" ปีคริสต์ศักราช (ถ้าเป็นปีพุทธศักราชให้ลบ 543) เวลาไทย ถ้าอ่านไม่ชัดให้ใส่ null',
  'ตอบเป็น JSON อย่างเดียว เช่น {"amount": 178, "datetime": "2026-11-11T14:48"} ห้ามเดาค่าที่ไม่เห็นในภาพ',
].join('\n')

// อ่านค่าจากข้อความตอบของโมเดล · ค่าที่ผิดรูปแบบถูกทิ้งเป็น null ทั้งฟิลด์
export function parseSlipFields(text: string, nowMs = Date.now()): SlipFields {
  const empty: SlipFields = { amount: null, paidAt: null }
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
  return { amount, paidAt }
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
  try {
    const res = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': o.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: o.model || OCR_DEFAULT_MODEL,
        max_tokens: 100,
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
    if (!res.ok) return null
    const data: any = await res.json()
    const text = (Array.isArray(data?.content) ? data.content : []).filter((x: any) => x?.type === 'text').map((x: any) => String(x.text ?? '')).join('')
    return parseSlipFields(text, o.nowMs)
  } catch {
    return null
  }
}
