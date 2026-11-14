import { assert, assertEquals } from 'jsr:@std/assert@1'
import { type OtpRow, type OtpStore, type PinRow, type PinStore, reserveOtpAttempt, reservePinAttempt } from './authguard.ts'

const T0 = Date.UTC(2026, 10, 14, 3, 0, 0)
const PIN = { maxFails: 5, lockMs: 15 * 60_000 }
// หน่วงแบบสุ่มระหว่างอ่าน/เขียน เพื่อให้คำขอสลับกันทำงานเหมือนหลายคำขอพร้อมกันจริง
const jitter = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 4)))

function memPin(init: PinRow) {
  const st: PinRow = { ...init }
  const stats = { reads: 0, writes: 0 }
  const store: PinStore = {
    async read() { stats.reads++; await jitter(); return { ...st } },
    async casFailed(expect, patch) {
      await jitter()
      // ตรวจและเขียนในก้อนเดียว (ไม่มี await คั่น) = เหมือน UPDATE ... WHERE failed = expect ของฐานข้อมูล
      if ((st.failed ?? 0) !== expect) return false
      st.failed = patch.failed; st.locked_until = patch.locked_until; stats.writes++
      return true
    },
  }
  return { st, store, stats }
}

Deno.test('PIN: จองทีละครั้ง 1-4 ผ่านโดยยังไม่ล็อก · ครั้งที่ 5 ผ่านและล็อกไว้ล่วงหน้า · ครั้งที่ 6 ถูกล็อก', async () => {
  const { st, store } = memPin({ failed: 0, locked_until: null })
  const now = () => T0
  for (let i = 1; i <= 4; i++) {
    assertEquals(await reservePinAttempt(store, { ...PIN, now }), { ok: true, n: i })
    assertEquals(st.locked_until, null)
  }
  assertEquals(await reservePinAttempt(store, { ...PIN, now }), { ok: true, n: 5 })
  assertEquals(st.locked_until, new Date(T0 + PIN.lockMs).toISOString())
  assertEquals(await reservePinAttempt(store, { ...PIN, now }), { ok: false, reason: 'locked', until: T0 + PIN.lockMs })
})

Deno.test('PIN: ยิงพร้อมกัน 100 คำขอ → ได้ตรวจรหัสจริงไม่เกิน 5 ครั้งพอดี (ครั้งที่ 1-5 ไม่ซ้ำ) ที่เหลือถูกล็อก', async () => {
  for (let round = 0; round < 5; round++) {
    const { st, store } = memPin({ failed: 0, locked_until: null })
    const out = await Promise.all(Array.from({ length: 100 }, () => reservePinAttempt(store, PIN)))
    const ok = out.filter((r): r is { ok: true; n: number } => r.ok)
    assertEquals(ok.map((r) => r.n).sort(), [1, 2, 3, 4, 5])
    assertEquals(out.filter((r) => !r.ok && r.reason === 'locked').length, 95)
    assertEquals(out.filter((r) => !r.ok && r.reason === 'busy').length, 0)
    assertEquals(st.failed, 5)
    assert(st.locked_until && new Date(st.locked_until).getTime() > Date.now())
  }
})

Deno.test('PIN: เริ่มที่ 3 ครั้งแล้ว ยิงพร้อมกัน → จองได้อีก 2 ครั้งเท่านั้น', async () => {
  const { store } = memPin({ failed: 3, locked_until: null })
  const out = await Promise.all(Array.from({ length: 40 }, () => reservePinAttempt(store, PIN)))
  assertEquals(out.filter((r) => r.ok).map((r) => (r.ok ? r.n : 0)).sort(), [4, 5])
})

Deno.test('PIN: ล็อกยังไม่หมดเวลา → ถูกล็อกโดยไม่เขียนอะไร · ล็อกหมดเวลาแล้ว → เริ่มนับใหม่จาก 1 และล้างเวลาล็อก', async () => {
  const future = new Date(T0 + 5 * 60_000).toISOString()
  const a = memPin({ failed: 0, locked_until: future }) // รูปแบบเดิม (ล็อกพร้อม failed = 0)
  assertEquals(await reservePinAttempt(a.store, { ...PIN, now: () => T0 }), { ok: false, reason: 'locked', until: T0 + 5 * 60_000 })
  assertEquals(a.stats.writes, 0)

  const expired = new Date(T0 - 1000).toISOString()
  const b = memPin({ failed: 5, locked_until: expired })
  assertEquals(await reservePinAttempt(b.store, { ...PIN, now: () => T0 }), { ok: true, n: 1 })
  assertEquals(b.st, { failed: 1, locked_until: null })
})

Deno.test('PIN: ตัวนับเต็มแต่ไม่มีเวลาล็อก (ข้อมูลผิดปกติ) → ผ่านได้อีกครั้งเดียวแล้วล็อก ไม่ปล่อยให้เดาต่อไม่จำกัด', async () => {
  const { st, store } = memPin({ failed: 5, locked_until: null })
  assertEquals(await reservePinAttempt(store, { ...PIN, now: () => T0 }), { ok: true, n: 6 })
  assert(st.locked_until)
  assertEquals((await reservePinAttempt(store, { ...PIN, now: () => T0 })).ok, false)
})

Deno.test('PIN: ไม่พบบัญชี → missing · เขียนแย่งกันไม่จบ → busy (หยุดตามจำนวนรอบ ไม่วนไม่รู้จบ)', async () => {
  assertEquals(await reservePinAttempt({ read: async () => null, casFailed: async () => true }, PIN), { ok: false, reason: 'missing' })
  let reads = 0
  const never: PinStore = { read: async () => { reads++; return { failed: 0, locked_until: null } }, casFailed: async () => false }
  assertEquals(await reservePinAttempt(never, { ...PIN, maxRetry: 4 }), { ok: false, reason: 'busy' })
  assertEquals(reads, 4)
})

Deno.test('PIN: ส่งแถวที่อ่านมาแล้วเข้าไปด้วย → ไม่อ่านซ้ำเมื่อเขียนได้ในรอบแรก', async () => {
  const { store, stats } = memPin({ failed: 1, locked_until: null })
  assertEquals(await reservePinAttempt(store, PIN, { failed: 1, locked_until: null }), { ok: true, n: 2 })
  assertEquals(stats.reads, 0)
})

function memOtp(init: OtpRow) {
  const st: OtpRow = { ...init }
  const store: OtpStore = {
    async read() { await jitter(); return { ...st } },
    async casAttempts(expect) {
      await jitter()
      if ((st.attempts ?? 0) !== expect || st.used) return false
      st.attempts = expect + 1
      return true
    },
  }
  return { st, store }
}
const OTP = { maxTries: 5 }
const exp = (ms: number) => new Date(Date.now() + ms).toISOString()

Deno.test('OTP: จองทีละครั้ง 1-5 ผ่าน · ครั้งที่ 6 หมดสิทธิ์', async () => {
  const { store } = memOtp({ attempts: 0, used: false, expires_at: exp(60_000) })
  for (let i = 1; i <= 5; i++) assertEquals(await reserveOtpAttempt(store, OTP), { ok: true, attempts: i })
  assertEquals(await reserveOtpAttempt(store, OTP), { ok: false, reason: 'exhausted' })
})

Deno.test('OTP: ยิงพร้อมกัน 200 คำขอ → ตรวจรหัสจริงได้ไม่เกิน 5 ครั้งพอดี', async () => {
  for (let round = 0; round < 5; round++) {
    const { st, store } = memOtp({ attempts: 0, used: false, expires_at: exp(60_000) })
    const out = await Promise.all(Array.from({ length: 200 }, () => reserveOtpAttempt(store, OTP)))
    assertEquals(out.filter((r) => r.ok).map((r) => (r.ok ? r.attempts : 0)).sort(), [1, 2, 3, 4, 5])
    assertEquals(out.filter((r) => !r.ok && r.reason === 'exhausted').length, 195)
    assertEquals(out.filter((r) => !r.ok && r.reason === 'busy').length, 0)
    assertEquals(st.attempts, 5)
  }
})

Deno.test('OTP: หมดอายุ → expired · ถูกใช้แล้ว/ไม่พบ → missing · ถูกใช้ระหว่างแย่งกันเขียน → missing · แย่งไม่จบ → busy', async () => {
  assertEquals(await reserveOtpAttempt(memOtp({ attempts: 0, used: false, expires_at: exp(-1000) }).store, OTP), { ok: false, reason: 'expired' })
  assertEquals(await reserveOtpAttempt(memOtp({ attempts: 0, used: true, expires_at: exp(60_000) }).store, OTP), { ok: false, reason: 'missing' })
  assertEquals(await reserveOtpAttempt({ read: async () => null, casAttempts: async () => true }, OTP), { ok: false, reason: 'missing' })
  // อ่านครั้งแรกยังไม่ถูกใช้ แต่ก่อนเขียนมีคนใช้รหัสไปแล้ว → เขียนไม่ได้ อ่านใหม่เห็นว่าใช้แล้ว
  const m = memOtp({ attempts: 0, used: false, expires_at: exp(60_000) })
  const racing: OtpStore = { read: m.store.read, casAttempts: async (e) => { m.st.used = true; return m.store.casAttempts(e) } }
  assertEquals(await reserveOtpAttempt(racing, OTP), { ok: false, reason: 'missing' })
  let reads = 0
  const never: OtpStore = { read: async () => { reads++; return { attempts: 0, used: false, expires_at: exp(60_000) } }, casAttempts: async () => false }
  assertEquals(await reserveOtpAttempt(never, { ...OTP, maxRetry: 3 }), { ok: false, reason: 'busy' })
  assertEquals(reads, 3)
})
