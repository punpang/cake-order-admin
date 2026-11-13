// ทดสอบรหัสอ้างอิงร้านค้า (ORD/POS) และรหัสร้านค้า: แปลงกับเลขเดิม · ติดธงเมื่อไม่ตรง · ใส่คีย์เฉพาะที่อ่านได้
import { assertEquals } from 'jsr:@std/assert@1'
import { codeOfRef, digitsOf, merchantMismatch, readShopFields, refOfCode, shopPartOf } from './slipref.ts'

Deno.test('รหัสอ้างอิงแปลงกลับไปเลขเดิมในระบบได้ (ORD ↔ OR, POS ↔ POS)', () => {
  assertEquals(refOfCode('OR-131126-000123'), 'ORD131126000123')
  assertEquals(codeOfRef('ORD131126000123'), 'OR-131126-000123')
  assertEquals(codeOfRef(' ord-131126 000123 '), 'OR-131126-000123')
  assertEquals(refOfCode('POS-131126-00123'), 'POS13112600123')
  assertEquals(codeOfRef('POS13112600123'), 'POS-131126-00123')
})

Deno.test('รหัสที่รูปแบบไม่ตรงกับเลขในระบบ → ไม่จับคู่', () => {
  assertEquals(codeOfRef('POS123927229'), null) // รหัสในสลิปตัวอย่าง ไม่ตรงรูปแบบเลขในระบบ
  assertEquals(codeOfRef('ORD12345'), null)
  assertEquals(codeOfRef(''), null)
})

Deno.test('ติดธงเมื่อตั้งรหัสร้านค้าไว้และไม่ตรง (หรืออ่านไม่ได้) · ยังไม่ตั้งรหัส = ไม่ตรวจ', () => {
  assertEquals(merchantMismatch('014000000517185', '014000000517185'), false)
  assertEquals(merchantMismatch('014-000-000-517185', '014000000517185'), false)
  assertEquals(merchantMismatch('014000000517185', '014000000517186'), true)
  assertEquals(merchantMismatch('014000000517185', null), true)
  assertEquals(merchantMismatch('', '014000000517186'), false)
})

Deno.test('ค่าจากตัวอ่าน: ใส่เฉพาะคีย์ที่อ่านได้ และรหัสอ้างอิงต้องเป็น POS/ORD ตามด้วยตัวเลข', () => {
  assertEquals(readShopFields({ merchant_code: '014 000 000 517185', shop_ref: 'pos123927229' }), { merchantCode: '014000000517185', shopRef: 'POS123927229' })
  assertEquals(readShopFields({ merchant_code: null, shop_ref: 'XYZ123' }), {})
  assertEquals(readShopFields({ merchant_code: '12', shop_ref: 'ORD131126000123' }), { shopRef: 'ORD131126000123' })
  assertEquals(shopPartOf({ merchantCode: '', shopRef: 'POS1' }), { shopRef: 'POS1' })
  assertEquals(digitsOf('0-1'), '01')
})

Deno.test('รหัสสุ่ม (Ref 2) จากตัวอ่าน: 12 ตัวตามชุดอักษรของระบบ (ตัดช่องว่างและขีด) · มี 0 หรือเป็นรูปแบบ POS/ORD ทิ้ง', () => {
  assertEquals(readShopFields({ qr_ref: 'k7m3-qrt2 xbhd' }), { qrRef: 'K7M3QRT2XBHD' })
  assertEquals(readShopFields({ qr_ref: 'K7M3QRT2XB0D' }), {})
  assertEquals(readShopFields({ qr_ref: 'POS123927229' }), {})
})

Deno.test('POS/ORD ใช้เฉพาะรหัสอ้างอิงร้านค้า (Ref 1): ไม่เป็นรหัสร้านค้า และไม่เป็นรหัสสุ่ม', () => {
  assertEquals(readShopFields({ merchant_code: 'ORD131126000741', shop_ref: null }), { shopRef: 'ORD131126000741' })
  assertEquals(readShopFields({ merchant_code: 'POS123927229', shop_ref: 'ORD131126000741' }), { shopRef: 'ORD131126000741' })
  assertEquals(readShopFields({ merchant_code: '014000000517185', shop_ref: 'ORD131126000741', qr_ref: 'ORD131126000741' }), { merchantCode: '014000000517185', shopRef: 'ORD131126000741' })
})
