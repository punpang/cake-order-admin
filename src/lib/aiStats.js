// สถิติบอท AI จากบันทึก punpang_records (collection 'aiLog') · ฟังก์ชันล้วน ทดสอบได้โดยไม่ต้องต่อฐานข้อมูล
// สถานะที่บันทึกโดย fb-webhook/bot.ts: ok = ตอบแล้ว · handoff = AI ส่งต่อพนักงาน · error = เรียกไม่สำเร็จ · limit = ครบเพดานวันนี้ (ไม่ได้เรียกโมเดล)
// การนับ "ใช้ไปแล้ววันนี้" = ok + handoff + error (ตรงกับตัวนับเพดานฝั่งเซิร์ฟเวอร์ · limit ไม่นับ)

export const AI_STATUS_TH = { ok: 'ตอบแล้ว', handoff: 'ส่งต่อพนักงาน', error: 'ผิดพลาด', limit: 'ครบเพดานวันนี้' }
const TH_OFFSET_MS = 7 * 3600_000
const DAY_MS = 86_400_000

// วันที่ (เวลาไทย) รูปแบบ YYYY-MM-DD จากเวลา ISO
export function thaiDay(iso) {
  return new Date(new Date(iso).getTime() + TH_OFFSET_MS).toISOString().slice(0, 10)
}
// เลื่อนวันแบบ YYYY-MM-DD ไป n วัน
export function shiftDay(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}
const empty = () => ({ ok: 0, handoff: 0, error: 0, limit: 0, total: 0 })
const usedOf = (c) => c.ok + c.handoff + c.error

// rows = รายการที่ทำให้เป็นแบบแบน { id, status, model, ms, customer, at }
// คืน { today, byDay, recent, avgMs, sinceDay }
export function summarizeAiLog(rows, { now = new Date(), days = 7, recentLimit = 30 } = {}) {
  const today = thaiDay(now.toISOString())
  const dayKeys = Array.from({ length: days }, (_, i) => shiftDay(today, i - (days - 1)))
  const byDayMap = Object.fromEntries(dayKeys.map((d) => [d, { day: d, ...empty() }]))
  const todayC = { day: today, ...empty() }
  let msSum = 0
  let msN = 0
  for (const r of rows) {
    const status = AI_STATUS_TH[r?.status] ? r.status : null
    if (!status || !r.at) continue
    const day = thaiDay(r.at)
    const bucket = byDayMap[day]
    if (bucket) { bucket[status]++; bucket.total++ }
    if (day === today) { todayC[status]++; todayC.total++ }
    // เวลาเฉลี่ยนับเฉพาะรายการในช่วงที่แสดง (และไม่รวมครบเพดานที่ไม่ได้เรียกโมเดล)
    if (bucket && status !== 'limit' && Number.isFinite(Number(r.ms))) { msSum += Number(r.ms); msN++ }
  }
  const recent = rows
    .filter((r) => AI_STATUS_TH[r?.status] && r.at)
    .slice()
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, recentLimit)
  return {
    today: { ...todayC, used: usedOf(todayC) },
    byDay: dayKeys.map((d) => byDayMap[d]),
    recent,
    avgMs: msN ? Math.round(msSum / msN) : null,
    sinceDay: dayKeys[0],
  }
}

// อ่านบันทึก AI ตั้งแต่ sinceIso · ต้องมีสิทธิ์จัดการ (ฐานข้อมูลกรองให้ตามสิทธิ์)
export async function fetchAiLog(client, { sinceIso, limit = 5000 }) {
  const r = await client
    .from('punpang_records')
    .select('id,data,created_at')
    .eq('collection', 'aiLog')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (r.error) throw new Error(r.error.message || 'load_failed')
  return (r.data || []).map((x) => ({ id: x.id, ...(x.data || {}) }))
}
