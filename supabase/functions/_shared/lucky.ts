// ลุ้นโชคท้ายบิล: กติกาล้วนที่ใช้ร่วมกันระหว่าง Edge Function lucky-spin และเทสต์
// การเลือกรางวัลจริง (วนตามลำดับของโครงการ ไม่จำกัดจำนวน) ทำในฐานข้อมูล punpang_lucky_spin

// token 192 บิต (24 ไบต์) → 32 ตัวแบบ base64url ไม่มี padding (รูปแบบเดียวกับลิงก์ออร์เดอร์)
export const isTokenShape = (t: string): boolean => /^[A-Za-z0-9_-]{32}$/.test(t)
export function tokenFromBytes(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// รหัสโครงการ: ตัวอักษร ตัวเลข _ หรือ - ไม่เกิน 64 ตัว (ตรงกับรหัสที่แอปสร้าง)
export const isProjectId = (p: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(p)

// จำนวนที่ออกไปแล้วของแต่ละรางวัลในแต่ละโครงการ { รหัสโครงการ: { รหัสรางวัล: จำนวน } }
// ข้ามการลุ้นที่ไม่ได้รางวัล และการลุ้นที่ไม่มีรหัสโครงการหรือรหัสรางวัล
export function tallyByProject(spins: { projectId?: unknown; prize?: { id?: unknown } | null }[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const s of spins) {
    const pid = String(s.projectId ?? '')
    const id = String(s.prize?.id ?? '')
    if (!pid || !id) continue
    const bucket = out[pid] ?? (out[pid] = {})
    bucket[id] = (bucket[id] ?? 0) + 1
  }
  return out
}
