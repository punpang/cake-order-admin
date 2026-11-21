// ทดสอบการตั้งค่าการพิมพ์ 5 ส่วน · รัน: node src/lib/printConfig.test.mjs
import assert from 'node:assert/strict'
import { defaultDevice, normalizeDevice, migrateDevice, printerFor, widthFor, webWidthFor, autoPrintFor, pxFor, normalizePrinting, clampCopies } from './printConfig.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }
const A = { name: 'เครื่อง A', address: 'AA:01' }
const B = { name: 'เครื่อง B', address: 'BB:02' }

t('ความกว้างกระดาษ: 58 = 384 จุด, 80 = 576 จุด, 88 และค่าอื่นโยน error', () => {
  assert.equal(pxFor(58), 384)
  assert.equal(pxFor(80), 576)
  assert.throws(() => pxFor(88), /ไม่รองรับ/)
  assert.throws(() => pxFor(undefined), /ไม่รองรับ/)
})

t('ค่าเริ่มต้นของเครื่อง: ยังไม่มีเครื่องพิมพ์, 58 มม., เว็บตาม auto, พิมพ์อัตโนมัติเปิด', () => {
  const d = normalizeDevice(null)
  assert.deepEqual(d, defaultDevice())
  assert.equal(printerFor(d, 'posReceipt'), null)
  assert.equal(widthFor(d, 'posReceipt'), 58)
  assert.equal(webWidthFor(d, 'orderReceipt'), 'auto')
  assert.equal(autoPrintFor(d, 'posReceipt'), true)
})

t('normalize ทิ้งค่าที่ไม่รู้จัก (88 มม., ความกว้างเว็บแปลก ๆ)', () => {
  const d = normalizeDevice({ widthMm: { posReceipt: 88, orderReceipt: 80 }, webWidth: { posReceipt: 'foo', orderReceipt: 58 } })
  assert.equal(widthFor(d, 'posReceipt'), 58)
  assert.equal(widthFor(d, 'orderReceipt'), 80)
  assert.equal(webWidthFor(d, 'posReceipt'), 'auto')
  assert.equal(webWidthFor(d, 'orderReceipt'), 58)
})

t('ย้ายค่าเวอร์ชันเดิม: เครื่องพิมพ์และความกว้างเดียว → ใบเสร็จทั้งสองส่วน, ใบกำกับตามใบเสร็จ', () => {
  const d = migrateDevice({ printer: A, widthMm: 80 })
  assert.equal(printerFor(d, 'posReceipt').address, 'AA:01')
  assert.equal(printerFor(d, 'orderReceipt').address, 'AA:01')
  assert.equal(printerFor(d, 'taxInvoice').address, 'AA:01')
  assert.equal(widthFor(d, 'orderReceipt'), 80)
  assert.equal(widthFor(d, 'taxInvoice'), 80)
})

t('ไม่มีค่าเวอร์ชันเดิม → ค่าเริ่มต้น', () => {
  assert.deepEqual(migrateDevice(null), defaultDevice())
  assert.deepEqual(migrateDevice('ผิดรูปแบบ'), defaultDevice())
})

t('ใบกำกับตั้งเครื่องแยกได้ และถ้าไม่ตั้งจะใช้เครื่องของใบเสร็จ', () => {
  const d = normalizeDevice({ printers: { posReceipt: A, taxInvoice: B }, widthMm: { posReceipt: 58, taxInvoice: 80 } })
  assert.equal(printerFor(d, 'taxInvoice').address, 'BB:02')
  assert.equal(widthFor(d, 'taxInvoice'), 80)
  assert.equal(widthFor(d, 'posReceipt'), 58)
  const inherit = normalizeDevice({ printers: { posReceipt: A } })
  assert.equal(printerFor(inherit, 'taxInvoice').address, 'AA:01')
  assert.equal(widthFor(inherit, 'taxInvoice'), 58)
  assert.equal(printerFor(normalizeDevice(null), 'orderReceipt'), null)
})

t('แยกเครื่องพิมพ์ของแต่ละส่วนได้อิสระ', () => {
  const d = normalizeDevice({ printers: { posReceipt: A, orderReceipt: B } })
  assert.equal(printerFor(d, 'posReceipt').address, 'AA:01')
  assert.equal(printerFor(d, 'orderReceipt').address, 'BB:02')
})

t('พิมพ์อัตโนมัติปิดได้ต่อส่วน', () => {
  const d = normalizeDevice({ autoPrint: { posReceipt: false } })
  assert.equal(autoPrintFor(d, 'posReceipt'), false)
  assert.equal(autoPrintFor(d, 'orderReceipt'), true)
})

t('จำนวนชุดหนีบอยู่ในช่วง 1–3 และค่าว่างเป็น 1', () => {
  assert.equal(clampCopies(0), 1)
  assert.equal(clampCopies(5), 3)
  assert.equal(clampCopies(2.4), 2)
  assert.equal(clampCopies('x'), 1)
  assert.equal(clampCopies(undefined), 1)
  assert.deepEqual(normalizePrinting(null), { copies: { posReceipt: 1, orderReceipt: 1 } })
  assert.deepEqual(normalizePrinting({ copies: { posReceipt: 9 } }), { copies: { posReceipt: 3, orderReceipt: 1 } })
})

console.log(`\n✓ ผ่าน ${pass} กรณี`)
