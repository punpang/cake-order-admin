// รอบรับสินค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · โหมด 'day' = รับได้ทั้งวัน · โหมด 'slot' = เลือกรอบเวลา มีจำนวนออร์เดอร์ต่อรอบ
// รับได้ตั้งแต่เวลาที่เลือกถึงสิ้นวัน · ไม่ใช้ในการตัดสินใจฝั่งลูกค้าโดยตรง (เซิร์ฟเวอร์ตรวจซ้ำทุกครั้ง)

export const MAX_ROUNDS = 12
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

// ตรวจและทำความสะอาดรายการรอบ: เวลา HH:MM ไม่ซ้ำ · cap จำนวนเต็ม ≥ 1 · ไม่เกิน 12 รอบ
export function cleanRounds(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'ต้องตั้งรอบอย่างน้อย 1 รอบ' }
  if (input.length === 0) return { ok: false, error: 'ต้องตั้งรอบอย่างน้อย 1 รอบ' }
  if (input.length > MAX_ROUNDS) return { ok: false, error: `ตั้งได้ไม่เกิน ${MAX_ROUNDS} รอบ` }
  const seen = new Set()
  const rounds = []
  for (const r of input) {
    const time = typeof r?.time === 'string' ? r.time.trim() : ''
    if (!TIME_RE.test(time)) return { ok: false, error: 'เวลารอบต้องเป็นรูปแบบ HH:MM' }
    if (seen.has(time)) return { ok: false, error: `เวลารอบ ${time} ซ้ำ` }
    const cap = Number(r?.cap)
    if (!Number.isInteger(cap) || cap < 1) return { ok: false, error: `จำนวนออร์เดอร์ของรอบ ${time} ต้องเป็นจำนวนเต็มอย่างน้อย 1` }
    seen.add(time)
    rounds.push({ time, cap })
  }
  rounds.sort((a, b) => a.time.localeCompare(b.time))
  return { ok: true, rounds }
}

// โหมดของแคมเปญ · ไม่ได้ตั้งหรือค่าไม่รู้จัก = 'day' (พฤติกรรมเดิม)
export function pickupMode(campaign) {
  return campaign?.data?.pickupMode === 'slot' ? 'slot' : 'day'
}

// รอบของแคมเปญที่ตรงกับเวลาที่ระบุ · ไม่มี → null
export function roundOf(campaign, time) {
  if (pickupMode(campaign) !== 'slot') return null
  const rounds = Array.isArray(campaign?.data?.rounds) ? campaign.data.rounds : []
  return rounds.find((r) => r.time === time) ?? null
}
