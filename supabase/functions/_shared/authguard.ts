// จองครั้งที่ลองผิดของ PIN / OTP แบบ atomic (compare-and-swap) ก่อนตรวจรหัส
// ปัญหาเดิม: อ่านจำนวนครั้ง → ตรวจรหัส → เขียน "จำนวน + 1" ทีหลัง · ยิงคำขอพร้อมกันหลายร้อยคำขอ ทุกคำขออ่านได้ 0 เหมือนกันหมด
//   จึงเดา PIN/OTP ได้มากกว่าเพดาน (5 ครั้ง) หลายเท่าก่อนที่ตัวนับจะขยับ
// วิธีนี้: จองครั้งที่ n ด้วยการเขียนแบบมีเงื่อนไข (เขียนได้เฉพาะเมื่อค่าในฐานข้อมูลยังเท่ากับที่อ่านมา) แล้วค่อยตรวจรหัส
//   คำขอที่แย่งกันเขียนไม่สำเร็จจะอ่านใหม่แล้วลองอีกครั้ง → จำนวนที่ได้ตรวจรหัสจริงรวมกันไม่เกินเพดานเสมอ ไม่ว่าจะพร้อมกันกี่คำขอ
// ไม่พึ่งฟังก์ชันฐานข้อมูลใหม่ (ไม่มีลำดับ deploy) · ตัวเก็บ (store) ถูกฉีดเข้ามา จึงทดสอบกับตัวจำลองได้
// PIN: ตัวนับไม่เริ่มใหม่เมื่อหมดเวลาล็อก (นับต่อเนื่องจนเข้าสู่ระบบสำเร็จหรือรีเซ็ต) ผิดซ้ำหลังถูกล็อกแล้วล็อกนานขึ้นเป็นสองเท่า
//   และมีเพดานต่อวัน (เวลาไทย) นับเฉพาะการลองที่ยังไม่สำเร็จติดกันในวันนั้น

export type PinRow = {
  failed: number | null
  locked_until: string | null
  day_key?: string | null // วันที่ (เวลาไทย) ของตัวนับรายวัน
  day_fails?: number | null // จำนวนครั้งที่ลองผิดติดกันในวัน day_key
}

export interface PinStore {
  read(): Promise<PinRow | null>
  // เขียน patch เฉพาะเมื่อ failed ในฐานข้อมูลยังเท่ากับ expectFailed · คืน true เมื่อเขียนได้
  casFailed(
    expectFailed: number,
    patch: { failed: number; locked_until: string | null; day_key: string; day_fails: number },
  ): Promise<boolean>
}

export type PinGate =
  | { ok: true; n: number; lockMs?: number } // จองครั้งที่ n แล้ว · lockMs มีเมื่อการจองนี้ล็อกบัญชี (ตั้งล็อกไว้ล่วงหน้าแล้ว)
  | { ok: false; reason: 'locked'; until: number }
  | { ok: false; reason: 'daily'; until: number } // ลองผิดครบเพดานของวันนี้ · until = เที่ยงคืนเวลาไทยของวันถัดไป
  | { ok: false; reason: 'busy' } // แย่งกันเขียนเกินจำนวนรอบ (คำขอพร้อมกันมาก) → ให้ลองใหม่
  | { ok: false; reason: 'missing' }

export const PIN_DAILY_MAX = 10 // ลองผิดได้กี่ครั้งต่อวันต่อบัญชี
export const PIN_LOCK_CAP_MS = 24 * 60 * 60_000 // ล็อกนานสุด 24 ชม.
const LOCK_DOUBLINGS_MAX = 20 // ผิดซ้ำหลังถูกล็อกแต่ละครั้งเพิ่มเวลาล็อกเป็นสองเท่า (ตัวคูณสูงสุดกันค่าล้น · เพดานเวลาจริงคือ PIN_LOCK_CAP_MS)

const DEFAULT_RETRY = 8
const DAY_MS = 86_400_000
const BKK_OFFSET_MS = 7 * 3600_000 // เวลาไทย UTC+7 (ไม่มีเวลาออมแสง)

// วันตามเวลาไทย: key = วันที่ YYYY-MM-DD · endMs = เที่ยงคืนเวลาไทยของวันถัดไป
export function bangkokDay(t: number): { key: string; endMs: number } {
  const idx = Math.floor((t + BKK_OFFSET_MS) / DAY_MS)
  return { key: new Date(idx * DAY_MS).toISOString().slice(0, 10), endMs: (idx + 1) * DAY_MS - BKK_OFFSET_MS }
}

// ล็อกถูกตั้งพร้อมกับการจองครั้งสุดท้าย (ไม่รอผลตรวจรหัส) · ตรวจรหัสสำเร็จ = ผู้เรียกล้างตัวนับและปลดล็อกเอง
//   ผลดี: คำขอที่ค้างระหว่างทาง (instance ถูกปิด ฯลฯ) ไม่ทำให้บัญชีค้างสถานะ "เต็มแต่ไม่ล็อก"
export async function reservePinAttempt(
  store: PinStore,
  o: { maxFails: number; lockMs: number; dailyMax?: number; lockCapMs?: number; now?: () => number; maxRetry?: number },
  first?: PinRow | null,
): Promise<PinGate> {
  const now = o.now ?? Date.now
  const tries = o.maxRetry ?? DEFAULT_RETRY
  const dailyMax = o.dailyMax ?? PIN_DAILY_MAX
  const lockCapMs = o.lockCapMs ?? PIN_LOCK_CAP_MS
  let row = first === undefined ? await store.read() : first
  for (let i = 0; i < tries; i++) {
    if (!row) return { ok: false, reason: 'missing' }
    const t = now()
    const lockedAt = row.locked_until ? new Date(row.locked_until).getTime() : NaN
    if (Number.isFinite(lockedAt) && lockedAt > t) return { ok: false, reason: 'locked', until: lockedAt }
    const day = bangkokDay(t)
    const expect = Math.max(0, Number(row.failed) || 0)
    const dayFails = row.day_key === day.key ? Math.max(0, Number(row.day_fails) || 0) : 0
    if (dayFails >= dailyMax) return { ok: false, reason: 'daily', until: day.endMs }
    const n = expect + 1 // นับต่อจากเดิมเสมอ ไม่เริ่มนับใหม่เมื่อหมดเวลาล็อก
    const lock = n >= o.maxFails
    const lockMs = lock ? Math.min(o.lockMs * 2 ** Math.min(n - o.maxFails, LOCK_DOUBLINGS_MAX), lockCapMs) : 0
    const patch = {
      failed: n,
      locked_until: lock ? new Date(t + lockMs).toISOString() : null,
      day_key: day.key,
      day_fails: dayFails + 1,
    }
    if (await store.casFailed(expect, patch)) return lock ? { ok: true, n, lockMs } : { ok: true, n }
    if (i < tries - 1) row = await store.read() // มีคำขออื่นเขียนไปก่อน → อ่านค่าใหม่แล้วลองอีกครั้ง (รอบสุดท้ายไม่ต้องอ่านเพิ่ม)
  }
  return { ok: false, reason: 'busy' }
}

export type OtpRow = { attempts: number | null; used?: boolean | null; expires_at: string }

export interface OtpStore {
  read(): Promise<OtpRow | null>
  // เพิ่ม attempts เป็น expect + 1 เฉพาะเมื่อ attempts ยังเท่ากับ expect และรหัสยังไม่ถูกใช้ · คืน true เมื่อเขียนได้
  casAttempts(expect: number): Promise<boolean>
}

export type OtpGate =
  | { ok: true; attempts: number } // จองครั้งที่ attempts แล้ว (ครั้งที่ตรวจรหัสจริงนี้นับรวมแล้ว)
  | { ok: false; reason: 'missing' | 'expired' | 'exhausted' | 'busy' }

export async function reserveOtpAttempt(
  store: OtpStore,
  o: { maxTries: number; now?: () => number; maxRetry?: number },
  first?: OtpRow | null,
): Promise<OtpGate> {
  const now = o.now ?? Date.now
  const tries = o.maxRetry ?? DEFAULT_RETRY
  let row = first === undefined ? await store.read() : first
  for (let i = 0; i < tries; i++) {
    if (!row || row.used) return { ok: false, reason: 'missing' }
    if (now() > new Date(row.expires_at).getTime()) return { ok: false, reason: 'expired' }
    const cur = Math.max(0, Number(row.attempts) || 0)
    if (cur >= o.maxTries) return { ok: false, reason: 'exhausted' }
    if (await store.casAttempts(cur)) return { ok: true, attempts: cur + 1 }
    if (i < tries - 1) row = await store.read()
  }
  return { ok: false, reason: 'busy' }
}
