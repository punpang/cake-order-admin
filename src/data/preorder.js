// แคมเปญสั่งล่วงหน้า (ฝั่งแอป): บันทึก/เปิดปิดแคมเปญ ตรวจสินค้าในคลังก่อน
// ไม่ถูก import จาก store.js (กันวนซ้ำและให้ชิ้นนี้อยู่ใน chunk ของหน้าตั้งค่า) · ข้อมูลอยู่ที่ db.preorderCampaigns
import { db, can } from './store'
import { campaignError, blankCampaign } from '../lib/preorderCampaign'
import { hasParcelDims } from '../lib/parcelShipping'

// รายการแคมเปญเรียงจากช่วงรับสั่งล่าสุดก่อน (คัดลอกใหม่ ไม่แก้ตัวจริง)
export const preorderCampaigns = () =>
  [...db.preorderCampaigns].sort((a, b) => String(b.orderFrom).localeCompare(String(a.orderFrom)))

// ค่าโครงสร้างของแคมเปญ (ไม่รวมชื่อ) ใช้เทียบว่าแก้ของที่ล็อกหรือไม่
const structOf = (c) => JSON.stringify([
  c.orderFrom, c.orderTo, c.pickupFrom, c.pickupTo, c.depositPercent, c.payDueMin ?? null, c.dayCap ?? null,
  (c.items || []).map((i) => [i.retailId, i.dayCap ?? null]),
  (c.deals || []).map((d) => [d.kind, d.name, (d.tiers || []).map((t) => [t.min, t.type, t.value])]),
  (c.shipOff || []).map((t) => [t.min, t.value]),
  c.parcel?.enabled === true,
  c.parcel?.enabled === true ? [c.shipFrom, c.shipTo] : null,
])

let seq = 0
const newId = () => `pc${Date.now().toString(36)}${++seq}`

// สินค้าที่ใช้ได้ในแคมเปญ: มีในคลัง เปิดขาย ไม่กำหนดราคาเอง และไม่มีตัวเลือก (ตัวเลือกตอนขายทำให้โควตาคำนวณไม่ได้)
const retailOk = (id) => {
  const r = db.retailItems.find((x) => x.id === id)
  return !!r && r.active && !r.openPrice && !(r.modifierIds && r.modifierIds.length)
}
const itemsError = (c) => {
  for (const it of c.items) {
    if (!retailOk(it.retailId)) return `สินค้า ${it.retailId} ใช้ในแคมเปญไม่ได้ (ไม่เปิดขาย / กำหนดราคาเอง / มีตัวเลือก)`
  }
  // เปิดส่งพัสดุ: ทุกสินค้าต้องมีน้ำหนักและขนาดครบ (ตรงกับกฎในฐานข้อมูล)
  if (c.parcel?.enabled) {
    for (const it of c.items) {
      if (!hasParcelDims(db.retailItems.find((x) => x.id === it.retailId))) return `สินค้า ${it.retailId} ไม่มีน้ำหนักหรือขนาด (ต้องกรอกในหน้าสินค้าก่อนเปิดส่งพัสดุ)`
    }
  }
  return ''
}

// บันทึกแคมเปญ (สร้างหรือแก้) · ต้องมีสิทธิ์ managePreorder และผ่านการตรวจทั้งหมด
export function savePreorderCampaign(form) {
  if (!can('managePreorder')) return { error: 'ไม่มีสิทธิ์' }
  const c = { ...blankCampaign(), ...form }
  c.items = (form.items || []).map((i) => ({ retailId: i.retailId, dayCap: i.dayCap ?? null }))
  if (!c.id) c.id = newId()
  // แคมเปญที่กำลังเปิดรับ แก้โครงสร้าง (ช่วงวัน มัดจำ เวลาจ่าย สินค้า เพดาน) ไม่ได้ · ฐานข้อมูลบังคับซ้ำ (punpang_preorder_campaign_guard)
  const prev = db.preorderCampaigns.find((x) => x.id === c.id)
  if (prev && prev.status === 'open' && structOf(prev) !== structOf(c)) {
    return { error: 'แก้โครงสร้างแคมเปญที่เปิดรับอยู่ไม่ได้ ให้ปิดรับก่อน (แก้ชื่อได้)' }
  }
  const err = campaignError(c) || itemsError(c)
  if (err) return { error: err }
  const copy = JSON.parse(JSON.stringify(c))
  const i = db.preorderCampaigns.findIndex((x) => x.id === copy.id)
  if (i >= 0) db.preorderCampaigns[i] = copy
  else db.preorderCampaigns.push(copy)
  return { ok: true, campaign: copy }
}

// เปลี่ยนสถานะ · เปิดรับได้เมื่อแคมเปญครบถ้วนและสินค้ายังใช้ได้ · ปิดรับได้เสมอ
export function setPreorderCampaignStatus(id, status) {
  if (!can('managePreorder')) return { error: 'ไม่มีสิทธิ์' }
  if (!['draft', 'open', 'closed'].includes(status)) return { error: 'สถานะไม่ถูกต้อง' }
  const c = db.preorderCampaigns.find((x) => x.id === id)
  if (!c) return { error: 'ไม่พบแคมเปญ' }
  if (status === 'open') {
    const err = campaignError(c) || itemsError(c)
    if (err) return { error: err }
  }
  c.status = status
  return { ok: true }
}
