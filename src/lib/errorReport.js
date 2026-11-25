// รายงานข้อผิดพลาดของแอปพนักงานขึ้นฐานข้อมูลของร้าน (ตาราง punpang_error_log ผ่าน RPC punpang_log_error)
// ส่งเฉพาะโหมด Supabase + พนักงานล็อกอินอยู่ + ไม่ใช่โหมดทดสอบ · ไม่ส่งข้อมูลออกนอกระบบของร้าน
// ฝั่งเครื่อง: ข้อผิดพลาดเดียวกันส่งครั้งเดียวต่อการเปิดแอป และไม่เกิน MAX_PER_SESSION รายการ (ฐานข้อมูลนับซ้ำและจำกัดอีกชั้น)
import { APP_COMMIT } from './buildInfo.js'

export const MAX_PER_SESSION = 20
// ข้อความที่ไม่ใช่ปัญหาของแอป (เบราว์เซอร์แจ้งเตือนทั่วไป / ผู้ใช้ออฟไลน์) → ไม่ส่ง
const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /Failed to fetch|Load failed|NetworkError|network request failed/i, /AbortError|The operation was aborted/i]
// ตัวเลขยาว (เบอร์โทร/เลขบัญชี) ไม่ออกจากเครื่อง
const maskDigits = (s) => String(s ?? '').replace(/\d{9,}/g, '[ตัวเลข]')

// แปลงสิ่งที่ถูก throw ทุกแบบเป็น { message, stack }
export function normalizeError(err) {
  if (err instanceof Error) return { message: `${err.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err.message || ''}`.trim() || err.name || 'Error', stack: err.stack || '' }
  if (err && typeof err === 'object') {
    const m = err.message || err.reason || ''
    try { return { message: String(m || JSON.stringify(err)).slice(0, 500), stack: String(err.stack || '') } } catch { return { message: String(m || 'ข้อผิดพลาด'), stack: '' } }
  }
  return { message: String(err ?? 'ข้อผิดพลาด'), stack: '' }
}

// สร้างตัวรายงาน · send(payload) คืน Promise (ส่งไม่สำเร็จ = เงียบ ไม่ให้วนเกิดข้อผิดพลาดซ้ำ)
export function makeReporter({ send, enabled = () => true, max = MAX_PER_SESSION, url = () => '', ua = () => '' }) {
  const seen = new Set()
  let count = 0
  return function report(err, where = '') {
    if (!enabled()) return false
    const { message, stack } = normalizeError(err)
    const msg = maskDigits(where ? `${message} (${where})` : message).trim().slice(0, 500)
    if (!msg || IGNORE.some((re) => re.test(message))) return false
    const key = `${msg}|${String(stack).split('\n').slice(0, 2).join('|')}`
    if (seen.has(key) || count >= max) return false
    seen.add(key)
    count++
    Promise.resolve()
      .then(() => send({ p_message: msg, p_stack: maskDigits(stack).slice(0, 4000), p_url: maskDigits(url()).slice(0, 300), p_ua: String(ua()).slice(0, 200), p_build: APP_COMMIT }))
      .catch(() => {})
    return true
  }
}

let installed = false
// ติดตั้งครั้งเดียวตอนเปิดแอป: ข้อผิดพลาดของ Vue + ข้อผิดพลาดที่ไม่มีใครจับ + Promise ที่ล้มโดยไม่มีใครรอ
export function installErrorReporting(app) {
  if (installed || typeof window === 'undefined') return
  installed = true
  let ctx = null
  const ready = (async () => {
    const [{ supabaseEnabled, getSupabase }, { staffState }] = await Promise.all([import('./supabase.js'), import('./staffAuth.js')])
    if (!supabaseEnabled) return
    ctx = { client: await getSupabase(), staffState }
  })().catch(() => {})
  const report = makeReporter({
    enabled: () => !!(ctx && ctx.client && ctx.staffState.staff),
    send: async (p) => { await ready; const r = await ctx.client.rpc('punpang_log_error', p); if (r.error) throw r.error },
    url: () => location.hash || location.pathname,
    ua: () => navigator.userAgent,
  })
  const prev = app.config.errorHandler
  app.config.errorHandler = (err, instance, info) => {
    report(err, info ? `vue:${info}` : '')
    if (prev) prev(err, instance, info)
    else console.error(err) // คงการแสดงในคอนโซลเหมือนค่าเริ่มต้นของ Vue
  }
  window.addEventListener('error', (e) => report(e.error || e.message))
  window.addEventListener('unhandledrejection', (e) => report(e.reason, 'promise'))
}

// ---------- หน้าดูบันทึก (ผู้จัดการ) ----------
export async function fetchErrorLog(limit = 200) {
  const { getSupabase } = await import('./supabase.js')
  const client = await getSupabase()
  if (!client) return { error: 'ใช้ได้เมื่อเชื่อมต่อฐานข้อมูล (Supabase) เท่านั้น' }
  const r = await client.from('punpang_error_log').select('id,at,last_at,n,staff_id,message,stack,url,ua,build').order('last_at', { ascending: false }).limit(limit)
  return r.error ? { error: r.error.message } : { items: r.data || [] }
}
export async function clearErrorLog() {
  const { getSupabase } = await import('./supabase.js')
  const client = await getSupabase()
  if (!client) return { error: 'ใช้ได้เมื่อเชื่อมต่อฐานข้อมูล (Supabase) เท่านั้น' }
  const r = await client.from('punpang_error_log').delete().gt('id', 0)
  return r.error ? { error: r.error.message } : { ok: true }
}
