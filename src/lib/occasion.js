// โอกาสของการสั่งเค้ก (เลือกเองตอนสั่ง) → สถิติรวมสำหรับแนะนำสินค้า · ไม่เก็บเพศ อายุ หรือข้อมูลของผู้รับ
// ใช้เฉพาะออร์เดอร์ที่ลูกค้ายินยอม (consent = true) · ผลที่เผยแพร่ไม่มีรหัสลูกค้า · กลุ่มที่มีออร์เดอร์น้อยกว่า OCCASION_MIN ไม่เผยแพร่
// ฟังก์ชันล้วน ไม่พึ่ง store/Vue เพื่อให้ทดสอบด้วย node ได้

export const OCCASIONS = [
  { key: 'birthday', label: 'วันเกิด' },
  { key: 'anniversary', label: 'ครบรอบ' },
  { key: 'party', label: 'ปาร์ตี้' },
  { key: 'family', label: 'งานรวมครอบครัว' },
  { key: 'work', label: 'งานบริษัท/องค์กร' },
  { key: 'other', label: 'อื่น ๆ' },
]
export const OCCASION_MIN = 3 // จำนวนออร์เดอร์ขั้นต่ำต่อ (โอกาส, สินค้า) ก่อนเผยแพร่
export const OCCASION_TOP = 20 // สินค้าสูงสุดต่อโอกาส
const SKIP = ['draft', 'cancelled']
const DAY_MS = 86400e3

export const occasionLabel = (key) => OCCASIONS.find((x) => x.key === key)?.label || ''

// { [โอกาส]: { [retailId]: จำนวนชิ้น } } จากออร์เดอร์ที่ยินยอมและอยู่ในช่วงวัน
export function computeOccasionStats(orders, { now = new Date(), days = 30 } = {}) {
  const since = now.getTime() - days * DAY_MS
  const qty = {} // occ -> { id: qty }
  const orderCount = {} // occ -> { id: จำนวนออร์เดอร์ที่มีสินค้านี้ }
  for (const o of orders || []) {
    if (!o || SKIP.includes(o.status)) continue
    if (!o.occasion || o.occasion.consent !== true || !OCCASIONS.some((x) => x.key === o.occasion.kind)) continue
    if (new Date(o.createdAt).getTime() < since) continue
    const occ = o.occasion.kind
    const seen = new Set()
    for (const it of o.items || []) {
      if (it?.kind !== 'retail' || !it.retailId) continue
      qty[occ] = qty[occ] || {}
      qty[occ][it.retailId] = (qty[occ][it.retailId] || 0) + (Number(it.qty) || 0)
      seen.add(it.retailId)
    }
    orderCount[occ] = orderCount[occ] || {}
    for (const id of seen) orderCount[occ][id] = (orderCount[occ][id] || 0) + 1
  }
  const out = {}
  for (const occ of Object.keys(qty)) {
    const keep = Object.entries(qty[occ])
      .filter(([id]) => (orderCount[occ][id] || 0) >= OCCASION_MIN)
      .sort((a, b) => b[1] - a[1])
      .slice(0, OCCASION_TOP)
    if (keep.length) out[occ] = Object.fromEntries(keep)
  }
  return out
}

// id สินค้าเรียงตามยอดของโอกาสที่เลือก (ตัดยอดศูนย์)
export function occasionIds(stats, occ) {
  return Object.entries(stats?.[occ] || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
