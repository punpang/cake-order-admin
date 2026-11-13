// ทดสอบที่เก็บผลอ่านสลิป (ค่าที่อ่านได้ใช้ซ้ำ · สลิปที่อ่านไม่ผ่านเก็บแยกไว้เทรน)
import { assertEquals } from 'jsr:@std/assert@1'
import { cachedSlipFields, cacheSlipFields, saveFailedSlip, usableFields } from './slipstore.ts'

function fakeStore() {
  const rows: Array<{ table: string; collection: string; id: string; data: any }> = []
  const files = new Map<string, number>()
  const sb: any = {
    from: (table: string) => {
      const filters: Array<(r: any) => boolean> = []
      const api: any = {
        select: () => api,
        eq: (c: string, v: any) => { filters.push((r: any) => r[c] === v); return api },
        maybeSingle: async () => {
          const hit = rows.find((r) => r.table === table && filters.every((g) => g(r)))
          return { data: hit ? { id: hit.id, data: hit.data } : null, error: null }
        },
        insert: async (row: any) => {
          if (rows.some((r) => r.table === table && r.collection === row.collection && r.id === row.id)) return { data: null, error: { code: '23505' } }
          rows.push({ table, collection: row.collection, id: row.id, data: row.data })
          return { data: row, error: null }
        },
      }
      return api
    },
    storage: { from: () => ({ upload: async (path: string, bytes: Uint8Array) => { if (files.has(path)) return { error: { message: 'exists' } }; files.set(path, bytes.length); return { error: null } } }) },
  }
  return { sb, rows, files }
}

Deno.test('เก็บค่าที่อ่านได้ตามเลขอ้างอิง และดึงกลับมาใช้ได้ (ไม่เก็บชื่อผู้รับ)', async () => {
  const { sb } = fakeStore()
  assertEquals(await cachedSlipFields(sb, '004:REF1'), null)
  assertEquals(await cacheSlipFields(sb, '004:REF1', { amount: 178, paidAt: '2026-11-11T14:48', receiverName: 'ไม่ควรเก็บ', receiverAccount: 'xxx-x-x8154-x' }), true)
  assertEquals(await cachedSlipFields(sb, '004:REF1'), { amount: 178, paidAt: '2026-11-11T14:48', receiverAccount: 'xxx-x-x8154-x' })
  assertEquals(await cachedSlipFields(sb, '004:REF2'), null)
})

Deno.test('ผลที่อ่านไม่ผ่านไม่ถูกเก็บเป็นค่าใช้ซ้ำ', async () => {
  const { sb, rows } = fakeStore()
  assertEquals(await cacheSlipFields(sb, '004:REF1', { amount: null, paidAt: null, receiverName: null, receiverAccount: 'xxx-x-x8154-x' }), false)
  assertEquals(await cachedSlipFields(sb, '004:REF1'), null)
  assertEquals(rows.length, 0)
})

Deno.test('สลิปที่อ่านไม่ผ่าน เก็บรูปไว้โฟลเดอร์ train/ ครั้งเดียว และไม่เก็บชื่อผู้รับ', async () => {
  const { sb, rows, files } = fakeStore()
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])
  assertEquals(await saveFailedSlip(sb, { bytes, bankCode: '004', source: 'chat', attempts: [{ amount: null, paidAt: null, receiverName: 'ไม่ควรเก็บ', receiverAccount: 'xxx-x-x8154-x' }] }), true)
  assertEquals(await saveFailedSlip(sb, { bytes, bankCode: '004', source: 'chat', attempts: [null] }), false)
  const train = rows.filter((r) => r.collection === 'slipTrain')
  assertEquals(train.length, 1)
  assertEquals(files.size, 1)
  assertEquals([...files.keys()][0].startsWith('train/'), true)
  assertEquals(train[0].data.attempts, [{ amount: null, paidAt: null, receiverAccount: 'xxx-x-x8154-x' }])
  assertEquals(train[0].data.reason, 'no_amount_or_date')
})

Deno.test('usableFields: ต้องมียอดหรือวัน-เวลาอย่างใดอย่างหนึ่ง', () => {
  assertEquals(usableFields(null), false)
  assertEquals(usableFields({ amount: null, paidAt: null }), false)
  assertEquals(usableFields({ amount: 1, paidAt: null }), true)
  assertEquals(usableFields({ amount: null, paidAt: '2026-11-11T14:48' }), true)
})
