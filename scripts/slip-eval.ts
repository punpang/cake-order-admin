// วัดความแม่นของรหัสร้านค้า (Ref 1) ที่ Workers AI อ่านจากภาพสลิป · เกณฑ์ผ่าน ≥ 90%
// รัน: CF_ACCOUNT_ID=... CF_API_TOKEN=... deno run -A scripts/slip-eval.ts <โฟลเดอร์ชุดทดสอบ> [--model <ชื่อโมเดล>]
// โฟลเดอร์ชุดทดสอบ (นอกรีโป · ไม่ commit เพราะมีข้อมูลส่วนตัวบนสลิป) ต้องมี expected.json:
//   { "สลิป1.jpg": "014000000517185", "สลิป2.png": "014000000517185" }
// ค่าที่เทียบ = ตัวเลขล้วนของรหัสร้านค้า · อ่านไม่ได้นับเป็นผิด · ใช้ตัวอ่านเดียวกับระบบจริง (readSlipFieldsWorkersAI)
import { readSlipFieldsWorkersAI, WAI_DEFAULT_MODEL } from '../supabase/functions/_shared/slipocr.ts'

const THRESHOLD = 0.9
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

const dir = Deno.args.find((a) => !a.startsWith('--'))
if (!dir) {
  console.error('ใช้: deno run -A scripts/slip-eval.ts <โฟลเดอร์ชุดทดสอบ> [--model <ชื่อโมเดล>]')
  Deno.exit(2)
}
const accountId = Deno.env.get('CF_ACCOUNT_ID') ?? ''
const token = Deno.env.get('CF_API_TOKEN') ?? ''
if (!accountId || !token) {
  console.error('ต้องตั้ง CF_ACCOUNT_ID และ CF_API_TOKEN')
  Deno.exit(2)
}
const modelArg = Deno.args.indexOf('--model')
const model = modelArg >= 0 ? Deno.args[modelArg + 1] : (Deno.env.get('WAI_MODEL') ?? WAI_DEFAULT_MODEL)

const expected: Record<string, string> = JSON.parse(await Deno.readTextFile(`${dir}/expected.json`))
const files = Object.keys(expected).sort()
if (!files.length) {
  console.error('expected.json ว่าง')
  Deno.exit(2)
}

let ok = 0
for (const file of files) {
  const bytes = new Uint8Array(await Deno.readFile(`${dir}/${file}`))
  const fields = await readSlipFieldsWorkersAI({ bytes, accountId, token, model })
  const want = digits(expected[file])
  const got = digits(fields?.merchantCode)
  const pass = got === want
  if (pass) ok++
  console.log(`${pass ? 'OK ' : 'NG '} ${file}  เฉลย=${want}  อ่านได้=${got || '(ว่าง)'}`)
}

const rate = ok / files.length
console.log(`\nโมเดล ${model} · ถูก ${ok}/${files.length} = ${(rate * 100).toFixed(1)}% · เกณฑ์ ${THRESHOLD * 100}%`)
Deno.exit(rate >= THRESHOLD ? 0 : 1)
