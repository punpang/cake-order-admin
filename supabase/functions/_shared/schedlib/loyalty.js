// คะแนนสะสม / คูปอง / กาชา (ฟังก์ชันล้วน ไม่แตะข้อมูลจริง)
// สมุดคะแนนของลูกค้า: ledger = [{ id, at, delta, reason, orderId?, expiresAt?, remaining?, takes? }]
//   delta > 0 = ได้คะแนน (เป็นก้อน มี remaining และ expiresAt)
//   delta < 0 = ใช้คะแนน (takes = [{ lotId, n }] ตัดจากก้อนที่ใกล้หมดอายุก่อน)

export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const alive = (lot, today) => lot.delta > 0 && lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt >= today)

// คะแนนที่ใช้ได้
export const pointBalance = (ledger, today) => (ledger || []).filter((l) => alive(l, today)).reduce((s, l) => s + l.remaining, 0)

// คะแนนที่จะหมดอายุภายใน days วัน
export function expiringSoon(ledger, today, days = 30) {
  const limit = addDays(today, days)
  const lots = (ledger || []).filter((l) => alive(l, today) && l.expiresAt && l.expiresAt <= limit)
  if (!lots.length) return null
  const first = lots.reduce((a, b) => (a.expiresAt <= b.expiresAt ? a : b))
  return { points: lots.reduce((s, l) => s + l.remaining, 0), date: first.expiresAt }
}

// ข้อความแจ้งคะแนนหลังปิดบิล POS: earned = คะแนนที่เพิ่งได้ · คะแนนสะสม = ที่ใช้ได้ทั้งหมด · คะแนนหมดอายุ = ที่จะหมดภายใน days วัน (ไม่มี = เว้นว่าง)
export function pointsEarnedVars(ledger, today, earned, days = 30) {
  const soon = expiringSoon(ledger, today, days)
  return {
    คะแนนใหม่: earned,
    คะแนนสะสม: pointBalance(ledger, today),
    คะแนนหมดอายุ: soon ? ` และ ${soon.points} คะแนน จะหมดอายุ ${soon.date.split('-').reverse().join('-')}` : '',
  }
}
// บรรทัดแจ้งคะแนนในข้อความส่งมอบ (ออร์เดอร์ปกติ) · ไม่ได้แต้ม = '' (บรรทัดว่างถูกตัดทิ้งตอนส่ง)
export function pointsLineOf(ledger, today, earned, days = 30) {
  if (!(earned > 0)) return ''
  const v = pointsEarnedVars(ledger, today, earned, days)
  return `คุณได้รับคะแนนใหม่ ${v.คะแนนใหม่} คะแนน มีคะแนนสะสมอยู่ ${v.คะแนนสะสม} คะแนน${v.คะแนนหมดอายุ}`
}

// ตัดคะแนน n จากก้อนที่ใกล้หมดอายุก่อน → takes (คืน null ถ้าไม่พอ) — แก้ remaining ของก้อนโดยตรง
export function takePoints(ledger, n, today) {
  if (n <= 0 || pointBalance(ledger, today) < n) return null
  const lots = ledger.filter((l) => alive(l, today)).sort((a, b) => (a.expiresAt || '9999').localeCompare(b.expiresAt || '9999'))
  const takes = []
  let left = n
  for (const lot of lots) {
    if (!left) break
    const k = Math.min(lot.remaining, left)
    lot.remaining -= k
    left -= k
    takes.push({ lotId: lot.id, n: k })
  }
  return takes
}

// คืนคะแนนตาม takes (ก้อนที่หมดอายุแล้วจะใช้ไม่ได้อยู่ดี)
export function returnPoints(ledger, takes) {
  for (const t of takes || []) {
    const lot = ledger.find((l) => l.id === t.lotId)
    if (lot) lot.remaining += t.n
  }
}

// ช่วงชีวิตของคูปอง/ของรางวัล (ฟังก์ชันล้วน ไม่แก้ข้อมูล · nowIso = เวลาปัจจุบัน ISO)
// pending = ยังไม่ใช้ · active = ลูกค้ากด "ใช้ที่ร้านตอนนี้" และยังไม่ครบเวลา (POS เห็น) · lapsed = ครบเวลาโดยไม่ได้มอบ/ใช้ (ถือว่าใช้แล้ว)
// delivered/used = มอบ/ใช้แล้ว · refunded = หลังบ้านคืนคะแนน · expired = เกินวันหมดอายุของคูปอง
export function couponPhase(c, today, nowIso = new Date().toISOString()) {
  if (['delivered', 'used', 'refunded', 'lapsed', 'void'].includes(c.status)) return c.status
  if (c.expiresAt && c.expiresAt < today) return 'expired'
  if (c.activatedUntil) return c.activatedUntil > nowIso ? 'active' : 'lapsed'
  return 'pending'
}
// คูปองที่ใช้ได้ = pending หรือ active (lapsed/expired/ใช้แล้ว/คืนคะแนนแล้ว/ยกเลิกแล้ว ใช้ไม่ได้) · คูปองคืนเงินต้องมียอดคงเหลือ
export const couponUsable = (c, today, nowIso) =>
  ['pending', 'active'].includes(couponPhase(c, today, nowIso)) && (c.mode !== 'credit' || (Number(c.balance) || 0) > 0)

// แผนแปลงคะแนนคงเหลือเป็นคูปองใบเดียว: คะแนนที่ใช้ได้ทั้งหมด × มูลค่าต่อคะแนน · ไม่มีคะแนนที่ใช้ได้ = null
export function conversionPlan(ledger, today, pointValue = 1) {
  const points = pointBalance(ledger, today)
  if (!(points > 0)) return null
  const pv = Number(pointValue) > 0 ? Number(pointValue) : 1
  return { points, amount: Math.round(points * pv * 100) / 100 }
}
// วินาทีที่เหลือของการแสดงที่ร้าน (0 = ไม่ได้แสดง/หมดแล้ว)
export const activeSecondsLeft = (c, nowMs = Date.now()) => (c.activatedUntil ? Math.max(0, Math.ceil((new Date(c.activatedUntil).getTime() - nowMs) / 1000)) : 0)

// สุ่มรางวัลตาม % (rand 0–1)
export function pickPrize(prizes, rand = Math.random()) {
  const list = prizes.filter((p) => p.active !== false && p.chance > 0)
  const total = list.reduce((s, p) => s + Number(p.chance), 0)
  let x = rand * total
  for (const p of list) {
    x -= Number(p.chance)
    if (x < 0) return p
  }
  return list[list.length - 1] || null
}

export const chanceTotal = (prizes) =>
  Math.round(prizes.filter((p) => p.active !== false).reduce((s, p) => s + (Number(p.chance) || 0), 0) * 100) / 100
