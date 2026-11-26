// ทดสอบการคำนวณการย้ายคะแนนจากระบบเดิม: แต้ม = แต้มเดิม × 2 × ตัวคูณระดับสูงสุด · ยอดสะสม = เกณฑ์ระดับสูงสุด + 1
// รัน: node src/lib/legacyMigrate.test.mjs
import assert from 'node:assert/strict'
import { topLevelOf, legacyPointsOf, legacySpendOf } from './legacyMigrate.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }
const levels = [{ name: 'LV1', min: 0, mult: 1 }, { name: 'LV2', min: 500, mult: 2 }, { name: 'LV3', min: 2500, mult: 3 }, { name: 'LV4', min: 5000, mult: 5 }]

t('ระดับสูงสุดคือเกณฑ์ที่สูงที่สุด (LV4: 5,000 · ×5)', () => assert.deepEqual(topLevelOf(levels), { name: 'LV4', min: 5000, mult: 5 }))
t('เรียงลำดับไม่ตรงก็หาระดับสูงสุดได้', () => assert.equal(topLevelOf([levels[3], levels[0]]).name, 'LV4'))
t('ไม่มีระดับที่ใช้ได้ = null', () => { assert.equal(topLevelOf([]), null); assert.equal(topLevelOf(null), null) })
t('แต้ม = เดิม × 2 × 5 (10 แต้มเดิม → 100)', () => assert.equal(legacyPointsOf(10, 5), 100))
t('แต้มเดิม 1 → 10 แต้ม', () => assert.equal(legacyPointsOf(1, 5), 10))
t('แต้มเดิมไม่ใช่จำนวนเต็มบวก → null', () => { assert.equal(legacyPointsOf(0, 5), null); assert.equal(legacyPointsOf(1.5, 5), null); assert.equal(legacyPointsOf(-3, 5), null) })
t('ตัวคูณไม่ถูกต้อง → null', () => { assert.equal(legacyPointsOf(10, 0), null); assert.equal(legacyPointsOf(10, NaN), null) })
t('ยอดสะสม = เกณฑ์ LV4 + 1 = 5,001', () => assert.equal(legacySpendOf(5000), 5001))
t('ยอดสะสมเกณฑ์ไม่ถูกต้อง → null', () => { assert.equal(legacySpendOf(-1), null); assert.equal(legacySpendOf('x'), null) })

if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
