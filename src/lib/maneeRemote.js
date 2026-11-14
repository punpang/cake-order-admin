// รายการรับเงินถุงเงินที่ตรงกับรหัสธุรกรรม (Ref2 ORD/POS) ของ QR หน้าร้าน · เรียก Edge Function tungngern-list (ต้องเป็นพนักงานที่ active)
// โหมดจำลอง (ไม่ได้เชื่อม Supabase) = ไม่มีรายการ พนักงานยืนยันเองได้เสมอ
import { getSupabase, supabaseEnabled } from './supabase'

// ค้นด้วยรหัสธุรกรรมและยอดเงินพร้อมกัน (ต้องตรงทั้งคู่)
export async function listTransfersByRef({ ref, amount }) {
  if (!supabaseEnabled) return { rows: [] }
  try {
    const c = await getSupabase()
    const r = await c.functions.invoke('tungngern-list', { body: { ref, amount } })
    if (r.error) return { error: 'ดึงรายการโอนไม่สำเร็จ' }
    return { rows: Array.isArray(r.data?.rows) ? r.data.rows : [] }
  } catch {
    return { error: 'ดึงรายการโอนไม่สำเร็จ' }
  }
}
