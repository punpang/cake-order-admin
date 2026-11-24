// แคมเปญสั่งล่วงหน้า (ฟังก์ชันล้วน): ตรวจค่า วันรับ สถานะ และแปลงแถวฐานข้อมูล
// วันที่เป็นข้อความ 'YYYY-MM-DD' เสมอ · ไม่พึ่งเขตเวลา (คำนวณด้วย UTC)

export const CAMPAIGN_STATUS = ['draft', 'open', 'closed']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// วันที่ต้องเป็นรูปแบบ YYYY-MM-DD และเป็นวันจริง (เช่น 2026-02-30 ไม่ผ่าน)
export function isDay(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d))
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d
}

export function blankCampaign() {
  return {
    id: '', name: '', status: 'draft',
    orderFrom: '', orderTo: '', pickupFrom: '', pickupTo: '',
    depositPercent: 50, payDueMin: null,
    dayCap: null, items: [],
    deals: [], parcel: { enabled: false },
  }
}

// ดีลที่ใช้ในแคมเปญ: เฉพาะส่วนลดตามยอดแบบขั้นบันได (spend_off) · ขั้นต้องมียอดไม่ซ้ำกัน
function dealError(d) {
  if (d?.kind !== 'spend_off') return 'ดีลนี้ใช้ในแคมเปญไม่ได้'
  const tiers = Array.isArray(d.tiers) ? d.tiers : []
  const mins = new Set()
  for (const t of tiers) {
    const min = Number(t?.min), value = Number(t?.value)
    if (!Number.isInteger(min) || min < 1 || !(value > 0) || !['amount', 'percent'].includes(t?.type)) return 'ขั้นส่วนลดต้องเป็นจำนวนเต็มบาทหรือเปอร์เซ็นต์ที่มากกว่า 0'
    if (t.type === 'percent' && value > 100) return 'ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100'
    if (mins.has(min)) return 'ขั้นส่วนลดซ้ำยอดเดียวกัน'
    mins.add(min)
  }
  return ''
}


// ค่าเพดานต้องเป็น null (ไม่จำกัด) หรือจำนวนเต็ม ≥ 0
const capOk = (v) => v === null || (Number.isInteger(v) && v >= 0)

// '' เมื่อผ่าน หรือข้อความที่บอกเหตุผลที่ไม่ผ่าน
export function campaignError(c) {
  if (!String(c?.name ?? '').trim()) return 'ต้องระบุชื่อแคมเปญ'
  if (!isDay(c.orderFrom) || !isDay(c.orderTo)) return 'ช่วงรับสั่งต้องเป็นวันที่ที่ถูกต้อง'
  if (c.orderFrom > c.orderTo) return 'วันเริ่มรับสั่งต้องไม่เกินวันสิ้นสุด'
  if (!isDay(c.pickupFrom) || !isDay(c.pickupTo)) return 'ช่วงวันรับสินค้าต้องเป็นวันที่ที่ถูกต้อง'
  if (c.pickupFrom > c.pickupTo) return 'วันเริ่มรับสินค้าต้องไม่เกินวันสิ้นสุด'
  if (!Number.isInteger(c.depositPercent) || c.depositPercent < 1 || c.depositPercent > 100) return 'มัดจำขั้นต่ำต้องเป็นจำนวนเต็ม 1–100 %'
  if (!Number.isInteger(c.payDueMin) || c.payDueMin <= 0) return 'ต้องกำหนดเวลาจ่ายมัดจำ (นาที) ทุกแคมเปญ'
  if (!capOk(c.dayCap)) return 'โควตารวมต่อวันต้องว่างหรือเป็นจำนวนเต็ม ≥ 0'
  if (!Array.isArray(c.items) || c.items.length === 0) return 'ต้องเลือกสินค้าอย่างน้อย 1 รายการ'
  const seen = new Set()
  for (const d of c.deals ?? []) {
    const err = dealError(d)
    if (err) return err
  }
  if (c.parcel !== undefined && typeof c.parcel?.enabled !== 'boolean') return 'ค่า parcel.enabled ต้องเป็น true/false'
  for (const it of c.items) {
    if (!it?.retailId) return 'สินค้าในแคมเปญต้องมีรหัส'
    if (seen.has(it.retailId)) return 'สินค้าซ้ำในแคมเปญ'
    seen.add(it.retailId)
    if (!capOk(it.dayCap)) return 'เพดานต่อวันของสินค้าต้องว่างหรือเป็นจำนวนเต็ม ≥ 0'
  }
  return ''
}

// วันรับทั้งหมดในช่วง (รวมปลายทั้งสอง) เรียงจากน้อยไปมาก · [] ถ้าช่วงไม่ถูกต้อง
export function pickupDays(c) {
  if (!isDay(c?.pickupFrom) || !isDay(c?.pickupTo) || c.pickupFrom > c.pickupTo) return []
  const [y, m, d] = c.pickupFrom.split('-').map(Number)
  const end = c.pickupTo
  const out = []
  for (let t = Date.UTC(y, m - 1, d); ; t += 86400000) {
    const s = new Date(t).toISOString().slice(0, 10)
    out.push(s)
    if (s === end) break
  }
  return out
}

// สถานะตอนนี้: draft/closed ตามค่า status · open แบ่งตามวันนี้เทียบช่วงรับสั่ง (วันขอบยังเปิด)
export function campaignPhase(c, today) {
  if (c.status === 'draft') return 'draft'
  if (c.status === 'closed') return 'closed'
  if (today < c.orderFrom) return 'upcoming'
  if (today > c.orderTo) return 'ended'
  return 'open'
}

// แถวฐานข้อมูล: คอลัมน์ตรงๆ สำหรับค่าที่ SQL ตรวจ และ data สำหรับรายละเอียด
export function campaignToRow(c) {
  return {
    id: c.id,
    status: c.status,
    order_from: c.orderFrom,
    order_to: c.orderTo,
    pickup_from: c.pickupFrom,
    pickup_to: c.pickupTo,
    deposit_percent: c.depositPercent,
    pay_due_min: c.payDueMin,
    data: {
      name: c.name,
      dayCap: c.dayCap ?? null,
      items: c.items.map((i) => ({ retailId: i.retailId, dayCap: i.dayCap ?? null })),
      deals: (c.deals ?? []).map((d) => ({ kind: d.kind, name: d.name ?? '', tiers: (d.tiers ?? []).map((t) => ({ min: Number(t.min), type: t.type, value: Number(t.value) })) })),
      parcel: { enabled: c.parcel?.enabled === true },
    },
  }
}

export function rowToCampaign(r) {
  return {
    id: r.id,
    name: r.data?.name ?? '',
    status: r.status,
    orderFrom: r.order_from,
    orderTo: r.order_to,
    pickupFrom: r.pickup_from,
    pickupTo: r.pickup_to,
    depositPercent: r.deposit_percent,
    payDueMin: r.pay_due_min,
    dayCap: r.data?.dayCap ?? null,
    items: (r.data?.items ?? []).map((i) => ({ retailId: i.retailId, dayCap: i.dayCap ?? null })),
    deals: r.data?.deals ?? [],
    parcel: { enabled: r.data?.parcel?.enabled === true },
  }
}
