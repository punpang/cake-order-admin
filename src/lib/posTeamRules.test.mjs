// ทดสอบกฎแจ้งทีม (Telegram) เมื่อ POS ปิดบิล/ยกเลิกบิล/แลกสินค้ามีคืนเงิน · รัน: node src/lib/posTeamRules.test.mjs
import assert from 'node:assert/strict'
import { withNewRules } from './notifyPlan.js'
import { NOTIFY_EVENTS } from './constants.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// ตัวแปรที่ store.js ส่งมา (orderVars + ที่เพิ่มเอง) · ข้อความทีมต้องใช้เฉพาะตัวแปรเหล่านี้
const ORDER_VARS = ['ชื่อลูกค้า', 'เลขออร์เดอร์', 'ยอดรวม', 'คงค้าง', 'ชำระแล้ว', 'เหตุผล']
const ALLOWED = {
  team_pos_sale: [...ORDER_VARS, 'วิธีชำระ', 'บรรทัดส่วนลด', 'พนักงาน', 'เวลา'],
  team_pos_cancel: [...ORDER_VARS, 'บรรทัดคืนเงิน', 'บรรทัดหมายเหตุ', 'พนักงาน', 'เวลา'],
  team_pos_exchange: [...ORDER_VARS, 'เลขบิลใหม่', 'ยอดคืน', 'วิธีคืน', 'ยอดบิลใหม่', 'พนักงาน', 'เวลา'],
}
const rules = withNewRules([])

for (const ev of Object.keys(ALLOWED)) {
  t(`${ev}: อยู่ในรายการแจ้งทีม และส่งทาง Telegram เปิดใช้งาน`, () => {
    assert.equal(NOTIFY_EVENTS[ev]?.audience, 'team')
    const r = rules.find((x) => x.event === ev)
    assert.ok(r, 'ไม่พบกฎ')
    assert.deepEqual(r.channels, ['telegram'])
    assert.equal(r.enabled, true)
  })
  t(`${ev}: เทมเพลตใช้เฉพาะตัวแปรที่ส่งมาจริง`, () => {
    const tpl = rules.find((x) => x.event === ev).template
    const used = [...tpl.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1])
    const bad = used.filter((k) => !ALLOWED[ev].includes(k))
    assert.deepEqual(bad, [])
  })
}

if (fail) {
  console.log(`\n✗ ล้ม ${fail} ข้อ`)
  process.exit(1)
}
console.log('\n✓ ผ่านทั้งหมด')
