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

// คูปองที่ใช้ได้
export const couponUsable = (c, today) => c.status === 'pending' && (!c.expiresAt || c.expiresAt >= today)

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
