// ทดสอบบันเดิ้ลทางเลือก ราคาที่แนะนำ และการกันชุดซ้ำ · รัน: node src/lib/bundleAdvice.test.mjs
import assert from 'node:assert/strict'
import { autoBundleName, checkBundle, findDuplicate } from './bundleEditor.js'
import { comboSuggestions, maxPct, recommendPrice, subSuggestions } from './bundleAdvice.js'

let fail = 0
const t = (name, fn) => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

// ข้อมูลแบบเดียวกับกลุ่ม "ขอบบนเค้ก": เชอร์รี่ คิทแคท โอริโอ้ ราคา 50/80/100 · ไวท์ช็อกไม่มีราคา 3 ปอนด์ · ครีมราคาคงที่ 20
const G = 'g_top'
const it = (optionId) => ({ groupId: G, optionId })
const C = it('c')
const K = it('k')
const O = it('o')
const W = it('w')
const F = { groupId: 'g_fix', optionId: 'f' }
const groups = [
  {
    id: G, name: 'ขอบบนเค้ก', options: [
      { id: 'c', name: 'เชอร์รี่', active: true, priceType: 'size', sizePrices: { s1: 50, s2: 80, s3: 100 } },
      { id: 'k', name: 'คิทแคท', active: true, priceType: 'size', sizePrices: { s1: 50, s2: 80, s3: 100 } },
      { id: 'o', name: 'โอริโอ้', active: true, priceType: 'size', sizePrices: { s1: 50, s2: 80, s3: 100 } },
      { id: 'w', name: 'ไวท์ช็อก', active: true, priceType: 'size', sizePrices: { s1: 50, s2: 80 } },
    ],
  },
  { id: 'g_fix', name: 'ของเสริม', options: [{ id: 'f', name: 'ครีม', active: true, priceType: 'fixed', price: 20 }] },
]
const sizes = [{ id: 's1', name: '1 ปอนด์' }, { id: 's2', name: '2 ปอนด์' }, { id: 's3', name: '3 ปอนด์' }]
const types = [{ id: 't1', name: 'เค้กครีมนมสด', active: true }, { id: 't2', name: 'เค้กหน้านิ่ม', active: true }]
const TYPES = ['t1', 't2']
const bundle = (id, items, discount, extra = {}) => ({ id, name: autoBundleName(items, groups), items, types: [], active: true, discount, typeDiscount: {}, styleDiscount: {}, styleMode: {}, ...extra })
const ctx = (over = {}) => ({ groups, sizes, types, styles: [], bundles: [], ...over })
const rec = (items, bundles = [], extra = {}) => recommendPrice(items, { groups, sizes, bundles, types: [], allTypeIds: TYPES, ...extra })

t('บันเดิ้ลทางเลือก: เลือก 3 อย่าง → 3 ชุดคู่ตามลำดับ · เลือก 4 อย่าง → 6 ชุดคู่ + 4 ชุดสาม · น้อยกว่า 3 หรือเกินเพดานไม่แยก', () => {
  assert.deepEqual(comboSuggestions([C, K, O]).map((x) => autoBundleName(x, groups)), ['เชอร์รี่ + คิทแคท', 'เชอร์รี่ + โอริโอ้', 'คิทแคท + โอริโอ้'])
  const four = comboSuggestions([C, K, O, W])
  assert.equal(four.filter((x) => x.length === 2).length, 6)
  assert.equal(four.filter((x) => x.length === 3).length, 4)
  assert.deepEqual(comboSuggestions([C, K]), [])
  assert.deepEqual(comboSuggestions([C, K, O, W, it('x'), it('y'), it('z')]), [])
})

t('ชุดซ้ำ: ตัวเลือกชุดเดียวกันไม่สนลำดับและประเภท · ไม่นับชุดตัวเอง · ไม่มีตัวเลือกไม่นับ', () => {
  const list = [bundle('b1', [K, C], { s1: 10 }, { types: ['t1'] })]
  assert.equal(findDuplicate([C, K], list)?.id, 'b1')
  assert.equal(findDuplicate([C, K], list, 'b1'), null)
  assert.equal(findDuplicate([C, O], list), null)
  assert.equal(findDuplicate([], [bundle('e', [], {})]), null)
})

t('กันชุดซ้ำ: ชุดใหม่ที่ซ้ำ = บันทึกไม่ได้ · แก้ราคาของชุดซ้ำเดิมได้ · แก้ตัวเลือกจนซ้ำ = บันทึกไม่ได้', () => {
  const list = [bundle('b1', [C, K], { s1: 10 }), bundle('b2', [C, K], { s1: 20 })] // ซ้ำกันอยู่แล้ว (ข้อมูลเก่า)
  const fresh = { id: null, name: '', items: [K, C], discount: { s1: 5 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true }
  assert.ok(checkBundle(fresh, ctx({ bundles: list })).errors.some((e) => e.includes('ซ้ำกับบันเดิ้ล')))
  // แก้ราคาของชุดซ้ำเดิม (ตัวเลือกเหมือนเดิม) → บันทึกได้
  assert.deepEqual(checkBundle({ ...list[1], discount: { s1: 15 } }, ctx({ bundles: list, original: list[1] })).errors, [])
  // เปลี่ยนตัวเลือกของ b3 ให้ไปซ้ำกับ b1 → บันทึกไม่ได้
  const b3 = bundle('b3', [C, O], { s1: 10 })
  assert.ok(checkBundle({ ...b3, items: [K, C] }, ctx({ bundles: [...list, b3], original: b3 })).errors.some((e) => e.includes('ซ้ำ')))
  // เปลี่ยนตัวเลือกไปชุดที่ไม่ซ้ำ → บันทึกได้
  assert.deepEqual(checkBundle({ ...b3, items: [K, O] }, ctx({ bundles: [...list, b3], original: b3 })).errors, [])
})

t('ราคาที่แนะนำ: ชุด 2 อย่างไม่มีความสัมพันธ์ → ลด 10% ทุกขนาด ปัดเป็นบาทเต็ม', () => {
  const r = rec([C, K])
  assert.equal(r.pct, 10)
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.amounts, { s1: 10, s2: 16, s3: 20 })
  assert.deepEqual(r.sample, { size: '1 ปอนด์', regular: 100, net: 90 })
  assert.deepEqual(r.conflicts, [])
})

t('ชุด 3 อย่าง: ชุดคู่ที่ลด 100% อยู่ → ชุดนี้ลดได้ไม่ถึง ต้องปรับชุดคู่ก่อน (ขั้นพื้นฐาน 15%)', () => {
  const bs = [bundle('p1', [C, K], { s1: 100 }), bundle('p2', [C, O], { s1: 100 }), bundle('p3', [K, O], { s1: 100 })]
  const r = rec([C, K, O], bs)
  assert.equal(r.status, 'conflict')
  assert.equal(r.pct, 15)
  assert.equal(r.conflicts.length, 3)
  assert.ok(r.conflicts[0].includes('เป็น 10%'))
})

t('ชุด 3 อย่าง: ชุดคู่ลด 10% แล้ว → ชุดนี้ 15% ใช้ได้ทันที และปัดส่วนลดเป็นบาทเต็ม', () => {
  const bs = [bundle('p1', [C, K], { s1: 10 }), bundle('p2', [C, O], { s1: 10 }), bundle('p3', [K, O], { s1: 10 })]
  const r = rec([C, K, O], bs)
  assert.equal(r.status, 'ok')
  assert.equal(r.pct, 15)
  assert.deepEqual(r.conflicts, [])
  assert.equal(r.amounts.s1, 23) // 150 × 15% = 22.5 → 23
})

t('ชุดใหญ่ที่ลดจนเหลือ 0 บาท: ชุดนี้จะถูกกว่าชุดใหญ่ไม่ได้ → สถานะขัดแย้ง ไม่แนะนำส่วนลด ให้ปรับชุดใหญ่ก่อน', () => {
  const r = rec([C, K], [bundle('t', [C, K, O], { s1: 150 })])
  assert.equal(r.status, 'conflict')
  assert.equal(r.pct, 0)
  assert.ok(r.conflicts.some((c) => c.includes('ปรับ') && c.includes('0 ฿')))
  assert.equal(r.balanced, false)
})

t('ชุดคู่ที่ชุดใหญ่ลดแค่ 10%: ชุดนี้ต้องลดน้อยกว่า → ปรับลงเป็น 5%', () => {
  const r = rec([C, K], [bundle('t', [C, K, O], { s1: 15 })]) // 15 ÷ 150 = 10%
  assert.equal(r.pct, 5)
  assert.equal(r.status, 'adjusted')
  assert.ok(r.reasons.some((x) => x.includes('ปรับลงเป็น 5%')))
})

t('ชุดที่ปิดอยู่หรือจำกัดประเภทคนละกลุ่ม ไม่กระทบราคาที่แนะนำ', () => {
  const off = bundle('x', [C, K, O], { s1: 150 }, { active: false })
  const otherType = bundle('y', [C, K, O], { s1: 150 }, { types: ['t2'] })
  const r = recommendPrice([C, K], { groups, sizes, bundles: [off, otherType], types: ['t1'], allTypeIds: TYPES })
  assert.equal(r.pct, 10)
  assert.equal(r.status, 'ok')
})

t('ตัวเลือกที่ยังไม่มีราคาขนาดนั้น → ไม่ลดขนาดนั้น และมีคำเตือน', () => {
  const r = rec([C, W])
  assert.equal(r.amounts.s3, 0)
  assert.ok(r.amounts.s1 > 0)
  assert.ok(r.warnings.some((w) => w.includes('ไวท์ช็อก') && w.includes('3 ปอนด์')))
})

t('ตัวเลือกราคาคงที่ใช้ราคาเดียวทุกขนาด', () => {
  const r = rec([C, F])
  assert.equal(r.regular.s1, 70)
  assert.deepEqual(r.amounts, { s1: 7, s2: 10, s3: 12 })
})

t('เทียบชุดอื่นที่มีจำนวนตัวเลือกเท่ากัน: เหตุผลแสดงค่ากลางการลด', () => {
  const r = rec([C, K], [bundle('p', [K, O], { s1: 20, s2: 32, s3: 40 })])
  assert.ok(r.reasons.some((x) => x.includes('ลดเฉลี่ย 20%')))
})

t('บันเดิ้ลทางเลือก: ชุดที่มีอยู่แล้วบอกราคาเดิม และไม่นับตัวเองเมื่อแนะนำ', () => {
  const subs = subSuggestions([C, K, O], { groups, sizes, bundles: [bundle('p1', [C, K], { s1: 100 })], types: [], allTypeIds: TYPES })
  assert.equal(subs.length, 3)
  const ck = subs.find((s) => s.name === 'เชอร์รี่ + คิทแคท')
  assert.equal(ck.existing.id, 'p1')
  assert.equal(ck.current, 100)
  assert.equal(ck.rec.pct, 10)
  const co = subs.find((s) => s.name === 'เชอร์รี่ + โอริโอ้')
  assert.equal(co.existing, null)
  assert.equal(co.rec.pct, 10)
  assert.equal(maxPct(bundle('z', [C, K], {}), groups, sizes, [], TYPES), 0)
})

t('ชุดจากข้อเสนอผ่านการตรวจ (ไม่ลดเกินราคาปกติ และไม่ซ้ำ)', () => {
  const r = rec([C, K])
  const data = {
    id: null, name: autoBundleName([C, K], groups), items: [C, K], types: [], active: true,
    discount: Object.fromEntries(Object.entries(r.amounts).map(([k, v]) => [k, String(v)])),
    typeDiscount: {}, styleDiscount: {}, styleMode: {},
  }
  assert.deepEqual(checkBundle(data, ctx({ bundles: [] })).errors, [])
})

t('ชุดย่อยลดประมาณ 17%: เมื่อสมดุลราคาเปิดช่อง ชุดนี้ลดมากกว่าเป็น 25% (ชุดใหญ่ลดมากกว่าชุดย่อยเสมอ)', () => {
  const r = rec([C, K, O], [bundle('p', [K, O], { s1: 17, s2: 27, s3: 34 })])
  assert.equal(r.pct, 25)
  assert.equal(r.status, 'adjusted')
  assert.ok(r.reasons.some((x) => x.includes('ปรับขึ้นเป็น 25%')))
  assert.equal(r.balanced, true)
})

t('ชุดย่อยลดประมาณ 17% แต่ตัวเลือกเดี่ยวทำให้ลดได้ไม่เกิน 24% → ลดสูงสุดตามเพดาน (20%) พร้อมเหตุผล', () => {
  const r = rec([C, K, F], [bundle('p', [C, K], { s1: 17, s2: 27, s3: 34 })])
  assert.equal(r.status, 'capped')
  assert.equal(r.pct, 20)
  assert.ok(r.reasons.some((x) => x.includes('ลดได้ไม่เกิน 24%')))
  assert.equal(r.balanced, true)
})

t('ชุดใหญ่เหลือราคาน้อย → ชุดนี้ต้องลดอย่างน้อย 16% ให้ต่ำกว่าชุดใหญ่ (ขั้นบันไดแนะนำ 20%)', () => {
  const r = rec([C, K], [bundle('t', [C, K, O], { s1: 65 })]) // ชุดใหญ่เหลือ 85 ฿ (1 ปอนด์)
  assert.equal(r.pct, 20)
  assert.equal(r.status, 'adjusted')
  assert.ok(r.reasons.some((x) => x.includes('ต้องลดอย่างน้อย 16%')))
  assert.equal(r.balanced, true)
})

t('ตัวเลือกราคา 0 ฿ (เช่น ครีมฟรี) ทำให้ชุดที่มีมันลดไม่ได้ → ขัดแย้ง และบอกชื่อตัวเลือกนั้น', () => {
  const free = { id: 'g_free', name: 'ของฟรี', options: [{ id: 'z', name: 'ครีมฟรี', active: true, priceType: 'fixed', price: 0 }] }
  const Z = { groupId: 'g_free', optionId: 'z' }
  const r = recommendPrice([K, Z], { groups: [...groups, free], sizes, bundles: [], types: [], allTypeIds: TYPES })
  assert.equal(r.status, 'conflict')
  assert.equal(r.pct, 0)
  assert.ok(r.conflicts.some((c) => c.includes('ครีมฟรี') && c.includes('0 ฿')))
})

t('กติการาคา 0 ฿: ชุด 3 อย่างที่มีตัวเลือก 0 ฿ สร้างไม่ได้ แม้ชุดย่อยที่ไม่มีตัวเลือกนั้นจะลดแล้ว', () => {
  const free = { id: 'g_free', name: 'ของฟรี', options: [{ id: 'z', name: 'ครีมฟรี', active: true, priceType: 'fixed', price: 0 }] }
  const Z = { groupId: 'g_free', optionId: 'z' }
  const r = recommendPrice([C, K, Z], { groups: [...groups, free], sizes, bundles: [bundle('p', [C, K], { s1: 10 })], types: [], allTypeIds: TYPES })
  assert.equal(r.status, 'conflict')
  assert.equal(r.pct, 0)
  assert.equal(r.balanced, false)
  assert.deepEqual(r.amounts, { s1: 0, s2: 0, s3: 0 })
  assert.equal(r.conflicts.length, 1)
  assert.ok(r.conflicts[0].includes('ครีมฟรี') && r.conflicts[0].includes('ราคา 0 ฿'))
})

t('กติการาคา 0 ฿ ตอนบันทึก: ชุดใหม่ที่มี 0 ฿ บันทึกไม่ได้ · ชุดเดิมแก้ส่วนลดได้ (มีคำเตือน) · เปลี่ยนตัวเลือกให้มี 0 ฿ ไม่ได้', () => {
  const free = { id: 'g_free', name: 'ของฟรี', options: [{ id: 'z', name: 'ครีมฟรี', active: true, priceType: 'fixed', price: 0 }] }
  const Z = { groupId: 'g_free', optionId: 'z' }
  const gs = [...groups, free]
  const fresh = { id: null, name: '', items: [C, Z], discount: { s1: 5 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true }
  assert.ok(checkBundle(fresh, ctx({ groups: gs })).errors.some((e) => e.includes('ครีมฟรี') && e.includes('ราคา 0 ฿')))
  const legacy = { ...fresh, id: 'L', name: 'เก่า' }
  const kept = checkBundle({ ...legacy, discount: { s1: 8 } }, ctx({ groups: gs, bundles: [legacy], original: legacy }))
  assert.deepEqual(kept.errors, [])
  assert.ok(kept.warnings.some((w) => w.includes('ครีมฟรี')))
  assert.ok(checkBundle({ ...legacy, items: [C, K, Z] }, ctx({ groups: gs, original: { ...legacy, items: [C, K] } })).errors.some((e) => e.includes('ครีมฟรี')))
})

t('กติการาคา 0 ฿: ราคาเป็น 0 เฉพาะประเภทที่ชุดใช้ได้ก็นับ · ประเภทที่ชุดไม่ใช้ไม่นับ', () => {
  const gp = [...groups, { id: 'g_p', name: 'พิเศษ', options: [{ id: 'y', name: 'ของพิเศษ', active: true, priceType: 'fixed', price: 30, typePrice: { t2: 0 } }] }]
  const Y = { groupId: 'g_p', optionId: 'y' }
  const base = { id: null, name: '', items: [C, Y], discount: { s1: 5 }, types: ['t2'], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true }
  assert.ok(checkBundle(base, ctx({ groups: gp })).errors.some((e) => e.includes('ของพิเศษ')))
  assert.equal(checkBundle({ ...base, types: ['t1'] }, ctx({ groups: gp })).errors.some((e) => e.includes('ของพิเศษ')), false)
})

t('บันเดิ้ลทางเลือก: ชุดที่มีตัวเลือก 0 ฿ ไม่ถูกแนะนำให้สร้าง · ชุดที่ไม่มีตัวเลือกนั้นยังแนะนำได้ตามปกติ', () => {
  const free = { id: 'g_free', name: 'ของฟรี', options: [{ id: 'z', name: 'ครีมฟรี', active: true, priceType: 'fixed', price: 0 }] }
  const Z = { groupId: 'g_free', optionId: 'z' }
  const subs = subSuggestions([C, K, Z], { groups: [...groups, free], sizes, bundles: [], types: [], allTypeIds: TYPES })
  assert.equal(subs.length, 3)
  const withZ = subs.filter((s) => s.items.some((x) => x.optionId === 'z'))
  assert.equal(withZ.length, 2)
  assert.ok(withZ.every((s) => s.rec.status === 'conflict' && s.rec.pct === 0))
  const ck = subs.find((s) => s.name === 'เชอร์รี่ + คิทแคท')
  assert.equal(ck.rec.pct, 10)
  assert.notEqual(ck.rec.status, 'conflict')
})

t('ตรวจสมดุลซ้ำกับตัวอย่างสุ่ม 400 ชุด: ผลที่สมดุลต้องให้ทุกชุดย่อยถูกกว่าและทุกชุดใหญ่แพงกว่าเป็นบาททุกขนาด · ผลที่ไม่สมดุลต้องขึ้นสถานะขัดแย้ง', () => {
  let seed = 20240601
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const SIZES = ['s1', 's2', 's3']
  const SIZE_OPTS = [{ id: 's1', name: '1 ปอนด์' }, { id: 's2', name: '2 ปอนด์' }, { id: 's3', name: '3 ปอนด์' }]
  const G2 = [{
    id: 'g', name: 'กลุ่ม', options: [
      ...['a', 'b', 'c', 'd', 'e'].map((id) => {
        const s1 = 5 * int(2, 30)
        const s2 = s1 + 5 * int(0, 20)
        const s3 = s2 + 5 * int(0, 30)
        return { id, name: id, active: true, priceType: 'size', sizePrices: { s1, s2, s3 } }
      }),
      { id: 'f', name: 'f', active: true, priceType: 'fixed', price: 5 * int(1, 10) },
    ],
  }]
  const allRefs = G2[0].options.map((o) => ({ groupId: 'g', optionId: o.id }))
  const optOf = (x) => G2[0].options.find((o) => o.id === x.optionId)
  const priceOf = (o, s) => (o.priceType === 'fixed' ? o.price : o.sizePrices[s])
  const sumOf = (xs, s) => xs.reduce((acc, x) => acc + priceOf(optOf(x), s), 0)
  const keyIds = (xs) => [...new Set(xs.map((x) => x.optionId))].sort().join('|')
  const takeRandom = (pool, k) => {
    const out = []
    while (out.length < k) out.push(pool.splice(int(0, pool.length - 1), 1)[0])
    return out
  }
  const TRIALS = 400
  let balancedCount = 0
  for (let trial = 0; trial < TRIALS; trial++) {
    const items = takeRandom([...allRefs], int(2, 4))
    const bundles = []
    const nb = int(0, 5)
    for (let i = 0; i < nb; i++) {
      const its = takeRandom([...allRefs], int(2, 4))
      const discount = {}
      for (const s of SIZES) if (rnd() < 0.7) discount[s] = int(0, Math.floor(sumOf(its, s) * 0.5))
      bundles.push({ id: `b${i}`, name: `ชุด${i}`, items: its, types: [], active: true, discount, typeDiscount: {}, styleDiscount: {}, styleMode: {} })
    }
    const r = recommendPrice(items, { groups: G2, sizes: SIZE_OPTS, bundles, types: [], allTypeIds: [] })
    if (!r.balanced) {
      assert.equal(r.status, 'conflict', `ไม่สมดุลแต่สถานะไม่ใช่ conflict (trial ${trial})`)
      continue
    }
    balancedCount++
    for (const s of SIZES) {
      const netS = sumOf(items, s) - r.amounts[s]
      for (let mask = 1; mask < (1 << items.length) - 1; mask++) {
        const T = items.filter((_, i) => mask & (1 << i))
        const dT = bundles.filter((b) => keyIds(b.items) === keyIds(T)).reduce((m, b) => Math.max(m, b.discount[s] ?? 0), 0)
        const netT = sumOf(T, s) - dT
        assert.ok(netS > netT, `ชุดย่อยถูกกว่าชุดใหญ่ (${s}, trial ${trial}): ${netS} ≤ ${netT}`)
      }
      for (const b of bundles) {
        const bk = new Set(b.items.map((x) => x.optionId))
        if (bk.size <= items.length || !items.every((x) => bk.has(x.optionId))) continue
        const netU = sumOf(b.items, s) - (b.discount[s] ?? 0)
        assert.ok(netU > netS, `ชุดใหญ่ถูกกว่าชุดนี้ (${s}, trial ${trial}): ${netU} ≤ ${netS}`)
      }
    }
  }
  assert.ok(balancedCount > TRIALS / 2, `สมดุลได้เพียง ${balancedCount}/${TRIALS}`)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
