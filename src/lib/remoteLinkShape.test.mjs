// ลิงก์ออร์เดอร์จากเซิร์ฟเวอร์ต้องมี tokenHash ก่อนหาในเครื่องลูกค้า (openOrderLink หาด้วย tokenHash) · รัน: node src/lib/remoteLinkShape.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hashToken } from './orderLink.js'
import { shapeRemoteLink } from './remoteLinkShape.js'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEF' // โทเค็นสมมติ 32 ตัวอักษร (ไม่ใช่โทเค็นจริง)
const data = {
  order: { id: 'o-test-1', code: 'OR-TEST-0001' },
  customer: null,
  link: { id: 'ol-test-1', orderId: 'o-test-1', createdAt: '2026-11-23T02:00:02.894Z', lastOpenedAt: '2026-11-23T02:37:30.085Z', openCount: 2 },
  orderTopic: null,
  shop: { name: 'ร้านทดสอบ' },
}

let fail = 0
const t = (name, fn) => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL ${name}\n  ${e.message}`)
  }
}

t('tokenHash ของลิงก์จากเซิร์ฟเวอร์ = sha256("orderlink:" + โทเค็น)', () => {
  const want = createHash('sha256').update(`orderlink:${TOKEN}`).digest('hex')
  assert.equal(hashToken(TOKEN), want)
  assert.equal(shapeRemoteLink(data, TOKEN).link.tokenHash, want)
})

t('หาลิงก์เจอด้วยโทเค็นที่ลูกค้าเปิด (เหมือน openOrderLink)', () => {
  const orderLinks = [{ ...shapeRemoteLink(data, TOKEN).link }]
  const found = orderLinks.find((l) => l.tokenHash === hashToken(TOKEN))
  assert.equal(found?.orderId, 'o-test-1')
})

t('โทเค็นอื่นหาไม่เจอ', () => {
  const orderLinks = [{ ...shapeRemoteLink(data, TOKEN).link }]
  assert.equal(orderLinks.find((l) => l.tokenHash === hashToken(TOKEN.slice(1) + 'x')), undefined)
})

t('ไม่แก้ข้อมูลเดิม', () => {
  const before = JSON.stringify(data)
  shapeRemoteLink(data, TOKEN)
  assert.equal(JSON.stringify(data), before)
  assert.equal('tokenHash' in data.link, false)
})

t('ไม่มีออร์เดอร์ = { error: null } (เหมือนเดิม)', () => {
  assert.deepEqual(shapeRemoteLink({}, TOKEN), { error: null })
  assert.deepEqual(shapeRemoteLink(null, TOKEN), { error: null })
})

t('ไม่มี link = ไม่สร้าง tokenHash', () => {
  assert.equal(shapeRemoteLink({ order: data.order }, TOKEN).link, undefined)
})

if (fail) {
  console.log(`\n✗ ล้ม ${fail} ข้อ`)
  process.exit(1)
}
console.log('\n✓ ผ่านทั้งหมด')
