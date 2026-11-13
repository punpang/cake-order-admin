// ทดสอบ QR พร้อมเพย์แบบ Biller และตัวช่วยรหัส · รัน: node src/lib/promptpay.test.mjs
import assert from 'node:assert/strict'
import { billerIdOf, shopRefOk, shopRefOfCode, promptPayBillerPayload, crc16 } from './promptpay.js'

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

t('crc16 ตรงกับค่าอ้างอิง CRC-16/CCITT-FALSE ("123456789" = 29B1)', () => assert.equal(crc16('123456789'), '29B1'))

t('billerIdOf รับเฉพาะตัวเลข 15 หลัก', () => {
  assert.equal(billerIdOf('014 000 000 517 185'), '014000000517185')
  assert.equal(billerIdOf('01400000051718'), '')
  assert.equal(billerIdOf(''), '')
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

t('promptPayBillerPayload: โครง tag ถูกต้อง, Ref 1 = Ref 2, ยอดสองตำแหน่ง, CRC ตรง', () => {
  const p = promptPayBillerPayload('014000000517185', 540, 'ORD131126000123')
  assert.ok(p)
  const body = p.slice(0, -4)
  assert.equal(p.slice(-4), crc16(body))
  const root = parse(p)
  assert.equal(root.get('00'), '01')
  assert.equal(root.get('01'), '12')
  assert.equal(root.get('53'), '764')
  assert.equal(root.get('54'), '540.00')
  assert.equal(root.get('58'), 'TH')
  assert.equal(root.get('63'), crc16(body))
  const biller = parse(root.get('30'))
  assert.equal(biller.get('00'), 'A000000677010112')
  assert.equal(biller.get('01'), '014000000517185')
  assert.equal(biller.get('02'), 'ORD131126000123')
  assert.equal(biller.get('03'), 'ORD131126000123')
})

t('ยอดทศนิยมปัดเป็นสองตำแหน่ง', () => {
  const root = parse(promptPayBillerPayload('014000000517185', '99.5', 'ORD131126000123'))
  assert.equal(root.get('54'), '99.50')
})

t('ไม่ระบุยอด = QR ไม่ล็อกยอด (01 = 11 และไม่มี tag 54)', () => {
  const root = parse(promptPayBillerPayload('014000000517185', null, 'POS13112600123'))
  assert.equal(root.get('01'), '11')
  assert.equal(root.has('54'), false)
})

t('ข้อมูลไม่ถูกต้องคืน null', () => {
  assert.equal(promptPayBillerPayload('12345', 100, 'ORD131126000123'), null)
  assert.equal(promptPayBillerPayload('014000000517185', 100, 'OR-131126-000123'), null)
  assert.equal(promptPayBillerPayload('014000000517185', 0, 'ORD131126000123'), null)
  assert.equal(promptPayBillerPayload('014000000517185', 10000000, 'ORD131126000123'), null)
})

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exitCode = fail ? 1 : 0
