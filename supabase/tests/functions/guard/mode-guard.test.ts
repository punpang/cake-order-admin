// ด่านกันลืม: ทุกฟังก์ชันใน supabase/functions ต้องผ่านการแยกโหมดทดสอบ และฟังก์ชันที่ส่งออกภายนอกต้องมีด่านโหมดทดสอบ
// ถ้าเพิ่มฟังก์ชันใหม่โดยไม่ใส่ด่าน เทสต์นี้จะล้มก่อนถึงโปรดักชัน
// รัน: npm run test:fn
import { assert } from 'jsr:@std/assert@1'

const FN_DIR = new URL('../../../functions/', import.meta.url)

// ฟังก์ชันต้องแยกโหมดด้วยอย่างน้อยหนึ่งอย่าง: ปฏิเสธในโหมดทดสอบ หรือเลือก schema ตามโหมดของคำขอ
const MODE_GUARD = /refuseInTest\(|serviceDb\(|restProfileHeaders\(/
// โค้ดที่ยิงออกไปยังบริการภายนอก (LINE / Telegram / Facebook / FCM / เกตเวย์ SMS)
const OUTBOUND = /api\.line\.me|api\.telegram\.org|graph\.facebook\.com|googleapis\.com|GATEWAY_URL/
// ด่านของการส่งออก: ปฏิเสธในโหมดทดสอบ หรือตรวจผู้รับกับรายชื่อทดสอบ
const SEND_GATE = /refuseInTest\(|recipientAllowed\(/

const dirs: string[] = []
for await (const e of Deno.readDir(FN_DIR)) {
  if (e.isDirectory && e.name !== '_shared') dirs.push(e.name)
}
dirs.sort()

const read = (name: string) => Deno.readTextFile(new URL(`${name}/index.ts`, FN_DIR))

Deno.test('พบ Edge Function อย่างน้อย 20 ฟังก์ชัน และทุกฟังก์ชันมี index.ts', async () => {
  assert(dirs.length >= 20, `พบเพียง ${dirs.length} ฟังก์ชัน`)
  for (const name of dirs) await read(name)
})

Deno.test('ทุกฟังก์ชันผ่านด่านการแยกโหมด (ปฏิเสธในโหมดทดสอบ หรือเลือก schema ตามโหมด)', async () => {
  const missing: string[] = []
  for (const name of dirs) {
    if (!MODE_GUARD.test(await read(name))) missing.push(name)
  }
  assert(missing.length === 0, `ยังไม่มีด่านโหมดทดสอบ: ${missing.join(', ')}`)
})

Deno.test('ฟังก์ชันที่ยิงออกภายนอกทุกตัวมีด่านโหมดทดสอบ (ปฏิเสธหรือตรวจผู้รับ)', async () => {
  const unguarded: string[] = []
  let senders = 0
  for (const name of dirs) {
    const src = await read(name)
    if (!OUTBOUND.test(src)) continue
    senders++
    if (!SEND_GATE.test(src)) unguarded.push(name)
  }
  assert(senders >= 3, `พบฟังก์ชันที่ส่งออกภายนอกเพียง ${senders} ตัว (คาดไว้อย่างน้อย 3)`)
  assert(unguarded.length === 0, `ส่งออกภายนอกโดยไม่มีด่านโหมดทดสอบ: ${unguarded.join(', ')}`)
})
