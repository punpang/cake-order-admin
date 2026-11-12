// ทดสอบการจัดกลุ่ม/ค้นหาหน้าตั้งค่า · รัน: node src/lib/settingsPages.test.mjs
import assert from 'node:assert/strict'
import { SETTINGS_PAGES, SETTINGS_GROUPS, groupSettings } from './settingsPages.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('ทุกหน้าอยู่ในกลุ่มที่มีจริง และไม่มีเส้นทางซ้ำ', () => {
  const keys = new Set(SETTINGS_GROUPS.map((g) => g.key))
  assert.ok(SETTINGS_PAGES.every((p) => keys.has(p.group)))
  assert.equal(new Set(SETTINGS_PAGES.map((p) => p.to)).size, SETTINGS_PAGES.length)
  assert.equal(groupSettings(SETTINGS_PAGES).reduce((n, g) => n + g.items.length, 0), SETTINGS_PAGES.length)
})
t('ค้นหาจากชื่อ คำอธิบาย และคำค้นเพิ่มเติม · กลุ่มว่างถูกตัดออก', () => {
  assert.deepEqual(groupSettings(SETTINGS_PAGES, 'พร้อมเพย์').flatMap((g) => g.items.map((p) => p.to)), ['/admin/settings/shop'])
  assert.deepEqual(groupSettings(SETTINGS_PAGES, ' AI ').flatMap((g) => g.items.map((p) => p.to)), ['/admin/settings/bot'])
  assert.deepEqual(groupSettings([{ group: 'team', to: '/x', title: 'ก', desc: 'รอ 3 คน' }], '3 คน').map((g) => g.key), ['team'])
  assert.deepEqual(groupSettings(SETTINGS_PAGES, 'ไม่มีคำนี้แน่นอน'), [])
})
t('หน้าที่ไม่มีสิทธิ์ (ถูกกรองออกก่อน) ไม่ทำให้เกิดกลุ่มว่าง', () => {
  const g = groupSettings(SETTINGS_PAGES.filter((p) => p.group !== 'team'))
  assert.ok(!g.some((x) => x.key === 'team'))
})
console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
