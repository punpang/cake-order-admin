// ทดสอบงานลบรูปสลิปชุดเทรน: ลบไฟล์ก่อนแล้วจึงลบรายการ · ลบไฟล์ไม่ได้ → ไม่ลบรายการชุดนั้น · ลบเฉพาะ slipTrain ที่เก่าเกินกำหนดและไฟล์ใน train/
import { assertEquals } from 'jsr:@std/assert@1'
import { bearerMatches, pruneTrainSlips } from './slipprune.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 13, 3, 40)
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

type Row = { id: string; collection: string; data: any }
function fakeTrainStore(init: { rows: Row[]; files: string[]; failRemove?: boolean; failDelete?: boolean }) {
  const rows: Row[] = [...init.rows]
  const files = new Set(init.files)
  const removeCalls: string[][] = []
  const sb: any = {
    from(_table: string) {
      const q = { op: 'select', filters: [] as Array<(r: Row) => boolean>, lt: null as string | null, inIds: null as string[] | null, limitN: Infinity }
      const matches = (r: Row) => q.filters.every((f) => f(r)) && (q.lt === null || (r.data?.at ?? '') < q.lt)
      const api: any = {
        select() { return api },
        delete() { q.op = 'delete'; return api },
        eq(c: string, v: unknown) { q.filters.push((r: any) => r[c] === v); return api },
        lt(_c: string, v: string) { q.lt = v; return api },
        in(_c: string, ids: string[]) { q.inIds = ids; return api },
        limit(n: number) { q.limitN = n; return api },
        then(resolve: (v: unknown) => void) {
          if (q.op === 'delete') {
            if (init.failDelete) return resolve({ data: null, error: { message: 'boom' } })
            const gone = rows.filter((r) => matches(r) && (q.inIds === null || q.inIds.includes(r.id)))
            for (const g of gone) rows.splice(rows.indexOf(g), 1)
            return resolve({ data: gone.map((g) => ({ id: g.id })), error: null })
          }
          const found = rows.filter(matches).slice(0, q.limitN).map((r) => ({ id: r.id, data: r.data }))
          return resolve({ data: found, error: null })
        },
      }
      return api
    },
    storage: {
      from(_bucket: string) {
        return {
          remove: async (paths: string[]) => {
            removeCalls.push(paths)
            if (init.failRemove) return { data: null, error: { message: 'boom' } }
            for (const p of paths) files.delete(p)
            return { data: paths.map((name) => ({ name })), error: null }
          },
        }
      },
    },
  }
  return { sb, rows, files, removeCalls }
}

Deno.test('ลบรายการ slipTrain ที่เก่าเกิน 30 วันพร้อมไฟล์ และเก็บรายการใหม่กับข้อมูลชนิดอื่นไว้', async () => {
  const s = fakeTrainStore({
    rows: [
      { id: 'a', collection: 'slipTrain', data: { at: ago(31), path: 'train/a.jpg' } },
      { id: 'b', collection: 'slipTrain', data: { at: ago(40), path: 'train/b.png' } },
      { id: 'c', collection: 'slipTrain', data: { at: ago(5), path: 'train/c.jpg' } },
      { id: 'd', collection: 'slipRead', data: { at: ago(40), fields: {} } },
    ],
    files: ['train/a.jpg', 'train/b.png', 'train/c.jpg'],
  })
  const r = await pruneTrainSlips(s.sb, { now: NOW })
  assertEquals(r.ok, true)
  assertEquals([r.records, r.files], [2, 2])
  assertEquals(s.rows.map((x) => x.id).sort(), ['c', 'd'])
  assertEquals([...s.files].sort(), ['train/c.jpg'])
})

Deno.test('ลบไฟล์ไม่สำเร็จ → ไม่ลบรายการของชุดนั้น และรายงานข้อผิดพลาด', async () => {
  const s = fakeTrainStore({
    rows: [{ id: 'a', collection: 'slipTrain', data: { at: ago(31), path: 'train/a.jpg' } }],
    files: ['train/a.jpg'],
    failRemove: true,
  })
  const r = await pruneTrainSlips(s.sb, { now: NOW })
  assertEquals([r.ok, r.error], [false, 'storage_remove_failed'])
  assertEquals(s.rows.length, 1)
  assertEquals(s.files.has('train/a.jpg'), true)
})

Deno.test('ทำเป็นชุดย่อยจนหมด แล้วหยุดเมื่อไม่มีรายการเก่าเหลือ', async () => {
  const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, collection: 'slipTrain', data: { at: ago(31 + i), path: `train/${i}.jpg` } }))
  const s = fakeTrainStore({ rows, files: rows.map((x) => x.data.path) })
  const r = await pruneTrainSlips(s.sb, { now: NOW, batch: 2, maxBatches: 10 })
  assertEquals([r.ok, r.records, r.files], [true, 5, 5])
  assertEquals(s.rows.length, 0)
  assertEquals(s.files.size, 0)
})

Deno.test('ไฟล์นอกโฟลเดอร์ train/ ไม่ถูกลบ แต่รายการที่เก่าเกินยังถูกลบ', async () => {
  const s = fakeTrainStore({
    rows: [{ id: 'x', collection: 'slipTrain', data: { at: ago(31), path: 'manual/x.jpg' } }],
    files: ['manual/x.jpg'],
  })
  const r = await pruneTrainSlips(s.sb, { now: NOW })
  assertEquals([r.ok, r.records, r.files], [true, 1, 0])
  assertEquals(s.removeCalls, [])
  assertEquals(s.files.has('manual/x.jpg'), true)
})

Deno.test('ไม่มีรายการเก่า → ไม่ลบอะไร', async () => {
  const s = fakeTrainStore({
    rows: [{ id: 'c', collection: 'slipTrain', data: { at: ago(3), path: 'train/c.jpg' } }],
    files: ['train/c.jpg'],
  })
  const r = await pruneTrainSlips(s.sb, { now: NOW })
  assertEquals([r.ok, r.records, r.files], [true, 0, 0])
  assertEquals(s.rows.length, 1)
})

Deno.test('ลบรายการไม่สำเร็จ → รายงานข้อผิดพลาด', async () => {
  const s = fakeTrainStore({
    rows: [{ id: 'a', collection: 'slipTrain', data: { at: ago(31), path: 'train/a.jpg' } }],
    files: ['train/a.jpg'],
    failDelete: true,
  })
  const r = await pruneTrainSlips(s.sb, { now: NOW })
  assertEquals([r.ok, r.error], [false, 'record_delete_failed'])
})

Deno.test('bearerMatches: รับเฉพาะคีย์ที่ตรงกับคีย์ของฟังก์ชัน', () => {
  assertEquals(bearerMatches('Bearer secret-1', 'secret-1'), true)
  assertEquals(bearerMatches('bearer secret-1', 'secret-1'), true)
  assertEquals(bearerMatches('Bearer other', 'secret-1'), false)
  assertEquals(bearerMatches(null, 'secret-1'), false)
  assertEquals(bearerMatches('Bearer ', ''), false)
})
