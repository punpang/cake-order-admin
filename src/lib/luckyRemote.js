import { getSupabase } from './supabase'

// หน้าลุ้นโชคของบิล: เรียก Edge Function lucky-spin (ไม่ต้องล็อกอิน)
// spin=false = ดูสถานะเฉย ๆ · spin=true = ลุ้น (ได้ครั้งเดียวต่อบิล) · ทั้งสองแบบคืนผลเดิมถ้าลุ้นไปแล้ว
export async function callLuckySpin(token, spin) {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เชื่อมต่อระบบ', code: 'offline' }
  try {
    const r = await c.functions.invoke('lucky-spin', { body: { token, spin: !!spin } })
    if (r.error) {
      const st = r.error.context?.status
      if (st === 429) return { error: 'ลองบ่อยเกินไป กรุณารอสักครู่', code: 429 }
      if (st === 410) return { error: 'หมดเวลาลุ้นของบิลนี้แล้ว', code: 410 }
      if (st === 404) return { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว', code: 404 }
      return { error: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง', code: st || 'net' }
    }
    return { data: r.data }
  } catch {
    return { error: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง', code: 'net' }
  }
}
