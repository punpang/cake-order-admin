// ทดสอบการตั้งค่าจัดการข้อมูลที่เป็นขยะ · รัน: node src/lib/retention.test.mjs
import assert from 'node:assert/strict'
import { RETENTION_CATS, defaultRetention, normalizeRetention, validateRetention, retentionDaysError, retentionRisks, retentionEqual, retentionCutoff, retentionSummary, fetchRetentionCount } from './retention.js'

let fail = 0
const t = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

await t('ค่าเริ่มต้นตรงกับฟังก์ชันในฐานข้อมูล', () => {
  assert.deepEqual(defaultRetention(), {
    slipRead: { enabled: true, days: 30 }, chatMedia: { enabled: true, days: 30 },
    aiLog: { enabled: false, days: 90 }, bell: { enabled: false, days: 90 }, orderLinks: { enabled: false, days: 180 },
  })
})
await t('normalize: ค่าที่ขาด/ผิด/ต่ำกว่าขั้นต่ำ ใช้ค่าเริ่มต้นรายหมวด', () => {
  const r = normalizeRetention({ slipRead: { enabled: false, days: 7 }, bell: { enabled: true, days: 2 }, aiLog: { enabled: 'yes', days: 'x' }, junk: { enabled: true, days: 1 } })
  assert.deepEqual(r.slipRead, { enabled: false, days: 7 })
  assert.deepEqual(r.bell, { enabled: true, days: 90 }) // ต่ำกว่า 7 วัน
  assert.deepEqual(r.aiLog, { enabled: false, days: 90 })
  assert.equal(Object.keys(r).length, RETENTION_CATS.length)
  assert.deepEqual(normalizeRetention(null), defaultRetention())
})
await t('ตรวจจำนวนวัน: ว่าง ทศนิยม ต่ำ/สูงเกิน', () => {
  assert.equal(retentionDaysError('slipRead', ''), 'กรอกจำนวนวัน')
  assert.equal(retentionDaysError('slipRead', 1.5), 'ใช้เลขจำนวนเต็ม')
  assert.equal(retentionDaysError('bell', 3), 'ต่ำสุด 7 วัน')
  assert.equal(retentionDaysError('slipRead', 3651), 'สูงสุด 3,650 วัน')
  assert.equal(retentionDaysError('slipRead', 1), '')
  assert.deepEqual(Object.keys(validateRetention({ ...defaultRetention(), aiLog: { enabled: false, days: 0 } })), ['aiLog'])
})
await t('ความเสี่ยง: เปิดหมวดใหม่และลดวัน ต้องยืนยัน · เพิ่มวัน/ปิดหมวด ไม่ต้อง', () => {
  const prev = defaultRetention()
  const next = { ...defaultRetention(), slipRead: { enabled: true, days: 7 }, chatMedia: { enabled: true, days: 60 }, bell: { enabled: true, days: 90 }, aiLog: { enabled: false, days: 7 } }
  assert.deepEqual(retentionRisks(prev, next).map((x) => [x.key, x.kind]), [['slipRead', 'shorter'], ['bell', 'enable']])
  assert.deepEqual(retentionRisks(prev, { ...prev, slipRead: { enabled: false, days: 1 } }), [])
})
await t('เทียบค่าเท่ากัน (ตัวเลขเป็นข้อความก็เท่า) และเวลาตัด', () => {
  const a = defaultRetention()
  const b = { ...defaultRetention(), slipRead: { enabled: true, days: '30' } }
  assert.equal(retentionEqual(a, b), true)
  assert.equal(retentionEqual(a, { ...a, bell: { enabled: true, days: 90 } }), false)
  assert.equal(retentionCutoff(30, Date.UTC(2026, 10, 12)).toISOString(), '2026-10-13T00:00:00.000Z')
})
await t('สรุปหน้าเมนู', () => {
  assert.equal(retentionSummary(defaultRetention()), 'ลบอัตโนมัติ 2 จาก 5 หมวด · ทุกวัน 10:30')
  assert.equal(retentionSummary(Object.fromEntries(RETENTION_CATS.map((c) => [c.key, { enabled: false, days: 30 }]))), 'ปิดการลบอัตโนมัติทุกหมวด')
})
await t('นับจำนวน: หมวดที่นับไม่ได้คืน null · หมวดอื่นกรองตามฟิลด์เวลาและเวลาตัด', async () => {
  const calls = []
  const q = (count) => { const o = { _f: [], select() { return o }, eq(k, v) { o._f.push(['eq', k, v]); return o }, lt(k, v) { o._f.push(['lt', k, v]); return o }, not(k, op, v) { o._f.push(['not', k, op, v]); return o }, then(res) { calls.push(o._f); res({ count, error: null }) } }; return o }
  let n = 0
  const client = { from: () => q(n++ === 0 ? 19 : 4) }
  assert.equal(await fetchRetentionCount(client, 'chatMedia', 30), null)
  assert.deepEqual(await fetchRetentionCount(client, 'orderLinks', 180, Date.UTC(2026, 10, 12)), { total: 19, due: 4 })
  assert.deepEqual(calls[0], [['eq', 'collection', 'orderLinks'], ['not', 'data->>revokedAt', 'is', null]])
  assert.deepEqual(calls[1][1], ['lt', 'data->>revokedAt', '2026-05-16T00:00:00.000Z'])
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
