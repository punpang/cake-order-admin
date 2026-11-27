// หน้าบันเดิ้ลแบบเลือกตัวเลือกหนึ่งตัว: หาชุดทั้งหมดที่มีตัวเลือกนั้น บอกว่าชุดไหนจะถูกข้ามเมื่อไร และตั้งส่วนลดต่อขนาด
// ลำดับการใช้ชุดตามโค้ดจริงใน pricing.js (bundleWinners): จำนวนตัวเลือกมากก่อน แล้วส่วนลดรวมมากก่อน และชุดที่ใช้ตัวเลือกซ้ำจะถูกข้าม
// ใช้ bundleAmount / regularTotal เดิม เพื่อให้ตัวเลขตรงกับที่ลูกค้าจ่าย · ไม่เปลี่ยนสูตรราคาและรูปแบบข้อมูล
import { bundleAmount } from './pricing.js'
import { regularTotal, makeDraft, autoBundleName } from './bundleEditor.js'

const keyOf = (x) => `${x.groupId}:${x.optionId}`
const sizeIdsOf = (sizes) => (sizes || []).map((s) => s.id)

// ยอดส่วนลดรวมของชุดในทุกขนาด (ช่องประเภท/รูปแบบไม่นับที่นี่ เพราะหน้านี้แก้เฉพาะช่องทุกชนิด)
const totalOf = (b, sizeIds) => sizeIds.reduce((s, sid) => s + (bundleAmount(b, null, [sid], null) || 0), 0)

// ลำดับเดียวกับ bundleWinners: จำนวนตัวเลือกมากก่อน แล้วส่วนลดรวมมากก่อน
const beforeInOrder = (a, b, sizeIds) => {
  const la = (a.items || []).length
  const lb = (b.items || []).length
  if (la !== lb) return la > lb
  return totalOf(a, sizeIds) > totalOf(b, sizeIds)
}

// ชุดทั้งหมดที่มีตัวเลือกนี้ เรียงตามลำดับการใช้ (ชุดที่ใหญ่หรือส่วนลดมากกว่าก่อน)
export function bundlesWithOption(bundles, x, sizes) {
  const k = keyOf(x)
  const sizeIds = sizeIdsOf(sizes)
  return (bundles || [])
    .filter((b) => (b.items || []).some((i) => keyOf(i) === k))
    .sort((p, q) => (beforeInOrder(p, q, sizeIds) ? -1 : beforeInOrder(q, p, sizeIds) ? 1 : 0))
}

// ชุดอื่นที่จะทำให้ชุดนี้ถูกข้าม: เปิดใช้งาน มีส่วนลด มีตัวเลือกร่วม และลำดับก่อนชุดนี้
export function conflictsOf(b, bundles, sizes) {
  const sizeIds = sizeIdsOf(sizes)
  const mine = new Set((b.items || []).map(keyOf))
  return (bundles || []).filter(
    (o) => o.id !== b.id && o.active !== false && totalOf(o, sizeIds) > 0 &&
      (o.items || []).some((i) => mine.has(keyOf(i))) && beforeInOrder(o, b, sizeIds),
  )
}

// สถานะของชุดในหน้า: off = ปิดอยู่ · nodiscount = ยังไม่มีส่วนลด · skipped = จะถูกข้ามถ้าลูกค้าเลือกชุดที่ใหญ่กว่า · ok = ใช้ได้
export function usageOf(b, bundles, sizes) {
  if (b.active === false) return { status: 'off', conflicts: [] }
  if (totalOf(b, sizeIdsOf(sizes)) <= 0) return { status: 'nodiscount', conflicts: [] }
  const conflicts = conflictsOf(b, bundles, sizes)
  return conflicts.length ? { status: 'skipped', conflicts } : { status: 'ok', conflicts: [] }
}

// แถวต่อขนาด: ราคาปกติรวมตามราคาตัวเลือกจริง และส่วนลดของช่องทุกชนิด
export function discountRows(b, groups, sizes) {
  return (sizes || []).map((s) => ({
    sizeId: s.id,
    sizeName: s.name,
    regular: regularTotal(b.items || [], groups, null, s.id),
    amount: bundleAmount(b, null, [s.id], null) || 0,
  }))
}

// ตั้งส่วนลดของขนาดหนึ่งในช่องทุกชนิด (คืนชุดใหม่ ไม่แก้ต้นฉบับ · ค่าว่างลบค่า)
export function setSizeDiscount(b, sizeId, amount) {
  const next = JSON.parse(JSON.stringify(b))
  next.discount = { ...(next.discount || {}) }
  if (amount == null || amount === '') delete next.discount[sizeId]
  else next.discount[sizeId] = Number(amount)
  return next
}

// ร่างชุดใหม่จากตัวเลือกที่เลือก (ข้ามกลุ่มรองได้) ชื่ออัตโนมัติ ยังไม่มีส่วนลด
export function createBundleDraft(items, groups) {
  const d = makeDraft(null, [], [])
  d.items = items.map((x) => ({ groupId: x.groupId, optionId: x.optionId }))
  d.name = autoBundleName(d.items, groups)
  return d
}
