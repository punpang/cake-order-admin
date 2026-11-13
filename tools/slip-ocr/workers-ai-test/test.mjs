// ทดสอบความแม่นของ Workers AI (โมเดลอ่านภาพ) กับสลิปตัวอย่างที่มีป้ายกำกับ · รันบนเครื่องของคุณเองเท่านั้น
// ใช้: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node test.mjs <โฟลเดอร์ที่มี labels.json และรูป>
// token อยู่ในตัวแปรแวดล้อมของเครื่องนี้เท่านั้น สคริปต์ไม่พิมพ์และไม่บันทึกค่านี้
// ผลที่พิมพ์มีแค่ยอดเงินและวัน-เวลาที่โมเดลอ่านได้ ไม่พิมพ์ชื่อหรือเลขบัญชี
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const dir = process.argv[2]
const account = process.env.CLOUDFLARE_ACCOUNT_ID || ''
const token = process.env.CLOUDFLARE_API_TOKEN || ''
const model = process.env.WAI_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct'
const base = process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4'
if (!dir || !account || !token) {
  console.error('ต้องระบุโฟลเดอร์ และตั้ง CLOUDFLARE_ACCOUNT_ID กับ CLOUDFLARE_API_TOKEN')
  process.exit(2)
}

const PROMPT = [
  'ภาพนี้คือสลิปโอนเงินของธนาคารหรือแอปในประเทศไทย อ่านเฉพาะตัวหนังสือในภาพ',
  'ตอบเป็น JSON อย่างเดียว รูปแบบ {"amount": ตัวเลขบาท ไม่มีคอมมา, "datetime": "YYYY-MM-DDTHH:mm"}',
  'amount คือจำนวนเงินที่โอน ไม่ใช่ค่าธรรมเนียมหรือยอดคงเหลือ',
  'datetime คือวันและเวลาที่ทำรายการ ปีพุทธศักราชให้ลบ 543 เวลาเป็นเวลาไทย',
  'ค่าใดอ่านไม่ได้ให้ใส่ null ห้ามเดา',
].join('\n')

// ดึง JSON จากข้อความตอบ (โมเดลอาจแถมคำอธิบาย)
function parseReply(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return { amount: null, datetime: null }
  try {
    const o = JSON.parse(text.slice(s, e + 1))
    const amount = typeof o.amount === 'number' ? o.amount : Number(String(o.amount ?? '').replace(/,/g, '')) || null
    const dt = typeof o.datetime === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o.datetime) ? o.datetime : null
    return { amount, datetime: dt }
  } catch {
    return { amount: null, datetime: null }
  }
}

async function ask(bytes) {
  const url = `${base}/accounts/${account}/ai/v1/chat/completions`
  const body = {
    model,
    max_tokens: 200,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` } },
        { type: 'text', text: PROMPT },
      ],
    }],
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const raw = await res.text()
  if (!res.ok) return { error: `HTTP ${res.status}: ${raw.slice(0, 160).replace(/\s+/g, ' ')}` }
  const data = JSON.parse(raw)
  const text = data?.choices?.[0]?.message?.content ?? ''
  return { ...parseReply(String(text)) }
}

const labels = JSON.parse(await readFile(join(dir, 'labels.json'), 'utf8'))
const files = Object.keys(labels).filter((f) => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')).sort()
let amountOk = 0, dateOk = 0, errors = 0
for (const f of files) {
  const t0 = Date.now()
  const bytes = await readFile(join(dir, f))
  const r = await ask(bytes)
  const L = labels[f]
  if (r.error) {
    errors++
    console.log(`${f}: ERROR ${r.error}`)
    continue
  }
  const a = r.amount === L.amount, d = r.datetime === L.paidAt
  if (a) amountOk++
  if (d) dateOk++
  console.log(`${f}: amount ${a ? 'OK ' : 'NG '}(${r.amount} / ถูก ${L.amount}) datetime ${d ? 'OK ' : 'NG '}(${r.datetime} / ถูก ${L.paidAt}) ${Date.now() - t0}ms`)
}
const n = files.length
console.log(`\nสรุป: ยอดเงิน ${amountOk}/${n} · วัน-เวลา ${dateOk}/${n} · ข้อผิดพลาดการเรียก ${errors}/${n}`)
