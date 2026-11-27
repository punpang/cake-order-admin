// ทดสอบ injectBundle: ตอบกลับที่ไม่มี tier ต้องไม่ล้างการ์ดระดับเดิม · ตอบกลับที่มี tier ต้องอัปเดต
// รัน: node src/lib/customerRemote.bundle.test.mjs (โหลดผ่าน Vite SSR เหมือนไฟล์ทดสอบอื่น)
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }
try {
  const { injectBundle } = await server.ssrLoadModule('/src/lib/customerRemote.js')
  const fresh = () => ({ customers: [{ id: 'c1', name: 'a', ledger: [] }], orders: [], coupons: [], memberCard: { enabled: true, levelName: 'LV2' } })

  t('ตอบกลับที่ไม่มี tier (เช่น สร้างคูปอง) ไม่ล้างการ์ดระดับเดิม', () => {
    const db = fresh()
    injectBundle(db, { customer: { id: 'c1', name: 'a', ledger: [{ delta: -100 }] }, coupons: [] })
    assert.deepEqual(db.memberCard, { enabled: true, levelName: 'LV2' })
    assert.deepEqual(db.customers[0].ledger, [{ delta: -100 }])
  })
  t('ตอบกลับที่มี tier เปิดใช้ อัปเดตการ์ด', () => {
    const db = fresh()
    injectBundle(db, { customer: { id: 'c1', name: 'a' }, tier: { enabled: true, levelName: 'LV3' } })
    assert.equal(db.memberCard.levelName, 'LV3')
  })
  t('ตอบกลับที่มีอัตราแลกของร้าน ตั้งมูลค่าต่อคะแนนตามฐานข้อมูล', () => {
    const db = { ...fresh(), loyalty: { pointValue: 1 } }
    injectBundle(db, { customer: { id: 'c1', name: 'a' }, loyalty: { pointValue: 0.1 } })
    assert.equal(db.loyalty.pointValue, 0.1)
  })
  t('ตอบกลับที่ไม่มีอัตราแลก (เช่น สร้างคูปอง) ไม่เปลี่ยนมูลค่าต่อคะแนนเดิม', () => {
    const db = { ...fresh(), loyalty: { pointValue: 0.1 } }
    injectBundle(db, { customer: { id: 'c1', name: 'a' }, loyalty: null })
    assert.equal(db.loyalty.pointValue, 0.1)
  })
  t('ตอบกลับที่มี tier ปิด (enabled false) ล้างการ์ด', () => {
    const db = fresh()
    injectBundle(db, { customer: { id: 'c1', name: 'a' }, tier: { enabled: false } })
    assert.equal(db.memberCard, null)
  })
} finally {
  await server.close()
}
console.log(fail ? `ล้มเหลว ${fail} รายการ` : 'ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
