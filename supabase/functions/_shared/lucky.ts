// ลุ้นโชคท้ายบิล: กติกาล้วน (ไม่แตะฐานข้อมูล) ใช้ใน Edge Function lucky-spin และเทสต์
// โอกาสรางวัลเป็นเปอร์เซ็นต์ต่อรางวัล · โอกาสที่เหลือ (100 − รวม) = ไม่ได้รางวัล

export type LuckyPrize = { id: string; name: string; kind: 'points' | 'coupon' | 'item'; amount: number; chance: number }

// 32 ตัว (= 2^5) ไม่มี 0/O/1/I ให้อ่านผิดง่าย · หารลงตัวกับไบต์ 256 จึงสุ่มไม่เอนเอียง
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// token 192 บิต (24 ไบต์) → 32 ตัวแบบ base64url ไม่มี padding (รูปแบบเดียวกับลิงก์ออร์เดอร์)
export const isTokenShape = (t: string): boolean => /^[A-Za-z0-9_-]{32}$/.test(t)
export function tokenFromBytes(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// รหัสรางวัลที่พนักงานใช้ตรวจ (6 ตัว)
export function codeFromBytes(b: Uint8Array, len = 6): string {
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[b[i] % 32]
  return s
}

// เลขสุ่มช่วง [0, 100) จาก 4 ไบต์ (ใช้ 32 บิตเต็ม ไม่มีอคติที่มีนัยสำคัญ)
export function percentFromBytes(b: Uint8Array): number {
  const n = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
  return (n / 4294967296) * 100
}

// ตรวจรายการรางวัลก่อนบันทึก: ชื่อไม่ว่าง โอกาส ≥ 0 และรวมไม่เกิน 100
export function validatePrizes(prizes: LuckyPrize[]): string {
  if (prizes.some((p) => !String(p.name ?? '').trim())) return 'ทุกรางวัลต้องมีชื่อ'
  if (prizes.some((p) => !(Number(p.chance) >= 0))) return 'โอกาสต้องไม่ติดลบ'
  const sum = prizes.reduce((s, p) => s + (Number(p.chance) || 0), 0)
  if (sum > 100 + 1e-9) return `โอกาสรวมเกิน 100% (ตอนนี้ ${sum.toFixed(2)}%)`
  return ''
}

// r ∈ [0, 100): เรียงตามรายการ สะสมโอกาส · r ตกในช่วงของรางวัลใด = ได้รางวัลนั้น · เกินผลรวม = ไม่ได้รางวัล
export function pickPrize(prizes: LuckyPrize[], r: number): LuckyPrize | null {
  let acc = 0
  for (const p of prizes) {
    acc += Number(p.chance) || 0
    if (r < acc) return p
  }
  return null
}

// การลุ้นครั้งถัดไปของบิลหนึ่ง: บิลมีจำนวนครั้งลุ้น (draws) ตามยอดที่จ่ายจริงตอนออก QR
// rnd ต้องมี 10 ไบต์ (4 ไบต์แรกสุ่มรางวัล · 6 ไบต์ถัดไปเป็นรหัสรางวัล) · คืน null ถ้าลุ้นครบแล้ว
export function nextSpin(args: { draws: number; spinCount: number; prizes: LuckyPrize[]; rnd: Uint8Array; nowIso: string; prizeDays: number }) {
  if (!(args.spinCount < args.draws)) return null
  const won = pickPrize(args.prizes, percentFromBytes(args.rnd.subarray(0, 4)))
  const days = Math.min(365, Math.max(1, Math.round(Number(args.prizeDays) || 30)))
  return {
    at: args.nowIso,
    prize: won ? { id: won.id, name: won.name, kind: won.kind, amount: Number(won.amount) || 0 } : null,
    code: won ? codeFromBytes(args.rnd.subarray(4, 10)) : null,
    codeExpiresAt: won ? new Date(Date.parse(args.nowIso) + days * 86400000).toISOString() : null,
    redeemedAt: null,
    redeemedBy: null,
  }
}

// ช่วงเวลาที่เปิดให้ลุ้น (from ≤ now ≤ to) · ค่าที่อ่านไม่ได้ = ไม่เปิด
export function inWindow(cfg: { from?: string; to?: string }, nowMs: number): boolean {
  const f = cfg.from ? Date.parse(cfg.from) : NaN
  const t = cfg.to ? Date.parse(cfg.to) : NaN
  if (Number.isNaN(f) || Number.isNaN(t)) return false
  return nowMs >= f && nowMs <= t
}
