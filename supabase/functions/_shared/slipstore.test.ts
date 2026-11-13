// ทดสอบที่เก็บผลอ่านสลิป: ผลที่ตัวอ่านตอบแล้วจำไว้ตามเลขอ้างอิง · ตัวอ่านผิดพลาดไม่จำ · สลิปที่อ่านไม่ครบส่งรูปเข้า R2 (train/)
import { assertEquals } from 'jsr:@std/assert@1'
import { cachedSlipFields, cacheSlipFields, isCompleteSlip, readSlipOnce, saveFailedSlip, usableFields } from './slipstore.ts'
import type { OcrEngine, SlipFields } from './slipocr.ts'

function fakeStore(opts: { failInsert?: string } = {}) {
  const rows: Array<{ table: string; collection: string; id: string; data: any }> = []
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
          if (opts.failInsert === row.collection) return { data: null, error: { code: 'XX000' } }
          if (rows.some((r) => r.table === table && r.collection === row.collection && r.id === row.id)) return { data: null, error: { code: '23505' } }
          rows.push({ table, collection: row.collection, id: row.id, data: row.data })
          return { data: row, error: null }
        },
      }
      return api
    },
  }
  return { sb, rows }
}

// เซิร์ฟเวอร์ไฟล์จำลอง (Worker): /svc/upload เก็บไฟล์ใต้ prefix แล้วคืน key/ref · /svc/delete ลบไฟล์
function fakeFiles(opts: { failUpload?: boolean } = {}) {
  const files = new Map<string, Uint8Array>()
  let n = 0
  const fetchImpl = (async (input: any, init: any) => {
    const url = new URL(String(input))
    if (url.pathname === '/svc/upload') {
      if (opts.failUpload) return new Response('{"error":"x"}', { status: 500 })
      const key = `${url.searchParams.get('prefix') || ''}/f${++n}.jpg`
      files.set(key, new Uint8Array(init.body))
      return new Response(JSON.stringify({ key, ref: `r2://private/${key}` }), { status: 200 })
    }
    if (url.pathname === '/svc/delete') {
      const keys: string[] = JSON.parse(String(init.body)).keys
      for (const k of keys) files.delete(k)
      return new Response(JSON.stringify({ ok: true, deleted: keys.length }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { files, env: { url: 'https://files.test', key: 'svc-key', fetchImpl } }
}

const COMPLETE: SlipFields = { amount: 178, paidAt: '2026-11-11T14:48', receiverAccount: 'xxx-x-x8154-x' }
const EMPTY: SlipFields = { amount: null, paidAt: null, receiverAccount: null }
const img = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, n, 1, 2])
// ตัวอ่านจำลอง: out = ผลที่ตอบ · null = ผิดพลาด/ไม่ตอบ
const engine = (name: string, out: SlipFields | null, calls: string[]): OcrEngine => ({
  name,
  read: async () => { calls.push(name); return out },
})

Deno.test('เก็บค่าที่ตอบแล้วตามเลขอ้างอิง และดึงกลับได้ (ไม่เก็บชื่อผู้รับ)', async () => {
  const { sb } = fakeStore()
  assertEquals(await cachedSlipFields(sb, '004:REF1'), null)
  assertEquals(await cacheSlipFields(sb, '004:REF1', { ...COMPLETE, receiverName: 'ไม่ควรเก็บ' }), true)
  assertEquals(await cachedSlipFields(sb, '004:REF1'), COMPLETE)
  assertEquals(await cachedSlipFields(sb, '004:REF2'), null)
})

Deno.test('usableFields / isCompleteSlip: อ่านได้ = มียอดหรือวัน-เวลา · ครบ = มีทั้งยอด วัน-เวลา และเลขบัญชีผู้รับ', () => {
  assertEquals(usableFields(null), false)
  assertEquals(usableFields({ amount: 1, paidAt: null, receiverAccount: null }), true)
  assertEquals(usableFields({ amount: null, paidAt: '2026-11-11T14:48', receiverAccount: null }), true)
  assertEquals(isCompleteSlip(COMPLETE), true)
  assertEquals(isCompleteSlip({ ...COMPLETE, receiverAccount: null }), false)
  assertEquals(isCompleteSlip({ ...COMPLETE, paidAt: null }), false)
  assertEquals(isCompleteSlip(null), false)
})

Deno.test('อ่านครบ: จำผลไว้ ไม่เก็บชุดเทรน และครั้งต่อไปไม่เรียกตัวอ่าน', async () => {
  const { sb, rows } = fakeStore()
  const f = fakeFiles()
  const calls: string[] = []
  const engines = [engine('wai', COMPLETE, calls)]
  assertEquals(await readSlipOnce(sb, { key: '004:REF1', bytes: img(1), bankCode: '004', source: 'chat', engines, files: f.env }), COMPLETE)
  assertEquals(await readSlipOnce(sb, { key: '004:REF1', bytes: img(1), bankCode: '004', source: 'order', engines, files: f.env }), COMPLETE)
  assertEquals(calls, ['wai'])
  assertEquals(rows.filter((r) => r.collection === 'slipTrain').length, 0)
  assertEquals(f.files.size, 0)
})

Deno.test('ตัวอ่านตอบแต่อ่านไม่ได้เลย: จำผลว่างไว้ ไม่ส่งซ้ำ และส่งรูปเข้าชุดเทรนที่ train/ (ขาดครบทั้ง 3 ฟิลด์)', async () => {
  const { sb, rows } = fakeStore()
  const f = fakeFiles()
  const calls: string[] = []
  const engines = [engine('wai', EMPTY, calls)]
  assertEquals(await readSlipOnce(sb, { key: '004:REF2', bytes: img(2), bankCode: '004', source: 'chat', engines, files: f.env }), EMPTY)
  assertEquals(await readSlipOnce(sb, { key: '004:REF2', bytes: img(2), bankCode: '004', source: 'chat', engines, files: f.env }), EMPTY)
  assertEquals(calls, ['wai'])
  const train = rows.filter((r) => r.collection === 'slipTrain')
  assertEquals(train.length, 1)
  assertEquals(train[0].data.missing, ['amount', 'paidAt', 'receiverAccount'])
  assertEquals([...f.files.keys()], [train[0].data.path])
  assertEquals(train[0].data.path.startsWith('train/'), true)
})

Deno.test('ได้ยอดและวัน-เวลา แต่ไม่มีเลขบัญชีผู้รับ → จำผล และส่งเข้าชุดเทรน (ขาด receiverAccount)', async () => {
  const { sb, rows } = fakeStore()
  const f = fakeFiles()
  const calls: string[] = []
  const engines = [engine('wai', { ...COMPLETE, receiverAccount: null }, calls)]
  await readSlipOnce(sb, { key: '004:REF3', bytes: img(3), bankCode: '004', source: 'order', engines, files: f.env })
  await readSlipOnce(sb, { key: '004:REF3', bytes: img(3), bankCode: '004', source: 'order', engines, files: f.env })
  assertEquals(calls, ['wai'])
  const train = rows.filter((r) => r.collection === 'slipTrain')
  assertEquals(train.length, 1)
  assertEquals(train[0].data.missing, ['receiverAccount'])
  assertEquals(train[0].data.source, 'order')
})

Deno.test('ตัวอ่านผิดพลาดชั่วคราว (ไม่ตอบ) → ไม่จำผล ไม่ส่งชุดเทรน และรอบหน้าลองอ่านใหม่', async () => {
  const { sb, rows } = fakeStore()
  const f = fakeFiles()
  const calls: string[] = []
  const engines = [engine('wai', null, calls)]
  assertEquals(await readSlipOnce(sb, { key: '004:REF4', bytes: img(4), bankCode: '004', source: 'chat', engines, files: f.env }), null)
  assertEquals(await readSlipOnce(sb, { key: '004:REF4', bytes: img(4), bankCode: '004', source: 'chat', engines, files: f.env }), null)
  assertEquals(calls, ['wai', 'wai'])
  assertEquals(rows.length, 0)
  assertEquals(f.files.size, 0)
})

Deno.test('ตัวอ่านหนึ่งผิดพลาด อีกตัวได้ผลไม่ครบ → คืนผลให้คำขอนี้ แต่ไม่จำ (รอบหน้าลองใหม่)', async () => {
  const { sb, rows } = fakeStore()
  const f = fakeFiles()
  const calls: string[] = []
  const engines = [engine('wai', { ...EMPTY, receiverAccount: 'xxx-x-x8154-x' }, calls), engine('claude', null, calls)]
  const got = await readSlipOnce(sb, { key: '004:REF5', bytes: img(5), bankCode: '004', source: 'chat', engines, files: f.env })
  assertEquals(got?.receiverAccount, 'xxx-x-x8154-x')
  assertEquals(rows.length, 0)
  await readSlipOnce(sb, { key: '004:REF5', bytes: img(5), bankCode: '004', source: 'chat', engines, files: f.env })
  assertEquals(calls, ['wai', 'claude', 'wai', 'claude'])
})

Deno.test('ตัวอ่านแรกผิดพลาด แต่ตัวถัดไปได้ยอดและวัน-เวลาครบ → จำผล ไม่ส่งชุดเทรน', async () => {
  const { sb, rows } = fakeStore()
  const f = fakeFiles()
  const calls: string[] = []
  const engines = [engine('wai', null, calls), engine('claude', COMPLETE, calls)]
  assertEquals(await readSlipOnce(sb, { key: '004:REF6', bytes: img(6), bankCode: '004', source: 'chat', engines, files: f.env }), COMPLETE)
  assertEquals(rows.filter((r) => r.collection === 'slipRead').length, 1)
  assertEquals(rows.filter((r) => r.collection === 'slipTrain').length, 0)
})

Deno.test('ไม่มีตัวอ่านที่ตั้งค่าไว้ → คืน null โดยไม่แตะฐานข้อมูลหรือไฟล์', async () => {
  const { sb, rows } = fakeStore()
  const f = fakeFiles()
  assertEquals(await readSlipOnce(sb, { key: '004:REF7', bytes: img(7), bankCode: '004', source: 'chat', engines: [], files: f.env }), null)
  assertEquals(rows.length, 0)
  assertEquals(f.files.size, 0)
})

Deno.test('saveFailedSlip: สลิปครบไม่ส่งชุดเทรน · รูปเดิมส่งครั้งเดียว · อัปโหลดไม่สำเร็จ/บันทึกรายการไม่สำเร็จ → ไม่ทิ้งไฟล์ค้าง', async () => {
  const a = fakeStore()
  const fa = fakeFiles()
  assertEquals(await saveFailedSlip(a.sb, { bytes: img(8), bankCode: '004', source: 'chat', fields: COMPLETE, files: fa.env }), false)
  assertEquals(fa.files.size, 0)
  assertEquals(await saveFailedSlip(a.sb, { bytes: img(8), bankCode: '004', source: 'chat', fields: EMPTY, files: fa.env }), true)
  assertEquals(await saveFailedSlip(a.sb, { bytes: img(8), bankCode: '004', source: 'chat', fields: EMPTY, files: fa.env }), false)
  assertEquals(fa.files.size, 1)
  const b = fakeStore({ failInsert: 'slipTrain' })
  const fb = fakeFiles()
  assertEquals(await saveFailedSlip(b.sb, { bytes: img(9), bankCode: '004', source: 'chat', fields: EMPTY, files: fb.env }), false)
  assertEquals(fb.files.size, 0)
  assertEquals(b.rows.length, 0)
  const c = fakeFiles({ failUpload: true })
  assertEquals(await saveFailedSlip(fakeStore().sb, { bytes: img(10), bankCode: '004', source: 'chat', fields: EMPTY, files: c.env }), false)
  assertEquals(c.files.size, 0)
})
