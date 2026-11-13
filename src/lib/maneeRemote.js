// รายการรับเงินแม่มณีที่ตรงกับ QR หน้าร้าน (POS) · เรียก Edge Function manee-list (ต้องเป็นพนักงานที่ active)
// โหมดจำลอง (ไม่ได้เชื่อม Supabase) = ไม่มีรายการ พนักงานยืนยันเองได้เสมอ
import { getSupabase, supabaseEnabled } from './supabase'

export async function listManeeTransfers({ amount, from, to }) {
  if (!supabaseEnabled) return { rows: [] }
  try {
    const c = await getSupabase()
    const r = await c.functions.invoke('manee-list', { body: { amount, from, to } })
    if (r.error) return { error: 'ดึงรายการโอนไม่สำเร็จ' }
    return { rows: Array.isArray(r.data?.rows) ? r.data.rows : [] }
  } catch {
    return { error: 'ดึงรายการโอนไม่สำเร็จ' }
  }
}
