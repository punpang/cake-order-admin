// LINE LIFF ของร้าน (ช่อง LINE Login) · LIFF ID ไม่ใช่ความลับ
import { getSupabase } from './supabase'
import { readSessionToken } from './customerRemote'

export const LIFF_ID = '2012641404-DlSIXAZp'
const NET = 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'

// โหลดตัวเชื่อม LIFF แล้วเริ่มทำงาน · คืน { ok, accessToken } หรือ { ok: false, error }
export function initLiff(liffId = LIFF_ID) {
  return new Promise((resolve) => {
    const run = async () => {
      try {
        const liff = window.liff
        await liff.init({ liffId })
        if (!liff.isInClient() && !liff.isLoggedIn()) {
          liff.login({ redirectUri: location.href })
          return resolve({ ok: false, error: 'กำลังพาไปเข้าสู่ระบบ LINE…' })
        }
        const accessToken = liff.getAccessToken()
        if (!accessToken) return resolve({ ok: false, error: 'เปิดหน้านี้จากแอป LINE เท่านั้น' })
        resolve({ ok: true, accessToken })
      } catch {
        resolve({ ok: false, error: 'เปิด LINE ไม่สำเร็จ กรุณาลองใหม่' })
      }
    }
    if (window.liff) return run()
    const s = document.createElement('script')
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
    s.onload = run
    s.onerror = () => resolve({ ok: false, error: 'โหลดตัวเชื่อม LINE ไม่สำเร็จ' })
    document.head.appendChild(s)
  })
}

// ผูกบัญชี LINE กับลูกค้าที่เข้าสู่ระบบแล้ว (Edge Function line-link)
export async function linkLine(accessToken) {
  const session = readSessionToken()
  if (!session) return { needLogin: true, error: 'กรุณาเข้าสู่ระบบบัญชีก่อน' }
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เปิดใช้งานออนไลน์' }
  try {
    const r = await c.functions.invoke('line-link', { body: { accessToken, session } })
    if (r.error) {
      let d = null
      try { d = await r.error.context?.json() } catch { d = null }
      return { error: d?.error || NET }
    }
    return r.data?.ok ? { ok: true } : { error: r.data?.error || NET }
  } catch {
    return { error: NET }
  }
}
