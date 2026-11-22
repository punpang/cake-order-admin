// ทดสอบการคำนวณหน้าครัว: รายการเตรียม · วัตถุดิบรวม · สูตรที่ยังไม่มี · ต้องซื้อเพิ่ม · รัน: node src/lib/materials.test.mjs
import assert from 'node:assert/strict'
import { missingRecipes, ordersMaterials, prepList, shortfall } from './materials.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const r = (ingredientId, qty, per = 'pound') => ({ ingredientId, qty, per })
const groups = [
  { id: 'g_size', key: 'size', name: 'ขนาด', type: 'single', options: [{ id: 's1', name: '1 ปอนด์', pounds: 1 }, { id: 's2', name: '2 ปอนด์', pounds: 2 }] },
  { id: 'g_sponge', key: 'flavor', name: 'เนื้อเค้ก', type: 'single', perTier: true, options: [
    { id: 'sp1', name: 'วานิลลา', recipe: [r('m1', 150), r('m3', 3, 'piece')] },
    { id: 'sp2', name: 'ช็อกโกแลต' },
  ] },
  { id: 'g_type', key: 'type', name: 'ประเภท', type: 'single', prepList: true, perTier: true, options: [{ id: 't1', name: 'เค้กครีม', recipe: [r('m5', 200)] }] },
  { id: 'g_deco', key: 'deco', name: 'ตกแต่ง', type: 'multi', prepList: true, perTier: true, options: [{ id: 'd1', name: 'ดอกไม้ครีม' }, { id: 'd2', name: 'โบว์', recipe: [r('m9', 1, 'piece')] }] },
  { id: 'g_color', key: 'color', name: 'สีธีม', type: 'text', perTier: true },
]
const custom = (qty, selections = {}) => ({ kind: 'custom', name: 'เค้กวันเกิด', qty, selections: { g_size: 's2', g_sponge: 'sp1', g_type: 't1', ...selections } })
const retail = (qty) => ({ kind: 'retail', name: 'เค้กส้ม', retailId: 'rt9', retailPrice: 450, sizeId: 's1', qty, selections: {} })

t('prepList: เค้กสั่งทำนับเป็นก้อนต่อชั้น แยกตามเนื้อเค้กและขนาด', () => {
  const p = prepList([{ items: [custom(2)] }], groups, [])
  assert.deepEqual(p.cakes, [{ name: 'สั่งทำ · วานิลลา', pounds: 2, count: 2, kind: 'custom', flavor: 'วานิลลา' }])
})

t('prepList: ไม่ระบุเนื้อเค้กแสดงเป็นไม่ระบุ', () => {
  const p = prepList([{ items: [custom(1, { g_sponge: undefined })] }], groups, [])
  assert.deepEqual(p.cakes, [{ name: 'สั่งทำ · ไม่ระบุเนื้อเค้ก', pounds: 2, count: 1, kind: 'custom', flavor: 'ไม่ระบุเนื้อเค้ก' }])
})

t('prepList: เค้กสำเร็จรูปนับตามชื่อและขนาด', () => {
  assert.deepEqual(prepList([{ items: [retail(1)] }], groups, []).cakes, [{ name: 'เค้กส้ม', pounds: 1, count: 1, kind: 'ready' }])
})

t('prepList: แยกเค้กสั่งทำ (custom) กับสำเร็จ (ready) ด้วยฟิลด์ kind', () => {
  const p = prepList([{ items: [custom(1), retail(2)] }], groups, [])
  assert.deepEqual(p.cakes.map((x) => `${x.kind}:${x.name}`).sort(), ['custom:สั่งทำ · วานิลลา', 'ready:เค้กส้ม'])
})

t('prepList: กลุ่มที่เปิดรายการเตรียมนับเป็นชุด เฉพาะตัวเลือกที่เลือก', () => {
  const p = prepList([{ items: [custom(2, { g_deco: ['d1', 'd2'] })] }], groups, [])
  const got = Object.fromEntries(p.groups.map((g) => [g.name, Object.fromEntries(g.rows.map((x) => [x.name, [x.pounds, x.count]]))]))
  assert.deepEqual(got, { ประเภท: { เค้กครีม: [2, 2] }, ตกแต่ง: { ดอกไม้ครีม: [2, 2], โบว์: [2, 2] } })
})

t('ordersMaterials: สูตรต่อปอนด์คูณปอนด์ สูตรต่อชิ้นคงที่ แล้วคูณจำนวนรายการ', () => {
  assert.deepEqual(ordersMaterials([{ items: [custom(2)] }], groups, []), { m1: 600, m3: 6, m5: 800 })
})

t('ordersMaterials: สินค้าสำเร็จรูปใช้สูตรของตัวสินค้า', () => {
  const products = [{ id: 'rt9', recipe: [r('m1', 160)] }]
  assert.deepEqual(ordersMaterials([{ items: [retail(2)] }], groups, products), { m1: 320 })
})

t('missingRecipes: ตัวเลือกและสินค้าที่ไม่มีสูตร (ไม่รวมขนาดและข้อความ)', () => {
  const products = [{ id: 'rt9', recipe: [r('m1', 160)] }, { id: 'rt1' }]
  const orders = [
    { items: [custom(1, { g_sponge: 'sp2', g_deco: ['d1', 'd2'] })] },
    { items: [{ kind: 'retail', name: 'คัพเค้ก', retailId: 'rt1', sizeId: 's1', qty: 1, selections: {} }, retail(1)] },
  ]
  assert.deepEqual(missingRecipes(orders, groups, products).sort(), ['คัพเค้ก', 'ช็อกโกแลต', 'ดอกไม้ครีม'])
})

t('shortfall: ต้องซื้อเพิ่ม = ต้องใช้ − คงเหลือ ไม่ติดลบ และไม่คำนวณถ้ายังไม่ได้นับ', () => {
  assert.equal(shortfall(500, 300), 200)
  assert.equal(shortfall(100, 300), 0)
  assert.equal(shortfall(100, 0), 100)
  assert.equal(shortfall(100, null), null)
  assert.equal(shortfall(100, undefined), null)
})

console.log(fail ? `\n✗ ล้ม ${fail} ข้อ` : '\n✓ ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
