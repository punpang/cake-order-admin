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

// ค้นรายการโอนของ QR หน้าร้าน (POS) ตรงจากตาราง: นโยบาย RLS อนุญาตเฉพาะพนักงานที่ active และมีสิทธิ์ pos (manee_transfers_pos_read)
// เรียกเซิร์ฟเวอร์ครั้งเดียว (เดิมผ่าน Edge Function ที่ตรวจสิทธิ์และอ่านข้อมูลแยก 3 ขั้น) · อ่านเฉพาะคอลัมน์ที่ใช้ยืนยัน
export async function listTransfersOfRef({ ref, amount }) {
  if (!supabaseEnabled) return { rows: [] }
  const amt = Math.round(Number(amount) * 100) / 100
  if (!ref || !(amt > 0)) return { rows: [] }
  try {
    const c = await getSupabase()
    const r = await c.from('tungngern_transfers')
      .select('id,received_at,amount')
      .eq('ref', String(ref))
      .eq('amount', amt)
      .order('received_at', { ascending: true })
      .limit(20)
    if (r.error) return { error: 'ดึงรายการโอนไม่สำเร็จ' }
    return { rows: Array.isArray(r.data) ? r.data : [] }
  } catch {
    return { error: 'ดึงรายการโอนไม่สำเร็จ' }
  }
}
