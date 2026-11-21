// ทดสอบจำนวนรายการรอตรวจ (ป้ายบนหน้าตั้งค่า): นับเฉพาะสถานะเปิด · ไม่มีสิทธิ์/ไม่เชื่อมต่อ/ผิดพลาด = 0 · รัน: node src/lib/syncReview.count.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { countOpenReview } = await server.ssrLoadModule('/src/lib/syncReview.js')

// ตัวจำลอง: บันทึกการเรียก select/eq และตอบตามผลที่กำหนด
function fakeCountClient(result) {
  const seen = {}
  const client = {
    seen,
    from(table) {
      seen.table = table
      return {
        select(cols, opts) {
          seen.cols = cols
          seen.opts = opts
          return { eq(col, val) { seen.eq = [col, val]; return Promise.resolve(result) } }
        },
      }
    },
  }
  return client
}

test('นับเฉพาะรายการที่ยังเปิด (นับจากฐานข้อมูลแบบ head ไม่ดึงแถว)', async () => {
  const client = fakeCountClient({ count: 3, error: null })
  assert.equal(await countOpenReview(client), 3)
  assert.equal(client.seen.table, 'punpang_sync_review')
  assert.deepEqual(client.seen.opts, { count: 'exact', head: true })
  assert.deepEqual(client.seen.eq, ['status', 'open'])
})

test('ไม่มีสิทธิ์อ่านคิว (ข้อผิดพลาด) หรือไม่ได้เชื่อมต่อ = 0', async () => {
  assert.equal(await countOpenReview(fakeCountClient({ count: null, error: { message: 'permission denied' } })), 0)
  assert.equal(await countOpenReview(null), 0)
})

test('ข้อยกเว้นระหว่างเรียกฐานข้อมูล = 0 (ไม่ทำให้หน้าตั้งค่าพัง)', async () => {
  const client = { from() { throw new Error('offline') } }
  assert.equal(await countOpenReview(client), 0)
})
