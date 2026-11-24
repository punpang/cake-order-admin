// เรียกฟังก์ชัน preorder-admin (ฝั่งร้านของสั่งล่วงหน้า) · ต้องเข้าสู่ระบบพนักงานที่มีสิทธิ์ managePreorder
import { getSupabase, supabaseEnabled } from './supabase'

const OFFLINE_MSG = 'ต้องเชื่อมต่อฐานข้อมูลออนไลน์ก่อน'

export async function preorderAdminCall(action, payload = {}) {
  if (!supabaseEnabled) return { error: OFFLINE_MSG }
  try {
    const client = await getSupabase()
    if (!client) return { error: OFFLINE_MSG }
    const r = await client.functions.invoke('preorder-admin', { body: { action, ...payload } })
    if (r.error) {
      let m = ''
      try { m = (await r.error.context?.json?.())?.error || '' } catch { /* ข้าม */ }
      return { error: m || 'เรียกเซิร์ฟเวอร์ไม่สำเร็จ' }
    }
    return r.data || {}
  } catch {
    return { error: 'เรียกเซิร์ฟเวอร์ไม่สำเร็จ' }
  }
}
