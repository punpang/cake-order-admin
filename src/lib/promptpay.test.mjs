// ทดสอบ QR พร้อมเพย์แบบ Biller และตัวช่วยรหัส · รัน: node src/lib/promptpay.test.mjs
import assert from 'node:assert/strict'
import { billerIdOf, shopRefOk, shopRefOfCode, newQrRef, qrRefOk, promptPayBillerPayload, crc16 } from './promptpay.js'

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
const ORDER = 'ORD131126000741' // Ref 1 = รหัสอ้างอิงร้านค้า POS/ORD
const RANDOM = 'K7M3QRT2XBHD' // Ref 2 = รหัสสุ่มของรายการแจ้งชำระ

t('crc16 ตรงกับค่าอ้างอิง CRC-16/CCITT-FALSE ("123456789" = 29B1)', () => assert.equal(crc16('123456789'), '29B1'))

t('billerIdOf รับเฉพาะตัวเลข 15 หลัก', () => {
  assert.equal(billerIdOf('010 753 600 010 286'), BILLER)
  assert.equal(billerIdOf('01075360001028'), '')
  assert.equal(billerIdOf(''), '')
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

t('newQrRef: 12 ตัวตามชุดอักษร ไม่มี 0 1 I L O และไม่ซ้ำกันในการสุ่มหลายครั้ง', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const r = newQrRef()
    assert.equal(qrRefOk(r), true, r)
    seen.add(r)
  }
  assert.equal(seen.size, 200)
})

t('qrRefOk ไม่รับตัวอักษรที่อ่านสับสนและความยาวผิด', () => {
  assert.equal(qrRefOk('ABCDEFGHJKMN'), true)
  assert.equal(qrRefOk('ABCDEFGH0JKM'), false)
  assert.equal(qrRefOk('ABCDEFGHIJKM'), false)
  assert.equal(qrRefOk('ABC'), false)
})

t('promptPayBillerPayload: Biller ID ที่ 01 · POS/ORD ที่ 02 (Ref 1) · รหัสสุ่มที่ 03 (Ref 2) · ไม่มีรหัสร้านค้าใน QR', () => {
  const p = promptPayBillerPayload(BILLER, 389, ORDER, RANDOM)
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
  assert.equal(biller.get('02'), ORDER)
  assert.equal(biller.get('03'), RANDOM)
  assert.equal(p.includes('014000000517185'), false)
})

t('ยอดทศนิยมปัดเป็นสองตำแหน่ง', () => {
  const root = parse(promptPayBillerPayload(BILLER, '99.5', ORDER, RANDOM))
  assert.equal(root.get('54'), '99.50')
})

t('ไม่ระบุยอด = QR ไม่ล็อกยอด (01 = 11 และไม่มี tag 54)', () => {
  const root = parse(promptPayBillerPayload(BILLER, null, ORDER, RANDOM))
  assert.equal(root.get('01'), '11')
  assert.equal(root.has('54'), false)
})

t('ข้อมูลไม่ถูกต้องคืน null (Biller ID / รหัสอ้างอิง / รหัสสุ่ม / ยอด)', () => {
  assert.equal(promptPayBillerPayload('12345', 100, ORDER, RANDOM), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, 'OR-131126-000741', RANDOM), null)
  assert.equal(promptPayBillerPayload(BILLER, 100, ORDER, 'ABC'), null)
  assert.equal(promptPayBillerPayload(BILLER, 0, ORDER, RANDOM), null)
  assert.equal(promptPayBillerPayload(BILLER, 10000000, ORDER, RANDOM), null)
})

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exitCode = fail ? 1 : 0
