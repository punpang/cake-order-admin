// ทดสอบ QR พร้อมเพย์แบบ Biller และตัวช่วยรหัส · รัน: node src/lib/promptpay.test.mjs
import assert from 'node:assert/strict'
import { billerIdOf, shopCodeOf, shopRefOk, shopRefOfCode, newQrSuffix, qrRefOk, promptPayBillerPayload, crc16 } from './promptpay.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// อ่าน TLV ระดับเดียว (tag 2 หลัก · length 2 หลัก)
const parse = (s) => {
  const out = new Map()
  for (let i = 0; i < s.length;) {
    const tag = s.slice(i, i + 2)
    const len = Number(s.slice(i + 2, i + 4))
    out.set(tag, s.slice(i + 4, i + 4 + len))
    i += 4 + len
  }
  return out
}

const BILLER = '010753600010286' // Biller ID ของร้าน (ตั้งค่าร้าน)
const SHOP = '014000000517185' // รหัสร้านค้า = Ref 1 (ตั้งค่าร้าน)
const ORDER = 'ORD131126000741' // รหัสอ้างอิงร้านค้า POS/ORD ของออร์เดอร์
const QR = 'ORD131126000741ABCDE' // Ref 2 = POS/ORD + รหัสสุ่ม 5 ตัว

t('crc16 ตรงกับค่าอ้างอิง CRC-16/CCITT-FALSE ("123456789" = 29B1)', () => assert.equal(crc16('123456789'), '29B1'))

t('billerIdOf รับเฉพาะตัวเลข 15 หลัก', () => {
  assert.equal(billerIdOf('010 753 600 010 286'), BILLER)
  assert.equal(billerIdOf('01075360001028'), '')
  assert.equal(billerIdOf(''), '')
})

t('shopCodeOf รับเฉพาะตัวเลข 1–20 หลัก (ตัดช่องว่างและขีด) · POS/ORD ไม่ใช่รหัสร้านค้า', () => {
  assert.equal(shopCodeOf('014 000 000 517 185'), SHOP)
  assert.equal(shopCodeOf('12345678901234567890'), '12345678901234567890')
  assert.equal(shopCodeOf('123456789012345678901'), '')
  assert.equal(shopCodeOf(ORDER), '')
  assert.equal(shopCodeOf(''), '')
})

t('shopRefOfCode แปลงรหัสมีขีดเป็นรหัสอ้างอิงไม่มีขีด', () => {
  assert.equal(shopRefOfCode('OR-131126-000741'), 'ORD131126000741')
  assert.equal(shopRefOfCode('POS-131126-00123'), 'POS13112600123')
  assert.equal(shopRefOfCode('ORD131126000741'), 'ORD131126000741')
})

t('shopRefOk: POS/ORD ตามด้วยตัวเลข 3–17 หลัก ไม่มีขีด', () => {
  assert.equal(shopRefOk('ORD131126000741'), true)
  assert.equal(shopRefOk('POS13112600123'), true)
  assert.equal(shopRefOk('OR-131126-000741'), false)
  assert.equal(shopRefOk('ORD12'), false)
})

t('newQrSuffix: 5 ตัวตามชุดอักษร ไม่มี 0 1 I L O และไม่ซ้ำกันในการสุ่มหลายครั้ง', () => {
  const seen = new Set()
  for (let i = 0; i < 300; i++) {
    const r = newQrSuffix()
    assert.equal(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(r), true, r)
    seen.add(r)
  }
  assert.equal(seen.size, 300)
})

t('qrRefOk: POS/ORD (ORD+12 หลัก หรือ POS+11 หลัก) + รหัสสุ่ม 5 ตัว', () => {
  assert.equal(qrRefOk(QR), true)
  assert.equal(qrRefOk('POS13112600123ABCDE'), true)
  assert.equal(qrRefOk(ORDER), false)
  assert.equal(qrRefOk('ORD131126000741ABCD0'), false)
  assert.equal(qrRefOk('ORD131126000741ABCDI'), false)
  assert.equal(qrRefOk(null), false)
})

t('promptPayBillerPayload: Biller ID ที่ 01 · รหัสร้านค้าที่ 02 (Ref 1) · POS/ORD+รหัสสุ่มที่ 03 (Ref 2) · ยอดฝังใน QR', () => {
  const p = promptPayBillerPayload(BILLER, 389, SHOP, QR)
  assert.ok(p)
  const body = p.slice(0, -4)
  assert.equal(p.slice(-4), crc16(body))
  const root = parse(p)
  assert.equal(root.get('00'), '01')
  assert.equal(root.get('01'), '12')
  assert.equal(root.get('53'), '764')
  assert.equal(root.get('54'), '389.00')
  assert.equal(root.get('58'), 'TH')
  assert.equal(root.get('63'), crc16(body))
  const biller = parse(root.get('30'))
  assert.equal(biller.get('00'), 'A000000677010112')
  assert.equal(biller.get('01'), BILLER)
  assert.equal(biller.get('02'), SHOP)
  assert.equal(biller.get('03'), QR)
  assert.equal(biller.has('04'), false)
})

t('ยอดทศนิยมปัดเป็นสองตำแหน่ง', () => {
  const root = parse(promptPayBillerPayload(BILLER, '99.5', SHOP, QR))
  assert.equal(root.get('54'), '99.50')
})

t('ไม่ระบุยอด = QR ไม่ล็อกยอด (01 = 11 และไม่มี tag 54)', () => {
  const root = parse(promptPayBillerPayload(BILLER, null, SHOP, QR))
  assert.equal(root.get('01'), '11')
  assert.equal(root.has('54'), false)
})

t('ข้อมูลไม่ถูกต้องคืน null (Biller ID / รหัสร้านค้า / Ref 2 ไม่มีรหัสสุ่ม / ยอด)', () => {
  assert.equal(promptPayBillerPayload('12345', 100, SHOP, QR), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, '', QR), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, ORDER, QR), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, SHOP, ORDER), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, SHOP, 'OR-131126-000741'), null)
  assert.equal(promptPayBillerPayload(BILLER, 0, SHOP, QR), null)
  assert.equal(promptPayBillerPayload(BILLER, 10000000, SHOP, QR), null)
})

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exitCode = fail ? 1 : 0
