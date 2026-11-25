// ด่านกันหลุด: โค้ดโหมดทดสอบต้องไม่เหลือใน Edge Functions (ลบแล้วในขั้นตอนลบโหมดทดสอบ)
// ถ้ามีคนเพิ่มโค้ดนี้กลับมา เทสต์นี้จะล้ม
// รัน: npm run test:fn
import { assert } from 'jsr:@std/assert@1'

const FN_DIR = new URL('../../../functions/', import.meta.url)
const LEFTOVER = /x-punpang-mode|punpang_test|refuseInTest|restProfileHeaders|_shared\/mode\b/

async function* tsFiles(dir: URL): AsyncGenerator<URL> {
  for await (const e of Deno.readDir(dir)) {
    const url = new URL(e.isDirectory ? `${e.name}/` : e.name, dir)
    if (e.isDirectory) yield* tsFiles(url)
    else if (e.name.endsWith('.ts')) yield url
  }
}

Deno.test('ไม่มีโค้ดโหมดทดสอบเหลือใน supabase/functions', async () => {
  const hits: string[] = []
  let n = 0
  for await (const url of tsFiles(FN_DIR)) {
    n++
    if (LEFTOVER.test(await Deno.readTextFile(url))) hits.push(url.pathname)
  }
  assert(n >= 20, `พบเพียง ${n} ไฟล์`)
  assert(hits.length === 0, hits.join('\n'))
})
