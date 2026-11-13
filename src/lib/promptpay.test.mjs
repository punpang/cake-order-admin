// ทดสอบ QR พร้อมเพย์แบบ Biller และตัวช่วยรหัส · รัน: node src/lib/promptpay.test.mjs
import assert from 'node:assert/strict'
import { billerIdOf, shopCodeOf, shopRefOk, shopRefOfCode, promptPayBillerPayload, crc16 } from './promptpay.js'

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

// ตัวอย่างที่ธนาคารรับได้ (QR บนการ์ด): Biller ID · รหัสร้านค้า (Ref 1) · รหัสอ้างอิง POS (Ref 2)
const BILLER = '010753600010286'
const SHOP = '014000000517185'
const REF = 'POS123927229'

t('crc16 ตรงกับค่าอ้างอิง CRC-16/CCITT-FALSE ("123456789" = 29B1)', () => assert.equal(crc16('123456789'), '29B1'))

t('billerIdOf รับเฉพาะตัวเลข 15 หลัก', () => {
  assert.equal(billerIdOf('010 753 600 010 286'), BILLER)
  assert.equal(billerIdOf('01075360001028'), '')
  assert.equal(billerIdOf(''), '')
})

t('shopCodeOf รับตัวเลข 1–20 หลัก', () => {
  assert.equal(shopCodeOf('014 000 000 517 185'), SHOP)
  assert.equal(shopCodeOf('ABC'), '')
  assert.equal(shopCodeOf(''), '')
})

t('shopRefOfCode แปลงรหัสมีขีดเป็นรหัสอ้างอิงไม่มีขีด', () => {
  assert.equal(shopRefOfCode('OR-131126-000123'), 'ORD131126000123')
  assert.equal(shopRefOfCode('POS-131126-00123'), 'POS13112600123')
  assert.equal(shopRefOfCode('ORD131126000123'), 'ORD131126000123')
})

t('shopRefOk: POS/ORD ตามด้วยตัวเลข 3–17 หลัก ไม่มีขีด', () => {
  assert.equal(shopRefOk('ORD131126000123'), true)
  assert.equal(shopRefOk('POS13112600123'), true)
  assert.equal(shopRefOk('OR-131126-000123'), false)
  assert.equal(shopRefOk('ORD12'), false)
  assert.equal(shopRefOk('ABC123456'), false)
})

t('promptPayBillerPayload: Biller ID ที่ 01 · รหัสร้านค้าที่ 02 (Ref 1) · รหัสอ้างอิงที่ 03 (Ref 2)', () => {
  const p = promptPayBillerPayload(BILLER, 1, REF, SHOP)
  assert.ok(p)
  const body = p.slice(0, -4)
  assert.equal(p.slice(-4), crc16(body))
  const root = parse(p)
  assert.equal(root.get('00'), '01')
  assert.equal(root.get('01'), '12')
  assert.equal(root.get('53'), '764')
  assert.equal(root.get('54'), '1.00')
  assert.equal(root.get('58'), 'TH')
  assert.equal(root.get('63'), crc16(body))
  const biller = parse(root.get('30'))
  assert.equal(biller.get('00'), 'A000000677010112')
  assert.equal(biller.get('01'), BILLER)
  assert.equal(biller.get('02'), SHOP)
  assert.equal(biller.get('03'), REF)
})

t('ฟิลด์ตรงกับ QR ตัวอย่างที่ธนาคารรับได้ (ไม่รวม tag 62)', () => {
  const root = parse(promptPayBillerPayload(BILLER, 1, REF, SHOP))
  const biller = parse(root.get('30'))
  assert.deepEqual(
    [root.get('01'), root.get('53'), root.get('54'), root.get('58'), biller.get('00'), biller.get('01'), biller.get('02'), biller.get('03')],
    ['12', '764', '1.00', 'TH', 'A000000677010112', BILLER, SHOP, REF],
  )
})

t('ยอดทศนิยมปัดเป็นสองตำแหน่ง', () => {
  const root = parse(promptPayBillerPayload(BILLER, '99.5', REF, SHOP))
  assert.equal(root.get('54'), '99.50')
})

t('ไม่ระบุยอด = QR ไม่ล็อกยอด (01 = 11 และไม่มี tag 54)', () => {
  const root = parse(promptPayBillerPayload(BILLER, null, REF, SHOP))
  assert.equal(root.get('01'), '11')
  assert.equal(root.has('54'), false)
})

t('ข้อมูลไม่ถูกต้องคืน null (ไม่มี Biller ID / ไม่มีรหัสร้านค้า / รหัสอ้างอิงผิด / ยอดผิด)', () => {
  assert.equal(promptPayBillerPayload('12345', 100, REF, SHOP), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, REF, ''), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, 'OR-131126-000123', SHOP), null)
  assert.equal(promptPayBillerPayload(BILLER, 0, REF, SHOP), null)
  assert.equal(promptPayBillerPayload(BILLER, 10000000, REF, SHOP), null)
})

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exitCode = fail ? 1 : 0
