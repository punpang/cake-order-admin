// ทดสอบการเลือกออร์เดอร์ที่แจ้ง "งานใกล้เวลาต้องเสร็จ" · รัน: node src/lib/dueSoon.test.mjs
import assert from 'node:assert/strict'
import { isDueSoonEligible } from './dueSoon.js'

const yes = ['order_confirmed', 'preparing', 'prepared', 'ready_to_ship', 'shipping']
const no = ['draft', 'awaiting_payment', 'payment_reported', 'payment_confirmed', 'delivered', 'cancelled']
let fail = 0
for (const s of yes) if (!isDueSoonEligible({ status: s })) { fail++; console.log(`FAIL ควรแจ้ง: ${s}`) }
for (const s of no) if (isDueSoonEligible({ status: s })) { fail++; console.log(`FAIL ไม่ควรแจ้ง: ${s}`) }
if (isDueSoonEligible(null) || isDueSoonEligible({})) { fail++; console.log('FAIL ออร์เดอร์ว่างต้องไม่แจ้ง') }
// ออร์เดอร์ที่ยังไม่ชำระ (แจ้งยอดแล้ว) ต้องไม่ถูกแจ้ง แม้เวลาจะใกล้
assert.equal(isDueSoonEligible({ status: 'payment_reported', balance: 250 }), false)
console.log(fail ? `ไม่ผ่าน ${fail} กรณี` : `ผ่านทั้งหมด ${yes.length + no.length + 2} กรณี`)
process.exitCode = fail ? 1 : 0
