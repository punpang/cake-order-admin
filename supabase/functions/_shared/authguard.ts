// จองครั้งที่ลองผิดของ PIN / OTP แบบ atomic (compare-and-swap) ก่อนตรวจรหัส
// ปัญหาเดิม: อ่านจำนวนครั้ง → ตรวจรหัส → เขียน "จำนวน + 1" ทีหลัง · ยิงคำขอพร้อมกันหลายร้อยคำขอ ทุกคำขออ่านได้ 0 เหมือนกันหมด
//   จึงเดา PIN/OTP ได้มากกว่าเพดาน (5 ครั้ง) หลายเท่าก่อนที่ตัวนับจะขยับ
// วิธีนี้: จองครั้งที่ n ด้วยการเขียนแบบมีเงื่อนไข (เขียนได้เฉพาะเมื่อค่าในฐานข้อมูลยังเท่ากับที่อ่านมา) แล้วค่อยตรวจรหัส
//   คำขอที่แย่งกันเขียนไม่สำเร็จจะอ่านใหม่แล้วลองอีกครั้ง → จำนวนที่ได้ตรวจรหัสจริงรวมกันไม่เกินเพดานเสมอ ไม่ว่าจะพร้อมกันกี่คำขอ
// ไม่พึ่งฟังก์ชันฐานข้อมูลใหม่ (ไม่มีลำดับ deploy) · ตัวเก็บ (store) ถูกฉีดเข้ามา จึงทดสอบกับตัวจำลองได้

export type PinRow = { failed: number | null; locked_until: string | null }

export interface PinStore {
  read(): Promise<PinRow | null>
  // เขียน patch เฉพาะเมื่อ failed ในฐานข้อมูลยังเท่ากับ expectFailed · คืน true เมื่อเขียนได้
  casFailed(expectFailed: number, patch: { failed: number; locked_until: string | null }): Promise<boolean>
}

export type PinGate =
  | { ok: true; n: number } // จองครั้งที่ n ของรอบนี้แล้ว (n = maxFails คือครั้งสุดท้าย และล็อกบัญชีไว้ล่วงหน้าแล้ว)
  | { ok: false; reason: 'locked'; until: number }
  | { ok: false; reason: 'busy' } // แย่งกันเขียนเกินจำนวนรอบ (คำขอพร้อมกันมาก) → ให้ลองใหม่
  | { ok: false; reason: 'missing' }

const DEFAULT_RETRY = 8

// ล็อกถูกตั้งพร้อมกับการจองครั้งสุดท้าย (ไม่รอผลตรวจรหัส) · ตรวจรหัสสำเร็จ = ผู้เรียกล้างตัวนับและปลดล็อกเอง
//   ผลดี: คำขอที่ค้างระหว่างทาง (instance ถูกปิด ฯลฯ) ไม่ทำให้บัญชีค้างสถานะ "เต็มแต่ไม่ล็อก" · พอครบเวลาล็อกจะเริ่มนับใหม่เอง
export async function reservePinAttempt(
  store: PinStore,
  o: { maxFails: number; lockMs: number; now?: () => number; maxRetry?: number },
  first?: PinRow | null,
): Promise<PinGate> {
  const now = o.now ?? Date.now
  const tries = o.maxRetry ?? DEFAULT_RETRY
  let row = first === undefined ? await store.read() : first
  for (let i = 0; i < tries; i++) {
    if (!row) return { ok: false, reason: 'missing' }
    const t = now()
    const lockedAt = row.locked_until ? new Date(row.locked_until).getTime() : NaN
    if (Number.isFinite(lockedAt) && lockedAt > t) return { ok: false, reason: 'locked', until: lockedAt }
    const expect = Math.max(0, Number(row.failed) || 0)
    const base = Number.isFinite(lockedAt) ? 0 : expect // ล็อกหมดเวลาแล้ว = เริ่มนับใหม่
    const n = base + 1
    const lock = n >= o.maxFails
    if (await store.casFailed(expect, { failed: n, locked_until: lock ? new Date(t + o.lockMs).toISOString() : null })) return { ok: true, n }
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
