import { getSupabase } from './supabase'

// หน้าลุ้นโชคของบิล: เรียก Edge Function lucky-spin
// ดูสถานะ (spin=false) ไม่ต้องล็อกอิน · ลุ้น (spin=true) ต้องมีเซสชันสมาชิก (session) · ลุ้นได้ตามจำนวนครั้งของบิล
export async function callLuckySpin(token, spin, session = '') {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เชื่อมต่อระบบ', code: 'offline' }
  try {
    const r = await c.functions.invoke('lucky-spin', { body: { token, spin: !!spin, session: session || undefined } })
    if (r.error) {
      const st = r.error.context?.status
      let d = null
      try { d = await r.error.context?.json() } catch { d = null }
      if (d?.code === 'login' || st === 401) return { error: d?.error || 'กรุณาเข้าสู่ระบบสมาชิกก่อนลุ้น', code: 'login' }
      if (st === 429) return { error: 'ลองบ่อยเกินไป กรุณารอสักครู่', code: 429 }
      if (st === 410) return { error: d?.error || 'หมดเวลาลุ้นของบิลนี้แล้ว', code: 410 }
      if (st === 404) return { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว', code: 404 }
      if (st === 409) return { error: d?.error || 'ทำรายการไม่ได้ในตอนนี้', code: 409 }
      return { error: d?.error || 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง', code: st || 'net' }
    }
    return { data: r.data }
  } catch {
    return { error: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง', code: 'net' }
  }
}
