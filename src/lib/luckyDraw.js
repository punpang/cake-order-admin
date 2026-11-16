// ลุ้นโชคท้ายบิล (ฝั่งแอป): ค่าเริ่มต้น การตรวจตั้งค่า จำนวนครั้งลุ้นของบิล การสร้าง token/hash และ URL ของ QR
// รางวัลวนตามลำดับที่ร้านตั้ง ไม่จำกัดจำนวน (ตัดสินที่ฐานข้อมูล punpang_lucky_spin) · ลุ้นได้เฉพาะสมาชิกที่เข้าสู่ระบบ · token เต็มไม่เก็บในฐานข้อมูล
import { orderTotals } from './pricing.js'

export const LUCKY_SITE_URL = 'https://cake-order-admin.pages.dev'
export const MAX_DRAWS_PER_BILL = 10 // เพดานครั้งลุ้นต่อบิล (กันบิลยอดสูงมากได้ลุ้นจำนวนมากเกินไป)
export const PRIZE_KINDS = [
  { v: 'discount', l: 'ส่วนลด (บาท)' },
  { v: 'reward', l: 'ของรางวัล (รับที่ร้าน)' },
  { v: 'points', l: 'คะแนนสะสม' },
  { v: 'none', l: 'ไม่ได้รางวัล' },
]

export const luckyDefaults = () => ({
  enabled: false, from: '', to: '', siteUrl: LUCKY_SITE_URL,
  couponDays: 30, // อายุคูปองที่ได้จากการลุ้น (วัน นับจากวันที่ลุ้น)
  perBaht: 100, // ทุกกี่บาทของยอดที่จ่ายจริง (จากสินค้าที่ร่วมรายการ) ลุ้นได้ 1 ครั้ง
  itemIds: [], // สินค้าที่ร่วมรายการ (id ของสินค้าหน้าร้าน)
  prizes: [], // เรียงตามลำดับที่วนออก: { id, name, kind: 'discount' | 'reward' | 'points' | 'none', amount (ส่วนลดบาท), points (คะแนนสะสม) }
})

// ตรวจรายการรางวัลก่อนบันทึก: ชื่อไม่ว่าง ประเภทถูกต้อง ส่วนลดมากกว่า 0 บาท และรหัสรางวัลไม่ซ้ำ (ไม่จำกัดจำนวนต่อรางวัล)
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

// ตรวจการตั้งค่าลุ้นโชคทั้งชุด: ทุกกี่บาทต้องมากกว่า 0 · เปิดใช้งานต้องเลือกสินค้าและมีรางวัลอย่างน้อย 1 รายการ · รางวัลถูกต้อง
export function validateLuckyConfig(cfg) {
  if (!(Number(cfg?.perBaht) > 0)) return 'ทุกกี่บาทลุ้นได้ 1 ครั้ง ต้องมากกว่า 0'
  if (cfg?.enabled && !(Array.isArray(cfg?.itemIds) && cfg.itemIds.length)) return 'เลือกสินค้าที่ร่วมลุ้นอย่างน้อย 1 รายการ'
  if (cfg?.enabled && !(cfg?.prizes || []).length) return 'ตั้งรางวัลอย่างน้อย 1 รายการก่อนเปิดลุ้น'
  return validateLuckyPrizes(cfg?.prizes || [])
}

// เปิดให้ลุ้นอยู่หรือไม่: เปิดใช้งาน และเวลาปัจจุบันอยู่ในช่วง from–to
export function luckyActive(cfg, nowMs = Date.now()) {
  if (!cfg?.enabled) return false
  const f = cfg.from ? Date.parse(cfg.from) : NaN
  const t = cfg.to ? Date.parse(cfg.to) : NaN
  if (Number.isNaN(f) || Number.isNaN(t)) return false
  return nowMs >= f && nowMs <= t
}

// จำนวนครั้งลุ้นของบิลหนึ่ง = ยอดที่จ่ายจริงของสินค้าที่ร่วมรายการ ÷ ทุกกี่บาท (ปัดลง · ไม่เกินเพดาน)
// ยอดจริง = สัดส่วนของสินค้าที่ร่วมรายการจากยอดรวมหลังส่วนลดและคูปอง · ของแถมจากโปรไม่นับ
export function luckyDrawsOf(order, cfg) {
  const per = Number(cfg?.perBaht) || 0
  const ids = new Set(Array.isArray(cfg?.itemIds) ? cfg.itemIds : [])
  if (!order || !(per > 0) || ids.size === 0) return 0
  const lines = (order.items || []).filter((i) => i && !i.promoGift && (Number(i.qty) || 0) > 0)
  const amount = (i) => (Number(i.unitPrice) || 0) * (Number(i.qty) || 0)
  const subtotal = lines.reduce((s, i) => s + amount(i), 0)
  if (!(subtotal > 0)) return 0
  const paid = orderTotals(order).total
  const eligiblePaid = lines.filter((i) => ids.has(i.retailId)).reduce((s, i) => s + amount(i), 0) * (paid / subtotal)
  return Math.min(MAX_DRAWS_PER_BILL, Math.max(0, Math.floor(eligiblePaid / per + 1e-9)))
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
