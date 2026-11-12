// บริการอ่านสลิปด้วย Tesseract (รันบนเครื่องของร้าน เปิดออกอินเทอร์เน็ตผ่าน Cloudflare Tunnel)
// รับรูปสลิป (JPEG/PNG) → อ่าน 3 รอบด้วย ocr.sh → คืนยอด วัน-เวลา ผู้รับ เลขบัญชี เป็น JSON
// ป้องกันด้วยโทเคนใน SLIP_OCR_TOKEN (ไม่มีโทเคน = ปิดบริการ) · จำกัดขนาดรูป · ไม่เก็บรูปหลังอ่านเสร็จ
// รัน: SLIP_OCR_TOKEN=... deno run --allow-run --allow-read --allow-write --allow-env --allow-net tools/slip-ocr/service.ts
import { mergeSlipTexts } from '../../supabase/functions/_shared/slipText.ts'

export const MAX_BYTES = 6 * 1024 * 1024

export function isImage(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  return null
}

// เทียบโทเคนแบบไม่ขึ้นกับตำแหน่งที่ต่างกัน (กันการเดาทีละตัว)
export function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

// ตัวจัดการคำขอ · run = ฟังก์ชันอ่านภาพ (แยกออกเพื่อทดสอบได้)
export async function handle(req: Request, token: string, run: (bytes: Uint8Array) => Promise<unknown>): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (!token) return json({ error: 'service disabled' }, 503)
  const auth = req.headers.get('authorization') || ''
  if (!sameToken(auth, `Bearer ${token}`)) return json({ error: 'unauthorized' }, 401)
  const len = Number(req.headers.get('content-length') || '0')
  if (len > MAX_BYTES) return json({ error: 'too large' }, 413)
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return json({ error: 'bad size' }, 413)
  if (!isImage(bytes)) return json({ error: 'unsupported type' }, 415)
  try {
    return json(await run(bytes))
  } catch {
    return json({ error: 'ocr failed' }, 502)
  }
}

// อ่านจริง: เขียนรูปลงโฟลเดอร์ชั่วคราว เรียก ocr.sh แล้วรวมผล · ลบโฟลเดอร์ทิ้งเสมอ
export async function runOcr(bytes: Uint8Array, nowMs = Date.now()): Promise<Record<string, unknown>> {
  const dir = await Deno.makeTempDir({ prefix: 'slip-' })
  try {
    const img = `${dir}/in`
    const out = `${dir}/out`
    await Deno.writeFile(img, bytes)
    await Deno.mkdir(out)
    const script = new URL('./ocr.sh', import.meta.url).pathname
    const r = await new Deno.Command('bash', { args: [script, img, out], stdout: 'null', stderr: 'null' }).output()
    if (!r.success) throw new Error('ocr.sh failed')
    const texts = await Promise.all(['pass1', 'pass2', 'pass3'].map((p) => Deno.readTextFile(`${out}/${p}.txt`).catch(() => '')))
    const s = mergeSlipTexts(texts, nowMs)
    return { amount: s.amount, paidAt: s.paidAt, receiverName: s.receiverName, receiverAccount: s.receiverAccount, review: s.review }
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

if (import.meta.main) {
  const token = (Deno.env.get('SLIP_OCR_TOKEN') || '').trim()
  const port = Number(Deno.env.get('PORT') || '8787')
  Deno.serve({ port, hostname: '127.0.0.1' }, (req) => handle(req, token, (b) => runOcr(b)))
}
