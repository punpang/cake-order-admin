// ทดสอบสิทธิ์ managePreorder (สั่งล่วงหน้า) · รัน: node src/lib/preorderPerm.test.mjs
import assert from 'node:assert/strict'
import { PERMISSIONS, ALL_PERMS, PERM_GROUPS, rolePreset } from './constants.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('managePreorder ค่าตั้งต้นเฉพาะแอดมิน', () => {
  assert.deepEqual(PERMISSIONS.managePreorder, ['admin'])
})
t('อยู่ในรายการสิทธิ์ทั้งหมดและในชุดของบทบาท', () => {
  assert.ok(ALL_PERMS.includes('managePreorder'))
  assert.ok(rolePreset('admin').includes('managePreorder'))
  assert.ok(!rolePreset('sales').includes('managePreorder'))
})
t('มีในหน้าติ๊กสิทธิ์ (PERM_GROUPS) เพียงครั้งเดียว', () => {
  const hits = PERM_GROUPS.flatMap((g) => g.items).filter((i) => i.key === 'managePreorder')
  assert.equal(hits.length, 1)
  assert.ok(hits[0].label.length > 0)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
