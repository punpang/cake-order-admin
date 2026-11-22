// ทดสอบ customer-auth ทั้งฟังก์ชัน: ดึง handler ที่ Deno.serve รับไว้ แล้วยิงคำขอจริงเข้าไป โดยใช้ฐานข้อมูลจำลองในหน่วยความจำ (fakesb.ts)
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/customer-auth/importmap.json supabase/tests/functions/customer-auth/
// ครอบคลุมสิ่งที่เทสต์หน่วยไม่เห็น: การต่อสาย authguard เข้ากับ login / otp_verify และการเขียนแบบเทียบเวอร์ชันของ update_profile (รวมกรณียิงพร้อมกัน)
import { assert, assertEquals } from 'jsr:@std/assert@1'
let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://fake'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'k')
await import('../../../functions/customer-auth/index.ts')
const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
async function pbkdf2(pin: string, salt: string) { const k = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']); return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 210000 }, k, 256)) }
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
let ipn = 0
const call = async (body: any, ip?: string) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { 'cf-connecting-ip': ip ?? `9.9.9.${++ipn}` }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() } }
const D = () => (globalThis as any).__DB
async function seed(failed = 0, locked: string | null = null) {
  const salt = 'ab'.repeat(8)
  ;(globalThis as any).__DB = { tick: 0, hooks: {}, t: {
    punpang_customers: [{ id: 'c1', name: 'ทดสอบ', phone: '0812345678', note: '', data: { active: true, ledger: [{ id: 'l1', pts: 5 }], spins: 1 }, updated_at: '2026-11-14T00:00:00.000000+00:00' }],
    punpang_customer_auth: [{ customer_id: 'c1', phone: '0812345678', pin_salt: salt, pin_hash: await pbkdf2('135792', salt), failed, locked_until: locked }],
    punpang_otps: [], punpang_customer_sessions: [], punpang_orders: [], punpang_records: [], punpang_kv: [], punpang_sms_log: [],
  } }
}
const good = { action: 'login', phone: '0812345678', pin: '135792' }
const bad = { action: 'login', phone: '0812345678', pin: '246801' }

Deno.test('login: ถูก → เข้าสู่ระบบ ได้ session และล้างตัวนับ', async () => {
  await seed(3, null)
  const r = await call(good)
  assertEquals(r.status, 200); assert(r.body.session?.token); assertEquals(r.body.customer.id, 'c1')
  assertEquals(D().t.punpang_customer_auth[0].failed, 0); assertEquals(D().t.punpang_customer_auth[0].locked_until, null)
})
Deno.test('login: ผิดทีละครั้ง → เหลือ 4,3,2,1 แล้วล็อก · ล็อกแล้วแม้ PIN ถูกก็เข้าไม่ได้ · ล็อกหมดเวลา → เข้าได้และล้างตัวนับ', async () => {
  await seed()
  for (const left of [4, 3, 2, 1]) { const r = await call(bad); assertEquals(r.status, 401); assert(r.body.error.includes(`เหลือ ${left} ครั้ง`), r.body.error) }
  const r5 = await call(bad); assertEquals(r5.status, 423); assert(r5.body.locked)
  const r6 = await call(good); assertEquals(r6.status, 423); assert(r6.body.error.includes('ล็อกอีก'), r6.body.error)
  D().t.punpang_customer_auth[0].locked_until = new Date(Date.now() - 1000).toISOString()
  const r7 = await call(good); assertEquals(r7.status, 200)
  assertEquals([D().t.punpang_customer_auth[0].failed, D().t.punpang_customer_auth[0].locked_until], [0, null])
})
Deno.test('login: ผิด 4 ครั้งแล้วถูกครั้งที่ 5 → เข้าได้ (เหมือนเดิม) และล้างตัวนับ', async () => {
  await seed(4, null)
  const r = await call(good); assertEquals(r.status, 200)
  assertEquals(D().t.punpang_customer_auth[0].failed, 0)
})
Deno.test('login: ยิง PIN ผิดพร้อมกัน 60 คำขอ → ถูกตรวจจริงไม่เกิน 5 ครั้ง ที่เหลือถูกล็อก', async () => {
  await seed()
  const out = await Promise.all(Array.from({ length: 60 }, () => call(bad)))
  const checked = out.filter((r) => r.status === 401 || (r.status === 423 && r.body.error.includes('ครบ')))
  const locked = out.filter((r) => r.status === 423 && r.body.error.includes('ล็อกอีก'))
  assertEquals(checked.length, 5)
  assertEquals(locked.length, 55)
  assertEquals(out.filter((r) => r.status === 429).length, 0)
})

Deno.test('login: ผิดซ้ำหลังล็อกหมดเวลา → นับต่อจากเดิม และล็อกนานขึ้นเป็น 30 นาที (ไม่กลับไป 15 นาที)', async () => {
  await seed(5, new Date(Date.now() - 1000).toISOString())
  const r = await call(bad)
  assertEquals(r.status, 423)
  assert(r.body.error.includes('ผิดครบ 6 ครั้ง') && r.body.error.includes('ล็อก 30 นาที'), r.body.error)
  assertEquals(D().t.punpang_customer_auth[0].failed, 6)
})

Deno.test('login: ลองผิดครบ 10 ครั้งของวันเดียวกัน → ถูกปฏิเสธแม้ PIN ถูก · ตัวนับเป็นของวันนี้ (เวลาไทย)', async () => {
  await seed(0, null)
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
  Object.assign(D().t.punpang_customer_auth[0], { day_key: today, day_fails: 10 })
  const r = await call(good)
  assertEquals(r.status, 423)
  assert(r.body.locked && r.body.error.includes('ลองผิดครบ 10 ครั้ง'), r.body.error)
})

Deno.test('login: เข้าสำเร็จแล้วล้างตัวนับรายวันด้วย', async () => {
  await seed(0, null)
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
  Object.assign(D().t.punpang_customer_auth[0], { day_key: today, day_fails: 4 })
  const r = await call(good)
  assertEquals(r.status, 200)
  assertEquals(D().t.punpang_customer_auth[0].day_fails, 0)
})
Deno.test('login: เบอร์ไม่มีบัญชี → ข้อความเดียวกับ PIN ผิด (ไม่เผยว่ามีบัญชีหรือไม่)', async () => {
  await seed()
  const r = await call({ action: 'login', phone: '0899999999', pin: '135792' })
  assertEquals(r.status, 401); assertEquals(r.body.error, 'เบอร์โทรหรือ PIN ไม่ถูกต้อง')
})

async function otpSeed(code: string, attempts = 0) {
  await seed()
  const salt = 'cd'.repeat(4)
  D().t.punpang_otps.push({ id: 'a'.repeat(32), phone: '0812345678', purpose: 'reset', code_hash: await sha(`${salt}:${code}`), salt, sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 300000).toISOString(), attempts, verified_until: null, used: false, ip: '', customer_id: null })
}
const vf = (code: string) => call({ action: 'otp_verify', purpose: 'reset', phone: '0812345678', code })
Deno.test('otp_verify: ผิดทีละครั้งนับถอยหลัง 4..1 แล้วหมดสิทธิ์ · ถูกครั้งที่ 5 ผ่าน', async () => {
  await otpSeed('123456')
  for (const left of [4, 3, 2, 1]) { const r = await vf('000000'); assertEquals(r.status, 400); assert(r.body.error.includes(`เหลือ ${left} ครั้ง`), r.body.error) }
  const ok = await vf('123456'); assertEquals(ok.status, 200); assert(ok.body.token)
  await otpSeed('123456')
  for (let i = 0; i < 5; i++) await vf('000000')
  const dead = await vf('123456'); assertEquals(dead.status, 400); assert(dead.body.expired)
})
Deno.test('otp_verify: ยิงรหัสผิดพร้อมกัน 80 คำขอ → ตรวจจริงไม่เกิน 5 ครั้ง · รหัสที่ถูกถูกปฏิเสธเพราะหมดสิทธิ์', async () => {
  await otpSeed('123456')
  const out = await Promise.all(Array.from({ length: 80 }, () => vf('000000')))
  const wrong = out.filter((r) => r.status === 400 && r.body.error.startsWith('รหัสไม่ถูกต้อง')).length + out.filter((r) => r.status === 400 && r.body.error.includes('กรอกผิดเกิน')).length
  assertEquals(D().t.punpang_otps[0].attempts, 5)
  assertEquals(out.filter((r) => r.status === 429).length, 0)
  assertEquals((await vf('123456')).status, 400)
  assert(wrong >= 5)
})

async function sessionFor(cid = 'c1') {
  const token = 'f'.repeat(64)
  D().t.punpang_customer_sessions.push({ token_hash: await sha(`custsess:${token}`), customer_id: cid, expires_at: new Date(Date.now() + 3600000).toISOString() })
  return token
}
Deno.test('ensure_scan_code: สร้างรหัสสมาชิก 32 ตัวอักษร (hex) ครั้งเดียว · เรียกซ้ำได้รหัสเดิม · ไม่แตะแต้ม', async () => {
  await seed(); const s = await sessionFor()
  const r1 = await call({ action: 'ensure_scan_code', session: s })
  assertEquals(r1.status, 200)
  const code = D().t.punpang_customers[0].data.scanCode
  assert(/^[0-9a-f]{32}$/.test(code), code)
  assertEquals(r1.body.customer.scanCode, code)
  const r2 = await call({ action: 'ensure_scan_code', session: s })
  assertEquals(r2.status, 200)
  assertEquals(D().t.punpang_customers[0].data.scanCode, code)
  assertEquals(D().t.punpang_customers[0].data.ledger.length, 1)
})
Deno.test('ensure_scan_code: เซสชันไม่ถูกต้อง → 401 และไม่สร้างรหัส', async () => {
  await seed()
  const r = await call({ action: 'ensure_scan_code', session: 'x'.repeat(64) })
  assertEquals(r.status, 401)
  assertEquals(D().t.punpang_customers[0].data.scanCode, undefined)
})

Deno.test('update_profile: บันทึกชื่อ/โปรโมชัน และไม่แตะแต้ม', async () => {
  await seed(); const s = await sessionFor()
  const r = await call({ action: 'update_profile', session: s, name: 'ชื่อใหม่', promoOptIn: true })
  assertEquals(r.status, 200)
  const c = D().t.punpang_customers[0]
  assertEquals([c.name, c.data.promoOptIn, c.data.ledger.length, c.data.spins], ['ชื่อใหม่', true, 1, 1])
})
Deno.test('update_profile: แต้มถูกเปลี่ยนระหว่างอ่านกับเขียน → ไม่ถูกเขียนทับ (อ่านใหม่แล้วเขียนซ้ำ)', async () => {
  await seed(); const s = await sessionFor()
  D().hooks['beforeUpdate:punpang_customers'] = (list: any[]) => { const c = list[0]; c.data = { ...c.data, ledger: [...c.data.ledger, { id: 'l2', pts: 99 }], spins: 4 }; c.updated_at = '2026-11-14T01:00:00.000000+00:00' }
  const r = await call({ action: 'update_profile', session: s, name: 'ชื่อใหม่', promoOptIn: false })
  assertEquals(r.status, 200)
  const c = D().t.punpang_customers[0]
  assertEquals([c.name, c.data.ledger.length, c.data.spins], ['ชื่อใหม่', 2, 4])
})
Deno.test('update_profile: ถูกแก้ชนทุกรอบ → 409 ไม่เขียนทับ', async () => {
  await seed(); const s = await sessionFor()
  const orig = D().t.punpang_customers[0]
  let n = 0
  const bump = (list: any[]) => { n++; list[0].updated_at = `2026-11-14T02:00:0${n}.000000+00:00`; D().hooks['beforeUpdate:punpang_customers'] = bump }
  D().hooks['beforeUpdate:punpang_customers'] = bump
  const r = await call({ action: 'update_profile', session: s, name: 'ไม่ควรถูกบันทึก' })
  assertEquals(r.status, 409); assert(orig.name !== 'ไม่ควรถูกบันทึก')
})

Deno.test('tier: โหมดใช้จริงส่งระดับ → แนบเฉพาะฟิลด์ที่อนุญาต (ไม่มี cum) และส่ง p_customer ของลูกค้าที่เข้าสู่ระบบ', async () => {
  await seed(0, null)
  let arg: any = null
  D().hooks['rpc:punpang_member_card'] = async (a: any) => {
    arg = a
    return { data: { enabled: true, levelNo: 2, levelName: 'LV2', mult: 3, status: 'active', golden: false, renewAt: '2026-11-14', activeUntil: '2027-02-12', downgradeAt: '2027-11-14', cum: 1000 }, error: null }
  }
  const r = await call(good)
  assertEquals(r.status, 200)
  assertEquals(arg, { p_customer: 'c1' })
  assertEquals(r.body.tier, { enabled: true, levelNo: 2, levelName: 'LV2', mult: 3, status: 'active', golden: false, renewAt: '2026-11-14', activeUntil: '2027-02-12', downgradeAt: '2027-11-14' })
})

Deno.test('tier: ปิดระดับ / ฟังก์ชันตอบ error / โยนข้อผิดพลาด → เข้าสู่ระบบได้ และ tier = { enabled: false }', async () => {
  const cases: Array<(a: any) => Promise<any>> = [
    async () => ({ data: { enabled: false }, error: null }),
    async () => ({ data: null, error: { message: 'boom' } }),
    async () => { throw new Error('down') },
  ]
  for (const hook of cases) {
    await seed(0, null)
    D().hooks['rpc:punpang_member_card'] = hook
    const r = await call(good)
    assertEquals(r.status, 200)
    assertEquals(r.body.tier, { enabled: false })
  }
})
