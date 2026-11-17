// รับแจ้งเตือนการโอนจากแอปส่งต่อ (SMS Gateway) → จับคู่กับ QR หน้าร้าน (POS) ด้วยรหัสธุรกรรม · ฟังก์ชันล้วน ไม่เรียกภายนอก
// ลายเซ็น: X-Gateway-Signature = "sha256=" + HMAC-SHA256(secret, `${ts}.${body}`) เป็นเลขฐานสิบหกตัวพิมพ์เล็ก
// แจ้งเตือนถุงเงินต้องมียอดในข้อความ (เช่น "เงินเข้า 1 บาท") และมีรหัสธุรกรรม ORD/POS (Ref2) ที่อยู่ในข้อความ เช่น "รหัสธุรกรรมถุงเงิน ORD12340272826288288" · จับคู่ต้องตรงทั้งรหัสและยอด (ดู notifyconfirm.ts)

const enc = new TextEncoder()
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// ตรวจลายเซ็นกับ body ดิบทุกไบต์ และตรวจ timestamp ไม่เกิน 5 นาที (วินาที unix)
export async function verifyGatewaySignature(secret: string, ts: string, body: string, sigHeader: string, nowSec: number): Promise<boolean> {
  if (!secret || secret.length < 16 || !/^\d+$/.test(ts)) return false
  if (Math.abs(nowSec - Number(ts)) > 300) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = hexOf(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${body}`)))
  return safeEq(sigHeader, `sha256=${mac}`)
}

// รหัสธุรกรรมที่ระบบสร้าง/แอปส่งต่อ: ขึ้นต้นด้วย ORD หรือ POS ตามด้วยอักขระ 17 ตัว (ตัวพิมพ์ใหญ่หรือเลข)
// ต้องไม่ติดกับตัวอักษรอื่นทั้งก่อนและหลัง
const REF_RE = /(?:^|[^A-Za-z0-9])((?:ORD|POS)[0-9A-Z]{17})(?![0-9A-Za-z])/

// ดึงรหัสธุรกรรมจากข้อความแจ้งเตือน · คืน null ถ้าไม่พบ
export function extractTransferRef(text: string): string | null {
  const m = REF_RE.exec(String(text ?? ''))
  return m ? m[1] : null
}

// ยอดเงินเข้าจากหัวข้อหรือข้อความแจ้งเตือน เช่น "เงินเข้า 1 บาท" หรือ "คุณได้รับเงิน 1.00 บาท" · คืน null ถ้าไม่พบ
const AMOUNT_RE = /(?:เงินเข้า|คุณได้รับเงิน)\s*:?\s*([\d,]+(?:\.\d{1,2})?)\s*บาท/
export function extractAmount(title: string, text: string): number | null {
  const m = AMOUNT_RE.exec(`${String(title ?? '')} ${String(text ?? '')}`)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

// รูปแบบรหัสที่ยอมรับจาก client (ใช้ซ้ำกับตอนค้นหา เพื่อไม่ให้ส่งค่าแปลกเข้าคำค้น)
export function isRefShape(ref: string): boolean {
  return /^(?:ORD|POS)[0-9A-Z]{17}$/.test(ref)
}
