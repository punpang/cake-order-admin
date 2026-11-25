// ทดสอบการบันทึก db.shop.parcel ผ่าน saveShopSettings (ระดับ store จริง ผ่าน Vite SSR) · รัน: node src/data/shopParcel.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

try {
  const S = await server.ssrLoadModule('/src/data/store.js')
  const { db, session } = S
  session.role = 'admin'
  const parcel = { boxG: 100, volDivisor: 5000, rates: [{ upToG: 500, price: 40 }, { upToG: 1000, price: 60 }] }

  t('บันทึก db.shop.parcel ที่ส่งเข้ามาได้', () => {
    const before = JSON.stringify(db.shop.delivery)
    const r = S.saveShopSettings({ ...db.shop, parcel })
    assert.equal(r?.error, undefined)
    assert.deepEqual(db.shop.parcel, parcel)
    assert.equal(JSON.stringify(db.shop.delivery), before)
  })
  t('บันทึกโดยไม่มี parcel → ค่าเดิมคงอยู่ และฟิลด์อื่นไม่เปลี่ยน', () => {
    const open = db.shop.open
    const r = S.saveShopSettings({ ...db.shop, parcel: undefined })
    assert.equal(r?.error, undefined)
    assert.deepEqual(db.shop.parcel, parcel)
    assert.equal(db.shop.open, open)
  })
  t('ร้านเดิมที่ยังไม่เคยมี parcel (undefined) บันทึกได้โดยไม่ throw', () => {
    delete db.shop.parcel
    assert.doesNotThrow(() => S.saveShopSettings({ ...db.shop }))
  })
} finally {
  // รันเคสทั้งหมดก่อนปิดเซิร์ฟเวอร์ (กันเคสค้างเมื่อเคสก่อนหน้าล้ม)
  for (const [name, fn] of cases) {
    try { fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
  await server.close()
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
