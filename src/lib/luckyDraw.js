// ลุ้นโชคท้ายบิล (ฝั่งแอป): หลายโครงการพร้อมกัน · แต่ละโครงการมีเงื่อนไขเดียว (ซื้อสินค้าที่เลือก หรือ ซื้อครบทุก X บาท) ช่วงวัน รางวัล และอายุคูปองของตัวเอง
// บิลหนึ่งใบได้ลุ้นแยกตามโครงการที่เข้าเงื่อนไข · รางวัลวนตามลำดับของโครงการนั้น (ตัดสินที่ฐานข้อมูล punpang_lucky_spin)
// ลุ้นได้เฉพาะสมาชิกที่เข้าสู่ระบบ · token เต็มไม่เก็บในฐานข้อมูล
import { orderTotals } from './pricing.js'

export const LUCKY_SITE_URL = 'https://cake-order-admin.pages.dev'
export const MAX_DRAWS_PER_BILL = 10 // เพดานครั้งลุ้นต่อโครงการต่อบิล (แบบซื้อครบทุก X บาท)
export const LEGACY_PROJECT_ID = 'legacy' // รหัสโครงการที่ย้ายมาจากการตั้งค่าชุดเดิม (ต้องตรงกับ migration)
export const PRIZE_KINDS = [
  { v: 'discount', l: 'ส่วนลด (บาท)' },
  { v: 'reward', l: 'ของรางวัล (รับที่ร้าน)' },
  { v: 'points', l: 'คะแนนสะสม' },
  { v: 'none', l: 'ไม่ได้รางวัล' },
]
export const PROJECT_KINDS = [
  { v: 'items', l: 'ซื้อสินค้าที่เลือก' },
  { v: 'amount', l: 'ซื้อครบทุก X บาท' },
]

export const luckyDefaults = () => ({ siteUrl: LUCKY_SITE_URL, projects: [] })

// โครงการใหม่ (ยังไม่เปิด) · id ให้ผู้เรียกใส่เอง
export const newLuckyProject = (id, kind = 'items') => ({
  id, name: '', enabled: false, kind,
  itemIds: [], everyBaht: kind === 'amount' ? 100 : null,
  from: '', to: '', couponDays: 30, prizes: [],
})

// รายการโครงการจากการตั้งค่า · รูปแบบเดิม (ชุดเดียว มี perBaht/itemIds/prizes) → โครงการแรก id legacy เป็นแบบซื้อสินค้าที่เลือก (ค่า "ทุกกี่บาท" เดิมไม่มีในแบบใหม่)
export function luckyProjectsOf(raw) {
  if (Array.isArray(raw?.projects)) return raw.projects
  if (raw && ('perBaht' in raw || 'itemIds' in raw || 'prizes' in raw)) {
    return [{
      id: LEGACY_PROJECT_ID, name: 'ลุ้นโชคท้ายบิล', enabled: !!raw.enabled, kind: 'items',
      itemIds: [...(raw.itemIds || [])], everyBaht: null, from: raw.from || '', to: raw.to || '',
      couponDays: Number(raw.couponDays) || 30, prizes: raw.prizes || [],
    }]
  }
  return []
}

// ตรวจรายการรางวัลก่อนบันทึก: ชื่อไม่ว่าง ประเภทถูกต้อง ส่วนลดมากกว่า 0 บาท คะแนนเป็นจำนวนเต็มมากกว่า 0 และรหัสรางวัลไม่ซ้ำ (ไม่จำกัดจำนวนต่อรางวัล)
export function validateLuckyPrizes(prizes) {
  if (!Array.isArray(prizes)) return 'รูปแบบรายการรางวัลไม่ถูกต้อง'
  if (prizes.some((p) => !String(p?.name ?? '').trim())) return 'ทุกรางวัลต้องมีชื่อ'
  if (prizes.some((p) => !PRIZE_KINDS.some((k) => k.v === p?.kind))) return 'ประเภทรางวัลต้องเป็นส่วนลดหรือของรางวัล'
  if (prizes.some((p) => p.kind === 'discount' && !(Number(p.amount) > 0))) return 'ส่วนลดต้องมากกว่า 0 บาท'
  if (prizes.some((p) => p.kind === 'points' && !(Number.isInteger(Number(p.points)) && Number(p.points) > 0))) return 'คะแนนที่ได้ต้องเป็นจำนวนเต็มมากกว่า 0'
  const ids = prizes.map((p) => String(p?.id ?? ''))
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) return 'รหัสรางวัลซ้ำหรือว่าง'
  return ''
}

// ตรวจโครงการหนึ่ง: ชื่อ · เงื่อนไข · อายุคูปอง · ถ้าเปิดต้องมีสินค้า (แบบสินค้า) ช่วงวันที่ครบ และรางวัลอย่างน้อย 1
export function validateLuckyProject(p) {
  if (!String(p?.name ?? '').trim()) return 'ตั้งชื่อโครงการ'
  if (!PROJECT_KINDS.some((k) => k.v === p?.kind)) return 'เลือกเงื่อนไขของโครงการ'
  if (p.kind === 'items' && p.enabled && !(Array.isArray(p.itemIds) && p.itemIds.length)) return 'เลือกสินค้าที่ร่วมโครงการอย่างน้อย 1 รายการ'
  if (p.kind === 'amount' && !(Number(p.everyBaht) > 0)) return 'ทุกกี่บาทลุ้นได้ 1 ครั้ง ต้องมากกว่า 0'
  const days = Math.round(Number(p.couponDays))
  if (!(days >= 1 && days <= 365)) return 'อายุคูปองต้องอยู่ระหว่าง 1–365 วัน'
  if (p.enabled) {
    const f = p.from ? Date.parse(p.from) : NaN
    const t = p.to ? Date.parse(p.to) : NaN
    if (Number.isNaN(f) || Number.isNaN(t) || t <= f) return 'ตั้งช่วงวันที่ให้ครบ และเวลาสิ้นสุดต้องหลังเวลาเริ่ม'
    if (!(p.prizes || []).length) return 'ตั้งรางวัลอย่างน้อย 1 รายการก่อนเปิดโครงการ'
  }
  return validateLuckyPrizes(p.prizes || [])
}

// ตรวจทั้งชุด: รหัสโครงการไม่ซ้ำหรือว่าง · แต่ละโครงการถูกต้อง (แจ้งลำดับโครงการที่ผิด)
export function validateLuckyConfig(cfg) {
  const list = Array.isArray(cfg?.projects) ? cfg.projects : []
  const ids = list.map((p) => String(p?.id ?? ''))
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) return 'รหัสโครงการซ้ำหรือว่าง'
  for (let i = 0; i < list.length; i++) {
    const err = validateLuckyProject(list[i])
    if (err) return `โครงการที่ ${i + 1}: ${err}`
  }
  return ''
}

// โครงการเปิดให้ลุ้นกับบิลที่ขายในเวลานี้หรือไม่: เปิดใช้งาน และเวลาขายอยู่ในช่วง from–to
export function projectOpenAt(p, nowMs = Date.now()) {
  if (!p?.enabled) return false
  const f = p.from ? Date.parse(p.from) : NaN
  const t = p.to ? Date.parse(p.to) : NaN
  if (Number.isNaN(f) || Number.isNaN(t)) return false
  return nowMs >= f && nowMs <= t
}

// จำนวนครั้งลุ้นของบิลหนึ่งในโครงการหนึ่ง
// · ซื้อสินค้าที่เลือก: มีสินค้าที่เลือกอย่างน้อย 1 ชิ้น = 1 ครั้ง (ไม่ดูจำนวนหรือราคา) · ของแถมจากโปรไม่นับ
// · ซื้อครบทุก X บาท: ยอดที่จ่ายจริงทั้งบิล (หลังส่วนลดและคูปอง) ÷ X ปัดลง ไม่เกินเพดาน
export function projectDrawsOf(order, p) {
  if (!order || !p) return 0
  const lines = (order.items || []).filter((i) => i && !i.promoGift && (Number(i.qty) || 0) > 0)
  if (p.kind === 'items') {
    const ids = new Set(Array.isArray(p.itemIds) ? p.itemIds : [])
    return lines.some((i) => ids.has(i.retailId)) ? 1 : 0
  }
  if (p.kind === 'amount') {
    const per = Number(p.everyBaht) || 0
    if (!(per > 0)) return 0
    const paid = orderTotals(order).total
    return Math.min(MAX_DRAWS_PER_BILL, Math.max(0, Math.floor(paid / per + 1e-9)))
  }
  return 0
}

// ครั้งลุ้นของบิลแยกตามโครงการ { รหัสโครงการ: จำนวน } · เฉพาะโครงการที่เปิดอยู่ในช่วงเวลาขายและมีครั้งลุ้นอย่างน้อย 1
export function luckyDrawsByProject(order, cfg, nowMs = Date.now()) {
  const out = {}
  for (const p of luckyProjectsOf(cfg)) {
    if (!projectOpenAt(p, nowMs)) continue
    const n = projectDrawsOf(order, p)
    if (n > 0) out[p.id] = n
  }
  return out
}

const b64url = (bytes) => {
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// token สุ่ม 192 บิต (32 ตัว) สำหรับ QR หนึ่งใบ
export function genLuckyToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(24)))
}

// hash ที่เก็บในฐานข้อมูล (SHA-256 ของ "luckydraw:" + token · ตรงกับฝั่งเซิร์ฟเวอร์)
export async function hashLuckyToken(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`luckydraw:${token}`))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// URL ที่ QR ชี้ไป (หน้าลุ้นโชคของบิลนั้น)
export function luckyUrl(siteUrl, token) {
  const base = String(siteUrl || LUCKY_SITE_URL).replace(/\/+$/, '')
  return `${base}/#/luck/${token}`
}
