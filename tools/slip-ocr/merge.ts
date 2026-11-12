// รวมผลการอ่าน 3 รอบของ ocr.sh เป็น JSON · ใช้: deno run --allow-read tools/slip-ocr/merge.ts <โฟลเดอร์ผลลัพธ์> [ชื่อบัญชีที่รู้ ...]
import { mergeSlipTexts, matchKnownName } from '../../supabase/functions/_shared/slipText.ts'
const [dir, ...known] = Deno.args
const texts = await Promise.all(['pass1', 'pass2', 'pass3'].map((p) => Deno.readTextFile(`${dir}/${p}.txt`).catch(() => '')))
const r = mergeSlipTexts(texts)
console.log(JSON.stringify({ ...r, receiverNameMatched: matchKnownName(r.receiverName, known) }))
