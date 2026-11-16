// ลุ้นโชคท้ายบิล: กติกาล้วนที่ใช้ร่วมกันระหว่าง Edge Function lucky-spin และเทสต์
// การเลือกรางวัลจริง (ตามลำดับและจำนวนของแต่ละรางวัล) ทำในฐานข้อมูล punpang_lucky_spin

// token 192 บิต (24 ไบต์) → 32 ตัวแบบ base64url ไม่มี padding (รูปแบบเดียวกับลิงก์ออร์เดอร์)
export const isTokenShape = (t: string): boolean => /^[A-Za-z0-9_-]{32}$/.test(t)
export function tokenFromBytes(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// จำนวนที่ออกไปแล้วของแต่ละรางวัล (รหัสรางวัล) จากการลุ้นที่เวลาอยู่ใน [fromMs, toMs]
// ข้ามการลุ้นที่ไม่ได้รางวัล และการลุ้นที่อ่านเวลาไม่ได้
export function tallyAwards(spins: { at?: unknown; prize?: { id?: unknown } | null }[], fromMs: number, toMs: number): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const s of spins) {
    const t = Date.parse(String(s.at ?? ''))
    if (!(t >= fromMs && t <= toMs)) continue
    const id = String(s.prize?.id ?? '')
    if (!id) continue
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}
