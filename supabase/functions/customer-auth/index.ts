import { modeOf, refuseInTest } from '../_shared/mode.ts'
import { corsWrap } from '../_shared/cors.ts'
import { gwFetch } from '../_shared/gwfetch.ts'
import { reserveOtpAttempt, reservePinAttempt } from '../_shared/authguard.ts'
import { filesEnv, isR2Ref, keyOfR2Ref, svcSign } from '../_shared/filesvc.ts'
import { clientIp } from '../_shared/ratelimit.ts'
import { promoConsentPatch } from '../_shared/schedlib/promoConsent.js'
import { publicPaymentOf } from '../_shared/shoppay.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

// ระบบบัญชีลูกค้าฝั่งเซิร์ฟเวอร์: OTP ทาง SMS (เกตเวย์ของร้าน) + PIN 6 หลัก + เซสชัน
// ตารางทั้งหมด (OTP/PIN/เซสชัน) เปิด RLS ไม่มี policy → เข้าถึงได้เฉพาะ service role ในฟังก์ชันนี้
// รหัส OTP และ PIN เก็บเฉพาะ hash (OTP = sha256 + salt · PIN = PBKDF2-SHA256 210,000 รอบ) · เซสชันเป็น token สุ่ม เก็บ hash
// การส่ง OTP ใช้ SMS Gateway API v1 เดียวกับ sms-send: POST {SMS_GATEWAY_URL}/v1/sms · Bearer SMS_API_KEY · Idempotency-Key = รหัส OTP (กันส่งซ้ำเมื่อลองใหม่)
const CORS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const MIN = 60000
// perAllHour: เพดานรวมทั้งระบบต่อชั่วโมง (กันถูกยิงขอ OTP ถึงเบอร์คนอื่นเพื่อเผาโควตา SMS แม้ปลอม IP ได้)
const OTP = { ttlMs: 5 * MIN, resendMs: MIN, maxTries: 5, verifiedMs: 10 * MIN, perPhoneHour: 5, perIpHour: 20, perAllHour: 120 }
const PIN = { maxFails: 5, lockMs: 15 * MIN, dailyMax: 10 } // ล็อกนานขึ้นเมื่อผิดซ้ำ (ดู _shared/authguard.ts) · ลองผิดได้ dailyMax ครั้งต่อวัน
const SESSION_MS = 14 * 24 * 3600 * 1000
const PBKDF2_ITER = 210000
const enc = new TextEncoder()
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const randHex = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)))
const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
async function pbkdf2(pin: string, saltHex: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations: PBKDF2_ITER }, key, 256))
}
// เบอร์มือถือไทย → { local: 0XXXXXXXXX, e164: +66XXXXXXXXX }
export function thaiPhone(raw: unknown) {
  const d = String(raw ?? '').replace(/[\s-]/g, '')
  const m = /^(?:\+66|66|0)([689]\d{8})$/.exec(d)
  return m ? { local: `0${m[1]}`, e164: `+66${m[1]}` } : null
}
export function weakPin(pin: string, phone = ''): string {
  const p = String(pin ?? '')
  if (!/^\d{6}$/.test(p)) return 'PIN ต้องเป็นตัวเลข 6 หลัก'
  if (/^(\d)\1{5}$/.test(p)) return 'PIN ห้ามเป็นเลขซ้ำกันทั้งหมด'
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) return 'PIN ห้ามเป็นเลขเรียงกัน'
  if (/^(\d\d)\1\1$/.test(p) || /^(\d\d\d)\1$/.test(p)) return 'PIN ห้ามเป็นรูปแบบซ้ำ'
  const d = String(phone).replace(/\D/g, '')
  if (d.length >= 6 && p === d.slice(-6)) return 'PIN ห้ามตรงกับเลขท้ายเบอร์โทร'
  return ''
}

const loginIpFails = new Map<string, number[]>()
const ipBlocked = (ip: string) => { const now = Date.now(); const a = (loginIpFails.get(ip) || []).filter((t) => now - t < 10 * MIN); loginIpFails.set(ip, a); return a.length >= 30 }

Deno.serve(corsWrap(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused // โหมดทดสอบไม่ทำงานฟังก์ชันนี้ (ข้อมูลลูกค้า/งานตามเวลา/เว็บฮุกเป็นของจริงเท่านั้น)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const ip = clientIp(req.headers) // cf-connecting-ip → ค่าท้ายสุดของ x-forwarded-for (ค่าซ้ายสุดผู้เรียกใส่เองได้ จึงไม่ใช้)
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const iso = (ms: number) => new Date(ms).toISOString()
  const BAD_LOGIN = { error: 'เบอร์โทรหรือ PIN ไม่ถูกต้อง' }
  const NEED_OTP = { error: 'กรุณายืนยัน OTP ก่อน (รหัสอาจหมดเวลา)' }

  // ---------- SMS (SMS Gateway API v1) ----------
  async function sendSms(local: string, text: string, idem: string): Promise<boolean> {
    const g = (Deno.env.get('SMS_GATEWAY_URL') || '').trim()
    const key = (Deno.env.get('SMS_API_KEY') || '').trim()
    let root = ''
    try { const u = new URL(g); if (/^https?:$/.test(u.protocol)) root = g.replace(/\/+$/, '').replace(/\/v1(\/sms|\/messages|\/status|\/health)?$/i, '') } catch { root = '' }
    if (!root || !key) return false
    let ok = false
    try {
      const r = await gwFetch(`${root}/v1/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${key}`, 'Idempotency-Key': idem },
        body: JSON.stringify({ to: local, message: text }),
        signal: AbortSignal.timeout(15000),
      })
      ok = r.status === 202 || r.status === 200
    } catch { ok = false }
    await sb.from('punpang_sms_log').insert({ user_id: null, kind: 'otp', to_tail: local.slice(-4), status: ok ? 'sent' : 'failed', detail: '' })
    return ok
  }

  // ---------- ข้อมูลของลูกค้า (ส่งให้หน้าบัญชี) ----------
  async function sign(v: unknown) {
    if (isR2Ref(v)) return (await svcSign(filesEnv(), keyOfR2Ref(v), 3600)) || ''
    const m = typeof v === 'string' ? /^sb:\/\/([a-z0-9-]+)\/(.+)$/.exec(v) : null
    if (!m) return v
    const r = await sb.storage.from(m[1]).createSignedUrl(m[2], 3600)
    return r.data?.signedUrl || ''
  }
  async function bundle(customerId: string) {
    const cu = await sb.from('punpang_customers').select('id,name,phone,data').eq('id', customerId).maybeSingle()
    if (!cu.data) return null
    const { data: cdata } = cu.data
    const customer = { ...(cdata || {}), id: cu.data.id, name: cu.data.name, phone: cu.data.phone || '' } // ไม่ส่ง note (หมายเหตุพนักงาน)
    const or = await sb.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data').eq('customer_id', customerId).neq('status', 'draft').order('created_at', { ascending: false }).limit(100)
    const orders = []
    for (const row of or.data || []) {
      const d: Record<string, any> = { ...(row.data || {}) }
      for (const k of ['history', 'approval', 'shiftId', 'chatId']) delete d[k]
      d.payments = (d.payments || []).map((p: any) => ({ ...p, slip: '' }))
      for (const it of d.items || []) {
        if (Array.isArray(it.workPhotos)) it.workPhotos = await Promise.all(it.workPhotos.map(async (w: any) => ({ ...w, image: await sign(w.image) })))
        if (Array.isArray(it.images)) it.images = await Promise.all(it.images.map(sign))
      }
      orders.push({ id: row.id, code: row.code, customer_id: row.customer_id, status: row.status, fulfillment: row.fulfillment, channel: row.channel, data: d })
    }
    const cp = await sb.from('punpang_records').select('id,data').eq('collection', 'coupons').eq('data->>customerId', customerId)
    const cs = await sb.from('punpang_records').select('id,data').eq('collection', 'consents').eq('data->>customerId', customerId)
    const rv = await sb.from('punpang_records').select('id,data').eq('collection', 'reviews').eq('data->>customerId', customerId)
    const dr = await sb.from('punpang_records').select('id,data').eq('collection', 'deletionRequests').eq('data->>customerId', customerId)
    const rec = (r: any) => ({ ...(r.data || {}), id: r.id })
    const sh = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
    return { customer, orders, coupons: (cp.data || []).map(rec), consents: (cs.data || []).map(rec), reviews: (rv.data || []).map(rec), deletionRequests: (dr.data || []).map(rec), shop: { payment: publicPaymentOf(sh.data?.data?.v) } }
  }
  async function newSession(customerId: string) {
    const token = randHex(32)
    await sb.from('punpang_customer_sessions').insert({ token_hash: await sha256Hex(`custsess:${token}`), customer_id: customerId, expires_at: iso(Date.now() + SESSION_MS) })
    return { token, expiresAt: iso(Date.now() + SESSION_MS) }
  }
  async function verifiedOtp(token: unknown, purpose: string, local: string, cid: string | null = null) {
    const t = String(token ?? '')
    if (!/^[a-f0-9]{32}$/.test(t)) return null
    const r = await sb.from('punpang_otps').select('*').eq('id', t).eq('purpose', purpose).eq('phone', local).eq('used', false).maybeSingle()
    const o = r.data
    if (cid && o && o.customer_id !== cid) return null
    return o && o.verified_until && new Date(o.verified_until).getTime() > Date.now() ? o : null
  }
  // เซสชันที่ใช้ได้ → รหัสลูกค้า
  async function sessionCid(raw: unknown): Promise<string | null> {
    const t = String(raw ?? '')
    if (!/^[a-f0-9]{64}$/.test(t)) return null
    const s = (await sb.from('punpang_customer_sessions').select('customer_id,expires_at').eq('token_hash', await sha256Hex(`custsess:${t}`)).maybeSingle()).data
    return s && new Date(s.expires_at).getTime() >= Date.now() ? s.customer_id : null
  }
  const ACCT_PURPOSES = ['change_pin', 'change_phone', 'delete']
  const phoneTaken = async (local: string, cid: string) => {
    if ((await sb.from('punpang_customer_auth').select('customer_id').eq('phone', local).neq('customer_id', cid).maybeSingle()).data) return true
    return ((await sb.from('punpang_customers').select('id,data').eq('phone', local).neq('id', cid)).data || []).some((x: any) => !x.data?.deleted)
  }

  const action = String(b.action || '')

  // ===== ขอ OTP =====
  if (action === 'otp_request') {
    const purpose = String(b.purpose || '')
    if (!['register', 'reset', ...ACCT_PURPOSES].includes(purpose)) return json({ error: 'ไม่รู้จักประเภทรหัส' }, 400)
    let ownerCid: string | null = null
    let ph = thaiPhone(b.phone)
    if (ACCT_PURPOSES.includes(purpose)) {
      ownerCid = await sessionCid(b.session)
      if (!ownerCid) return json({ error: 'กรุณาเข้าสู่ระบบก่อน' }, 401)
      const me = (await sb.from('punpang_customer_auth').select('phone').eq('customer_id', ownerCid).maybeSingle()).data
      if (!me) return json({ error: 'ไม่พบบัญชี' }, 401)
      if (purpose !== 'change_phone') ph = thaiPhone(me.phone) // ส่งไปเบอร์ของบัญชีเสมอ
      else if (ph) {
        if (ph.local === me.phone) return json({ error: 'เป็นเบอร์เดิมของคุณ' }, 400)
        if (await phoneTaken(ph.local, ownerCid)) return json({ error: 'เบอร์นี้ถูกใช้แล้ว' }, 409)
      }
    }
    if (!ph) return json({ error: 'กรอกเบอร์โทรให้ถูกต้อง' }, 400)
    const au = await sb.from('punpang_customer_auth').select('customer_id').eq('phone', ph.local).maybeSingle()
    // สมัครใหม่: ไม่ตอบว่าเบอร์มีบัญชีแล้วก่อนยืนยัน OTP (กันการเดาเบอร์ที่มีบัญชี) · ตอบ 409 ได้เฉพาะหลังยืนยัน OTP ในขั้นสมัคร
    const last = await sb.from('punpang_otps').select('sent_at').eq('phone', ph.local).eq('purpose', purpose).order('sent_at', { ascending: false }).limit(1).maybeSingle()
    if (last.data) {
      const age = Date.now() - new Date(last.data.sent_at).getTime()
      if (age < OTP.resendMs) { const wait = Math.ceil((OTP.resendMs - age) / 1000); return json({ error: `ขอรหัสใหม่ได้ในอีก ${wait} วินาที`, wait }, 429) }
    }
    const hourAgo = iso(Date.now() - 60 * MIN)
    const [cp, ci, ca] = await Promise.all([
      sb.from('punpang_otps').select('id', { count: 'exact', head: true }).eq('phone', ph.local).gte('sent_at', hourAgo),
      sb.from('punpang_otps').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('sent_at', hourAgo),
      sb.from('punpang_otps').select('id', { count: 'exact', head: true }).gte('sent_at', hourAgo),
    ])
    if ((cp.count ?? 0) >= OTP.perPhoneHour || (ci.count ?? 0) >= OTP.perIpHour || (ca.count ?? 0) >= OTP.perAllHour) return json({ error: 'ขอรหัสบ่อยเกินไป กรุณารอสักครู่' }, 429)
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0')
    const salt = randHex(8)
    const id = randHex(16)
    await sb.from('punpang_otps').delete().eq('phone', ph.local).eq('purpose', purpose).eq('used', false)
    const ins = await sb.from('punpang_otps').insert({ id, phone: ph.local, purpose, code_hash: await sha256Hex(`${salt}:${code}`), salt, expires_at: iso(Date.now() + OTP.ttlMs), ip, customer_id: ownerCid })
    if (ins.error) return json({ error: 'ส่งรหัสไม่สำเร็จ กรุณาลองใหม่' }, 500)
    // ลืม PIN + ไม่มีบัญชี: ไม่ส่ง SMS แต่ตอบเหมือนส่งแล้ว (ไม่บอกว่าเบอร์นี้มีบัญชีหรือไม่)
    if (purpose === 'reset' && !au.data) return json({ ok: true, phone: ph.local })
    const shop = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
    const name = String(shop.data?.data?.v?.name || 'ร้านเค้ก').slice(0, 40)
    const sent = await sendSms(ph.local, `รหัส OTP ของ ${name} คือ ${code} (ใช้ได้ 5 นาที ห้ามบอกผู้อื่น)`, id)
    if (!sent) { await sb.from('punpang_otps').delete().eq('id', id); return json({ error: 'ส่ง SMS ไม่สำเร็จ กรุณาลองใหม่ภายหลัง' }, 502) }
    return json({ ok: true, phone: ph.local })
  }

  // ===== ตรวจ OTP =====
  if (action === 'otp_verify') {
    const purpose = String(b.purpose || '')
    let ph = thaiPhone(b.phone)
    const code = String(b.code ?? '')
    let ownerCid: string | null = null
    if (ACCT_PURPOSES.includes(purpose)) {
      ownerCid = await sessionCid(b.session)
      if (!ownerCid) return json({ error: 'กรุณาเข้าสู่ระบบก่อน' }, 401)
      if (purpose !== 'change_phone') ph = thaiPhone((await sb.from('punpang_customer_auth').select('phone').eq('customer_id', ownerCid).maybeSingle()).data?.phone)
    }
    if (!['register', 'reset', ...ACCT_PURPOSES].includes(purpose) || !ph) return json({ error: 'ยังไม่ได้ขอรหัส กรุณาขอรหัสก่อน', expired: true }, 400)
    const r = await sb.from('punpang_otps').select('*').eq('phone', ph.local).eq('purpose', purpose).eq('used', false).order('sent_at', { ascending: false }).limit(1).maybeSingle()
    const o = r.data
    if (o && ownerCid && o.customer_id !== ownerCid) return json({ error: 'ยังไม่ได้ขอรหัส กรุณาขอรหัสก่อน', expired: true }, 400)
    if (!o) return json({ error: 'ยังไม่ได้ขอรหัส กรุณาขอรหัสก่อน', expired: true }, 400)
    // จองครั้งที่ตรวจก่อนเทียบรหัส (เขียนแบบมีเงื่อนไข) · ยิงพร้อมกันกี่คำขอก็เดาได้ไม่เกิน OTP.maxTries ครั้งต่อรหัส (ดู _shared/authguard.ts)
    const gate = await reserveOtpAttempt({
      read: async () => (await sb.from('punpang_otps').select('attempts,used,expires_at').eq('id', o.id).maybeSingle()).data ?? null,
      casAttempts: async (expect) => {
        const u = await sb.from('punpang_otps').update({ attempts: expect + 1 }).eq('id', o.id).eq('attempts', expect).eq('used', false).select('id')
        return !u.error && (u.data || []).length > 0
      },
    }, OTP, o)
    if (!gate.ok) {
      if (gate.reason === 'busy') return json({ error: 'มีการตรวจรหัสหลายคำขอพร้อมกัน กรุณารอสักครู่แล้วลองใหม่' }, 429)
      if (gate.reason === 'expired') return json({ error: 'รหัสหมดอายุ กรุณาขอรหัสใหม่', expired: true }, 400)
      if (gate.reason === 'exhausted') return json({ error: 'กรอกผิดเกินกำหนด กรุณาขอรหัสใหม่', expired: true }, 400)
      return json({ error: 'ยังไม่ได้ขอรหัส กรุณาขอรหัสก่อน', expired: true }, 400)
    }
    const good = /^\d{6}$/.test(code) && safeEq(await sha256Hex(`${o.salt}:${code}`), o.code_hash)
    if (!good) {
      const left = OTP.maxTries - gate.attempts
      return json(left > 0 ? { error: `รหัสไม่ถูกต้อง (เหลือ ${left} ครั้ง)` } : { error: 'กรอกผิดเกินกำหนด กรุณาขอรหัสใหม่', expired: true }, 400)
    }
    await sb.from('punpang_otps').update({ verified_until: iso(Date.now() + OTP.verifiedMs) }).eq('id', o.id)
    let knownCustomer: boolean | undefined
    if (purpose === 'register') { const c = await sb.from('punpang_customers').select('id,data').eq('phone', ph.local); knownCustomer = (c.data || []).some((x: any) => !x.data?.deleted) }
    return json({ ok: true, token: o.id, knownCustomer })
  }

  // ===== สมัคร =====
  if (action === 'register') {
    const ph = thaiPhone(b.phone)
    if (!ph) return json(NEED_OTP, 400)
    const o = await verifiedOtp(b.token, 'register', ph.local)
    if (!o) return json(NEED_OTP, 400)
    if (!b.consent) return json({ error: 'ต้องยอมรับนโยบายความเป็นส่วนตัวและเงื่อนไขการใช้งานก่อนสมัคร' }, 400)
    const weak = weakPin(String(b.pin ?? ''), ph.local)
    if (weak) return json({ error: weak }, 400)
    if ((await sb.from('punpang_customer_auth').select('customer_id').eq('phone', ph.local).maybeSingle()).data) return json({ error: 'เบอร์นี้สมัครแล้ว กรุณาเข้าสู่ระบบ' }, 409)
    const found = ((await sb.from('punpang_customers').select('id,data').eq('phone', ph.local)).data || []).find((x: any) => !x.data?.deleted)
    let customerId: string
    const linked = !!found
    if (found) {
      customerId = found.id
      if ((await sb.from('punpang_customer_auth').select('customer_id').eq('customer_id', customerId).maybeSingle()).data) return json({ error: 'ลูกค้านี้มีบัญชีอยู่แล้ว' }, 409)
    } else {
      const name = String(b.name ?? '').trim().slice(0, 100)
      if (!name) return json({ error: 'กรอกชื่อ' }, 400)
      customerId = `c${Date.now().toString(36)}${randHex(3)}`
      const ci = await sb.from('punpang_customers').insert({ id: customerId, name, phone: ph.local, note: 'สมัครเองจากหน้าร้าน', data: { active: true, ledger: [], spins: 0, fbPsid: '', promoOptIn: false, places: [] } })
      if (ci.error) return json({ error: 'สมัครไม่สำเร็จ กรุณาลองใหม่' }, 500)
    }
    const salt = randHex(16)
    const ai = await sb.from('punpang_customer_auth').insert({ customer_id: customerId, phone: ph.local, pin_salt: salt, pin_hash: await pbkdf2(String(b.pin), salt), failed: 0 })
    if (ai.error) return json({ error: 'เบอร์นี้สมัครแล้ว กรุณาเข้าสู่ระบบ' }, 409)
    await sb.from('punpang_otps').update({ used: true }).eq('id', o.id)
    // บันทึกความยินยอม (เวอร์ชันเอกสารปัจจุบัน)
    const legal = await sb.from('punpang_kv').select('data').eq('collection', 'legal').eq('id', 'legal').maybeSingle()
    const docs = legal.data?.data?.v?.docs || {}
    const nowIso = new Date().toISOString()
    for (const kind of ['privacy', 'terms']) {
      await sb.from('punpang_records').insert({ collection: 'consents', id: `cs${randHex(6)}`, data: { customerId, kind, version: Number(docs[kind]?.version) || 1, detail: null, at: nowIso, via: 'register' } })
    }
    const session = await newSession(customerId)
    return json({ ok: true, linked, session, ...(await bundle(customerId)) })
  }

  // ===== เข้าสู่ระบบ =====
  if (action === 'login') {
    if (ipBlocked(ip)) return json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่' }, 429)
    const ph = thaiPhone(b.phone)
    const pin = String(b.pin ?? '')
    const fail = () => { loginIpFails.set(ip, [...(loginIpFails.get(ip) || []), Date.now()]); return json(BAD_LOGIN, 401) }
    if (!ph || !/^\d{6}$/.test(pin)) return fail()
    const a = (await sb.from('punpang_customer_auth').select('*').eq('phone', ph.local).maybeSingle()).data
    if (!a) { await pbkdf2(pin, '00'.repeat(16)); return fail() } // เวลาตอบใกล้เคียงกรณีมีบัญชี
    // จองครั้งที่ลองก่อนตรวจ PIN (เขียนแบบมีเงื่อนไข) · ยิงพร้อมกันกี่คำขอก็ได้ตรวจจริงไม่เกิน PIN.maxFails ครั้งต่อรอบ (ดู _shared/authguard.ts)
    const gate = await reservePinAttempt({
      read: async () => (await sb.from('punpang_customer_auth').select('failed,locked_until,day_key,day_fails').eq('customer_id', a.customer_id).maybeSingle()).data ?? null,
      casFailed: async (expect, patch) => {
        const r = await sb.from('punpang_customer_auth').update(patch).eq('customer_id', a.customer_id).eq('failed', expect).select('customer_id')
        return !r.error && (r.data || []).length > 0
      },
    }, PIN, a)
    if (!gate.ok) {
      if (gate.reason === 'locked') return json({ error: `ลองผิดเกินกำหนด ล็อกอีก ${Math.max(1, Math.ceil((gate.until - Date.now()) / MIN))} นาที หรือใช้ "ลืม PIN"`, locked: true }, 423)
      if (gate.reason === 'daily') return json({ error: `ลองผิดครบ ${PIN.dailyMax} ครั้งของวันนี้แล้ว ลองใหม่หลังเที่ยงคืน หรือใช้ "ลืม PIN"`, locked: true }, 423)
      return json({ error: 'มีการเข้าสู่ระบบหลายคำขอพร้อมกัน กรุณารอสักครู่แล้วลองใหม่' }, 429)
    }
    if (!safeEq(await pbkdf2(pin, a.pin_salt), a.pin_hash)) {
      loginIpFails.set(ip, [...(loginIpFails.get(ip) || []), Date.now()])
      if (gate.lockMs) return json({ error: `ใส่ PIN ผิดครบ ${gate.n} ครั้ง ล็อก ${Math.ceil(gate.lockMs / MIN)} นาที หรือใช้ "ลืม PIN"`, locked: true }, 423) // ล็อกถูกตั้งไว้ตอนจองครั้งนี้แล้ว (เวลาล็อกนานขึ้นเมื่อผิดซ้ำ)
      return json({ error: `เบอร์โทรหรือ PIN ไม่ถูกต้อง (เหลือ ${PIN.maxFails - gate.n} ครั้ง)` }, 401)
    }
    await sb.from('punpang_customer_auth').update({ failed: 0, locked_until: null, day_fails: 0 }).eq('customer_id', a.customer_id)
    const session = await newSession(a.customer_id)
    return json({ ok: true, session, ...(await bundle(a.customer_id)) })
  }

  // ===== ลืม PIN =====
  if (action === 'reset') {
    const ph = thaiPhone(b.phone)
    if (!ph) return json(NEED_OTP, 400)
    const o = await verifiedOtp(b.token, 'reset', ph.local)
    const a = (await sb.from('punpang_customer_auth').select('customer_id').eq('phone', ph.local).maybeSingle()).data
    if (!o || !a) return json(NEED_OTP, 400)
    const weak = weakPin(String(b.pin ?? ''), ph.local)
    if (weak) return json({ error: weak }, 400)
    const salt = randHex(16)
    await sb.from('punpang_customer_auth').update({ pin_salt: salt, pin_hash: await pbkdf2(String(b.pin), salt), failed: 0, locked_until: null, day_fails: 0 }).eq('customer_id', a.customer_id)
    await sb.from('punpang_otps').update({ used: true }).eq('id', o.id)
    await sb.from('punpang_customer_sessions').delete().eq('customer_id', a.customer_id) // ออกจากระบบทุกเครื่อง
    return json({ ok: true })
  }

  // ===== แอดมินตั้ง PIN ใหม่ให้ลูกค้า (ตรวจ JWT และสิทธิ์ manage ของพนักงานในฟังก์ชัน · ออกจากระบบทุกเครื่องของลูกค้า) =====
  if (action === 'admin_reset_pin') {
    const jwt = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const uid = jwt ? (await (sb as any).auth.getUser(jwt)).data?.user?.id : null
    const st = uid ? (await sb.from('punpang_staff').select('active,perms').eq('user_id', uid).maybeSingle()).data : null
    if (!st?.active || !(st.perms || []).includes('manage')) return json({ error: 'เฉพาะแอดมินตั้ง PIN ลูกค้าได้' }, 403)
    const ph = thaiPhone(b.phone)
    if (!ph) return json({ error: 'กรอกเบอร์โทรให้ถูกต้อง' }, 400)
    const a = (await sb.from('punpang_customer_auth').select('customer_id').eq('phone', ph.local).maybeSingle()).data
    const weak = weakPin(String(b.pin ?? ''), ph.local)
    if (weak) return json({ error: weak }, 400)
    const salt = randHex(16)
    const hash = await pbkdf2(String(b.pin), salt)
    if (a) {
      await sb.from('punpang_customer_auth').update({ pin_salt: salt, pin_hash: hash, failed: 0, locked_until: null, day_fails: 0 }).eq('customer_id', a.customer_id)
      await sb.from('punpang_customer_sessions').delete().eq('customer_id', a.customer_id)
      return json({ ok: true })
    }
    // ยังไม่มีบัญชี: สร้างบัญชีให้จากข้อมูลลูกค้าที่ใช้เบอร์นี้
    const cust = (await sb.from('punpang_customers').select('id,data').eq('phone', ph.local).maybeSingle()).data
    if (!cust || cust.data?.deleted) return json({ error: 'ไม่พบลูกค้าที่ใช้เบอร์นี้' }, 404)
    const ins = await sb.from('punpang_customer_auth').insert({ customer_id: cust.id, phone: ph.local, pin_salt: salt, pin_hash: hash, failed: 0 })
    if (ins.error) return json({ error: 'สร้างบัญชีไม่สำเร็จ กรุณาลองใหม่' }, 500)
    return json({ ok: true, created: true })
  }

  // ===== คำสั่งของลูกค้าที่ล็อกอิน (ตรวจเซสชันทุกครั้ง · แก้ได้เฉพาะของตัวเอง) =====
  if (['update_profile', 'submit_review', 'accept_consent', 'ensure_scan_code'].includes(action)) {
    const t = String(b.session ?? '')
    if (!/^[a-f0-9]{64}$/.test(t)) return json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, 401)
    const h = await sha256Hex(`custsess:${t}`)
    const s = (await sb.from('punpang_customer_sessions').select('customer_id,expires_at').eq('token_hash', h).maybeSingle()).data
    if (!s || new Date(s.expires_at).getTime() < Date.now()) return json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401)
    const cid: string = s.customer_id
    const cuSel = 'id,name,data,updated_at'
    let cu = (await sb.from('punpang_customers').select(cuSel).eq('id', cid).maybeSingle()).data
    if (!cu || cu.data?.deleted) return json({ error: 'ไม่พบบัญชี' }, 401)
    if (action === 'update_profile') {
      const name = String(b.name ?? cu.name).trim().slice(0, 100)
      if (!name) return json({ error: 'กรอกชื่อ' }, 400)
      // เขียนแบบเทียบ updated_at (CAS): แถวลูกค้าเก็บแต้ม/ประวัติแต้มไว้ใน data ด้วย · ถ้ามีการเปลี่ยนแต้มระหว่างอ่านกับเขียน
      // การเขียนทับด้วยสำเนาเก่าจะทำให้แต้มที่เพิ่งเปลี่ยนหายไป → อ่านใหม่แล้วลองอีกครั้ง
      let saved = false
      for (let i = 0; i < 4 && !saved; i++) {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 120)))
          cu = (await sb.from('punpang_customers').select(cuSel).eq('id', cid).maybeSingle()).data
          if (!cu || cu.data?.deleted) return json({ error: 'ไม่พบบัญชี' }, 401)
        }
        // ถ้าไม่ได้ส่ง promoOptIn มา คงค่าเดิมไว้ (ไม่ใช่ถอนความยินยอมโดยไม่ตั้งใจ)
        const optIn = typeof b.promoOptIn === 'boolean' ? b.promoOptIn : cu.data?.promoOptIn === true
        const u = await sb.from('punpang_customers').update({ name, data: promoConsentPatch(cu.data || {}, optIn, new Date().toISOString()) }).eq('id', cid).eq('updated_at', cu.updated_at).select('id')
        if (u.error) return json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' }, 500)
        saved = (u.data || []).length > 0
      }
      if (!saved) return json({ error: 'บันทึกไม่สำเร็จ มีการแก้ข้อมูลพร้อมกัน กรุณาลองใหม่' }, 409)
    } else if (action === 'ensure_scan_code') {
      // รหัสสมาชิกแบบสุ่ม (บาร์โค้ดให้พนักงานสแกน) · สร้างครั้งเดียวแล้วเก็บใน data.scanCode · เขียนแบบเทียบ updated_at เหมือน update_profile
      let saved = !!cu.data?.scanCode
      for (let i = 0; i < 4 && !saved; i++) {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 120)))
          cu = (await sb.from('punpang_customers').select(cuSel).eq('id', cid).maybeSingle()).data
          if (!cu || cu.data?.deleted) return json({ error: 'ไม่พบบัญชี' }, 401)
          if (cu.data?.scanCode) { saved = true; break }
        }
        const u = await sb.from('punpang_customers').update({ data: { ...(cu.data || {}), scanCode: randHex(16) } }).eq('id', cid).eq('updated_at', cu.updated_at).select('id')
        if (u.error) return json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' }, 500)
        saved = (u.data || []).length > 0
      }
      if (!saved) return json({ error: 'บันทึกไม่สำเร็จ มีการแก้ข้อมูลพร้อมกัน กรุณาลองใหม่' }, 409)
    } else if (action === 'submit_review') {
      const o = (await sb.from('punpang_orders').select('id,status').eq('id', String(b.orderId ?? '')).eq('customer_id', cid).maybeSingle()).data
      if (!o) return json({ error: 'ไม่พบออร์เดอร์' }, 400)
      if (o.status !== 'delivered') return json({ error: 'รีวิวได้หลังรับสินค้าแล้ว' }, 400)
      const text = String(b.text ?? '').trim()
      if (!text) return json({ error: 'กรอกข้อความรีวิว' }, 400)
      const old = await sb.from('punpang_records').select('id').eq('collection', 'reviews').eq('data->>orderId', o.id).limit(1)
      if ((old.data || []).length) return json({ error: 'ออร์เดอร์นี้รีวิวแล้ว' }, 400)
      const rating = Math.min(5, Math.max(1, Math.round(Number(b.rating) || 0)))
      const ins = await sb.from('punpang_records').insert({ collection: 'reviews', id: `rv${randHex(6)}`, data: { customerId: cid, orderId: o.id, source: 'customer', status: 'pending', name: String(cu.name).trim().split(/\s+/)[0].slice(0, 60), rating, text: text.slice(0, 500), createdAt: new Date().toISOString() } })
      if (ins.error) return json({ error: 'ส่งรีวิวไม่สำเร็จ กรุณาลองใหม่' }, 500)
    } else {
      const legal = await sb.from('punpang_kv').select('data').eq('collection', 'legal').eq('id', 'legal').maybeSingle()
      const docs = legal.data?.data?.v?.docs || {}
      const have = (await sb.from('punpang_records').select('data').eq('collection', 'consents').eq('data->>customerId', cid)).data || []
      for (const kind of ['privacy', 'terms']) {
        const version = Number(docs[kind]?.version) || 1
        if (have.some((x: any) => x.data?.kind === kind && Number(x.data?.version) === version)) continue
        await sb.from('punpang_records').insert({ collection: 'consents', id: `cs${randHex(6)}`, data: { customerId: cid, kind, version, detail: null, at: new Date().toISOString(), via: 'reconsent' } })
      }
    }
    const data = await bundle(cid)
    return json({ ok: true, ...data })
  }

  // ===== เปลี่ยน PIN / เปลี่ยนเบอร์ / ขอลบข้อมูล (ต้องยืนยัน OTP ที่ผูกกับบัญชีนี้) =====
  if (['change_pin', 'change_phone', 'request_deletion'].includes(action)) {
    const cid = await sessionCid(b.session)
    if (!cid) return json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401)
    const me = (await sb.from('punpang_customer_auth').select('phone').eq('customer_id', cid).maybeSingle()).data
    if (!me) return json({ error: 'ไม่พบบัญชี' }, 401)
    if (action === 'change_pin') {
      const o = await verifiedOtp(b.token, 'change_pin', me.phone, cid)
      if (!o) return json(NEED_OTP, 400)
      const weak = weakPin(String(b.pin ?? ''), me.phone)
      if (weak) return json({ error: weak }, 400)
      const salt = randHex(16)
      await sb.from('punpang_customer_auth').update({ pin_salt: salt, pin_hash: await pbkdf2(String(b.pin), salt), failed: 0, locked_until: null, day_fails: 0 }).eq('customer_id', cid)
      await sb.from('punpang_otps').update({ used: true }).eq('id', o.id)
      await sb.from('punpang_customer_sessions').delete().eq('customer_id', cid).neq('token_hash', await sha256Hex(`custsess:${String(b.session)}`)) // ออกจากเครื่องอื่น เหลือเครื่องนี้
    } else if (action === 'change_phone') {
      const np = thaiPhone(b.phone)
      if (!np) return json({ error: 'กรอกเบอร์โทรให้ถูกต้อง' }, 400)
      const o = await verifiedOtp(b.token, 'change_phone', np.local, cid)
      if (!o) return json(NEED_OTP, 400)
      if (np.local === me.phone) return json({ error: 'เป็นเบอร์เดิมของคุณ' }, 400)
      if (await phoneTaken(np.local, cid)) return json({ error: 'เบอร์นี้ถูกใช้แล้ว' }, 409)
      const ua = await sb.from('punpang_customer_auth').update({ phone: np.local }).eq('customer_id', cid)
      if (ua.error) return json({ error: 'เบอร์นี้ถูกใช้แล้ว' }, 409)
      await sb.from('punpang_customers').update({ phone: np.local }).eq('id', cid)
      await sb.from('punpang_otps').update({ used: true }).eq('id', o.id)
    } else {
      const o = await verifiedOtp(b.token, 'delete', me.phone, cid)
      if (!o) return json(NEED_OTP, 400)
      const pend = (await sb.from('punpang_records').select('id,data').eq('collection', 'deletionRequests').eq('data->>customerId', cid)).data || []
      if (pend.some((x: any) => x.data?.status === 'pending')) return json({ error: 'มีคำขอที่รอตรวจสอบอยู่แล้ว' }, 400)
      const ins = await sb.from('punpang_records').insert({ collection: 'deletionRequests', id: `dr${randHex(6)}`, data: { customerId: cid, status: 'pending', customerNote: String(b.note ?? '').trim().slice(0, 300), reason: '', createdAt: new Date().toISOString(), decidedAt: null, decidedBy: '' } })
      if (ins.error) return json({ error: 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่' }, 500)
      await sb.from('punpang_otps').update({ used: true }).eq('id', o.id)
    }
    return json({ ok: true, ...(await bundle(cid)) })
  }

  // ===== เซสชัน =====
  if (action === 'session' || action === 'logout') {
    const t = String(b.session ?? '')
    if (!/^[a-f0-9]{64}$/.test(t)) return json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }, 401)
    const h = await sha256Hex(`custsess:${t}`)
    if (action === 'logout') { await sb.from('punpang_customer_sessions').delete().eq('token_hash', h); return json({ ok: true }) }
    const s = (await sb.from('punpang_customer_sessions').select('customer_id,expires_at').eq('token_hash', h).maybeSingle()).data
    if (!s || new Date(s.expires_at).getTime() < Date.now()) return json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401)
    await sb.from('punpang_customer_sessions').update({ last_used: new Date().toISOString(), expires_at: iso(Date.now() + SESSION_MS) }).eq('token_hash', h)
    const data = await bundle(s.customer_id)
    if (!data) return json({ error: 'ไม่พบบัญชี' }, 401)
    return json({ ok: true, ...data })
  }
  return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)
}))
