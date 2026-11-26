// ทดสอบการกรองและการจัดกลุ่มรายการเลือกสินค้า (ส่วนลดเดือนเกิด)
// รัน: node src/lib/productPick.test.mjs
import assert from 'node:assert/strict'
import { groupPickItems, selectedPickCount } from './productPick.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

const items = [
  { id: 'a', name: 'เค้กช็อกโกแลต (ชิ้น)', category: 'เค้กชิ้น' },
  { id: 'b', name: 'เค้กส้ม (ชิ้น)', category: 'เค้กชิ้น' },
  { id: 'c', name: 'คัพเค้กวานิลลา', category: 'คัพเค้ก' },
  { id: 'd', name: 'ชาไทยเย็น' },
  { id: '', name: 'ไม่มีรหัส', category: 'เค้กชิ้น' },
]

t('จัดกลุ่มตามหมวด และข้ามรายการที่ไม่มีรหัส', () => {
  const g = groupPickItems(items)
  assert.deepEqual(g.map((x) => [x.category, x.items.length]), [['เค้กชิ้น', 2], ['คัพเค้ก', 1], ['ไม่มีหมวด', 1]])
})
t('นับที่เลือกในแต่ละหมวด', () => {
  const g = groupPickItems(items, { selected: ['a', 'c'] })
  assert.deepEqual(g.map((x) => x.selectedCount), [1, 1, 0])
})
t('ค้นหาไม่สนตัวพิมพ์เล็กใหญ่และตัดช่องว่างหัวท้าย', () => {
  const g = groupPickItems(items, { query: '  ส้ม  ' })
  assert.deepEqual(g.map((x) => x.items.map((i) => i.id)), [['b']])
})
t('ค้นหาไม่เจอ → ไม่มีกลุ่ม', () => assert.deepEqual(groupPickItems(items, { query: 'xyz' }), []))
t('ค่าว่างหรือไม่มีรายการ → ไม่พัง', () => {
  assert.deepEqual(groupPickItems(null), [])
  assert.deepEqual(groupPickItems(items, { query: null, selected: null }).length, 3)
})
t('นับจำนวนที่เลือกโดยไม่นับซ้ำ', () => {
  assert.equal(selectedPickCount(['a', 'a', 'c']), 2)
  assert.equal(selectedPickCount(null), 0)
})

if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
