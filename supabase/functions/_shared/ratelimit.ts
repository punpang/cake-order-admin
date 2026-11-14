// ตัวจำกัดอัตราแบบหน้าต่างเลื่อน (อยู่ในหน่วยความจำของแต่ละ instance) · ใช้เสริมการจำกัดที่ฐานข้อมูล ไม่ใช่ตัวหลัก
// นับเฉพาะคำขอที่ผ่าน: คำขอที่ถูกปฏิเสธไม่ต่อเวลาล็อก
//   (ตัวเดิมนับคำขอที่ถูกปฏิเสธด้วย คนที่โพลล์ต่อเนื่อง เช่น หน้าแชทที่อัปเดตทุก 3 วินาที จึงถูกล็อกไม่จบจนกว่าจะปิดหน้า)
// จำนวนคีย์มีเพดาน: เกินแล้วลบคีย์ที่ไม่มีคำขอในรอบชั่วโมง (กันถูกยิงด้วย IP ปลอมจนหน่วยความจำโต)

export type Limiter = (key: string, max: number, windowMs?: number, nowMs?: number) => boolean

const KEEP_MS = 3_600_000

export function createLimiter(maxKeys = 5000): Limiter {
  const hits = new Map<string, number[]>()
  const prune = (nowMs: number) => {
    for (const [k, a] of hits) if (!a.length || nowMs - a[a.length - 1] > KEEP_MS) hits.delete(k)
    // ยังเกินเพดาน (ทุกคีย์ยัง "สด") → ทิ้งคีย์ที่เก่าที่สุดครึ่งหนึ่ง
    if (hits.size > maxKeys) {
      const oldest = [...hits.entries()].sort((x, y) => (x[1][x[1].length - 1] ?? 0) - (y[1][y[1].length - 1] ?? 0))
      for (const [k] of oldest.slice(0, Math.ceil(oldest.length / 2))) hits.delete(k)
    }
  }
  // คืน true เมื่อ "ถูกจำกัด" (เกินจำนวนในหน้าต่างเวลา)
  return (key, max, windowMs = 300_000, nowMs = Date.now()) => {
    const a = (hits.get(key) || []).filter((t) => nowMs - t < windowMs)
    if (a.length >= max) { hits.set(key, a); return true }
    a.push(nowMs)
    hits.set(key, a)
    if (hits.size > maxKeys) prune(nowMs)
    return false
  }
}

// IP ผู้เรียก: cf-connecting-ip (ตั้งโดย Cloudflare หน้าบ้าน ปลอมไม่ได้) · ไม่มี = ค่าท้ายสุดของ x-forwarded-for
// (ค่าที่พร็อกซีฝั่งเราต่อท้าย ไม่ใช่ค่าซ้ายสุดที่ผู้เรียกใส่เองได้) · ไม่มีทั้งคู่ = 'unknown'
export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xff = (headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean)
  return xff[xff.length - 1] || 'unknown'
}
