// ลุ้นโชคท้ายบิล (ฝั่งแอป): หลายโครงการพร้อมกัน · แต่ละโครงการมีเงื่อนไขเดียว (ซื้อสินค้าที่เลือก หรือ ซื้อครบทุก X บาท) ช่วงวัน รางวัล และอายุคูปองของตัวเอง
// บิลหนึ่งใบได้ลุ้นแยกตามโครงการที่เข้าเงื่อนไข · รางวัลวนตามลำดับของโครงการนั้น (ตัดสินที่ฐานข้อมูล punpang_lucky_spin)
// ลุ้นได้เฉพาะสมาชิกที่เข้าสู่ระบบ · token เต็มไม่เก็บในฐานข้อมูล
import { orderTotals } from './pricing.js'

export const LUCKY_SITE_URL = 'https://cake-order-admin.pages.dev'
export const MAX_DRAWS_PER_BILL = 10 // เพดานครั้งลุ้นต่อโครงการต่อบิล (แบบซื้อครบทุก X บาท)
export const ROUND_DRAWS_DEFAULT = 100 // จำนวนครั้งลุ้นต่อ 1 รอบ (แบบซื้อครบทุก X บาท)
export const PRIZE_PCT_DEFAULT = 5 // มูลค่ารางวัลต่อรอบ เป็น % ของยอดซื้อในรอบ (แบบซื้อครบทุก X บาท)
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
  roundDraws: kind === 'amount' ? ROUND_DRAWS_DEFAULT : null, prizePct: kind === 'amount' ? PRIZE_PCT_DEFAULT : null,
  from: '', to: '', couponDays: 30, prizes: [],
})

// รายการโครงการจากการตั้งค่า · รูปแบบเดิม (ชุดเดียว มี perBaht/itemIds/prizes) → โครงการแรก id legacy เป็นแบบซื้อสินค้าที่เลือก (ค่า "ทุกกี่บาท" เดิมไม่มีในแบบใหม่)
export function luckyProjectsOf(raw) {
  if (Array.isArray(raw?.projects)) return raw.projects
  if (raw && ('perBaht' in raw || 'itemIds' in raw || 'prizes' in raw)) {
    return [{
      id: LEGACY_PROJECT_ID, name: 'ลุ้นโชคท้ายบิล', enabled: !!raw.enabled, kind: 'items',
      itemIds: [...(raw.itemIds || [])], everyBaht: null, roundDraws: null, prizePct: null,
      from: raw.from || '', to: raw.to || '', couponDays: Number(raw.couponDays) || 30, prizes: raw.prizes || [],
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

// ---------- งบรางวัลต่อรอบ (โครงการแบบซื้อครบทุก X บาท) ----------
// เพดานมูลค่ารางวัลต่อรอบ = ทุกกี่บาท × จำนวนครั้งลุ้นในรอบ × เปอร์เซ็นต์ ÷ 100 (เช่น 100 × 100 × 5% = 500 บาท)
// มูลค่ารางวัล: ส่วนลด = จำนวนบาท · ของรางวัล = มูลค่าที่กรอก · คะแนน = คะแนน × มูลค่าต่อ 1 คะแนน · ไม่ได้รางวัล = 0
const cents = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function prizeValueOf(x, pointValue = 0) {
  if (x?.kind === 'discount') return Math.max(0, Number(x.amount) || 0)
  if (x?.kind === 'reward') return Math.max(0, Number(x.value) || 0)
  if (x?.kind === 'points') return Math.max(0, (Number(x.points) || 0) * (Number(pointValue) || 0))
  return 0
}

// มูลค่ารางวัลรวมของการลุ้น n ครั้งติดกัน เมื่อรางวัลวนตามลำดับ (values = มูลค่าตามลำดับที่ออก)
// รอบอาจเริ่มที่รางวัลลำดับใดก็ได้ จึงลองทุกจุดเริ่มแล้วเอามากสุด
export function worstRoundValue(values, n) {
  const L = values.length
  const N = Math.floor(Number(n))
  if (!L || !(N > 0)) return 0
  const full = Math.floor(N / L) // จำนวนรอบเต็มของลำดับรางวัล
  const rem = N % L // ที่เหลือหลังรอบเต็ม
  const total = values.reduce((a, b) => a + b, 0)
  const pre = [0]
  for (let i = 0; i < 2 * L; i++) pre.push(pre[i] + values[i % L])
  let best = 0
  for (let s = 0; s < L; s++) best = Math.max(best, pre[s + rem] - pre[s])
  return cents(full * total + best)
}

// งบของโครงการ: เพดานต่อรอบ · มูลค่ารางวัลสูงสุดในรอบ · เกินเพดานหรือไม่
export function luckyBudgetOf(p, pointValue = 0) {
  const per = Number(p?.everyBaht) || 0
  const roundDraws = Math.floor(Number(p?.roundDraws)) || 0
  const prizePct = Number(p?.prizePct) || 0
  const ceiling = cents((per * roundDraws * prizePct) / 100)
  const worst = worstRoundValue((p?.prizes || []).map((x) => prizeValueOf(x, pointValue)), roundDraws)
  return { per, roundDraws, prizePct, ceiling, worst, over: worst > ceiling + 0.004 }
}

// ตรวจงบของโครงการแบบซื้อครบทุก X บาท: จำนวนครั้งในรอบ · เปอร์เซ็นต์ · ของรางวัลต้องมีมูลค่า · มูลค่าสูงสุดในรอบต้องไม่เกินเพดาน
export function validateLuckyBudget(p, pointValue = 0) {
  const n = Number(p.roundDraws)
  if (!(Number.isInteger(n) && n >= 1)) return 'จำนวนครั้งลุ้นต่อ 1 รอบต้องเป็นจำนวนเต็มตั้งแต่ 1'
  const pct = Number(p.prizePct)
  if (!(pct > 0 && pct <= 100)) return 'มูลค่ารางวัลต่อรอบต้องมากกว่า 0% และไม่เกิน 100%'
  const noValue = (p.prizes || []).findIndex((x) => x?.kind === 'reward' && !(Number(x.value) > 0))
  if (noValue >= 0) return `ของรางวัลลำดับที่ ${noValue + 1} ต้องใส่มูลค่า (บาท) มากกว่า 0`
  const b = luckyBudgetOf(p, pointValue)
  if (b.over) return `รางวัลในรอบสูงสุด ${b.worst} บาท เกินเพดาน ${b.ceiling} บาท (${b.per} × ${b.roundDraws} × ${b.prizePct}%) · ลดมูลค่ารางวัลหรือเปอร์เซ็นต์ลง`
  return ''
}

// ตรวจโครงการหนึ่ง: ชื่อ · เงื่อนไข · อายุคูปอง · ถ้าเปิดต้องมีสินค้า (แบบสินค้า) ช่วงวันที่ครบ และรางวัลอย่างน้อย 1
// แบบซื้อครบทุก X บาท ต้องผ่านงบรางวัลต่อรอบด้วย (pointValue = มูลค่าต่อ 1 คะแนนจากการตั้งค่าร้าน)
export function validateLuckyProject(p, pointValue = 0) {
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
  const perr = validateLuckyPrizes(p.prizes || [])
  if (perr) return perr
  return p.kind === 'amount' ? validateLuckyBudget(p, pointValue) : ''
}

// ตรวจทั้งชุด: รหัสโครงการไม่ซ้ำหรือว่าง · แต่ละโครงการถูกต้อง (แจ้งลำดับโครงการที่ผิด) · cfg.pointValue = มูลค่าต่อ 1 คะแนน
export function validateLuckyConfig(cfg) {
  const list = Array.isArray(cfg?.projects) ? cfg.projects : []
  const pointValue = Number(cfg?.pointValue) || 0
  const ids = list.map((p) => String(p?.id ?? ''))
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) return 'รหัสโครงการซ้ำหรือว่าง'
  for (let i = 0; i < list.length; i++) {
    const err = validateLuckyProject(list[i], pointValue)
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
