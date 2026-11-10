// ค่าขนาดรูปที่ร้านตั้งไว้ (อ่านจาก punpang_kv config/imageLimits · สิทธิ์อ่านสาธารณะ) · ค่าเริ่มต้น: ด้านยาว 2000 px, ไฟล์ 5 MB
import { getSupabase } from './supabase'
export const DEFAULT_LIMITS = { maxMB: 5, maxPx: 2000 }
let cache = null
export async function imageLimits() {
  if (cache) return cache
  try {
    const c = await getSupabase()
    const r = c ? await c.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'imageLimits').maybeSingle() : null
    const v = r?.data?.data?.v
    cache = {
      maxMB: Number(v?.maxMB) >= 1 && Number(v?.maxMB) <= 20 ? Number(v.maxMB) : DEFAULT_LIMITS.maxMB,
      maxPx: Number(v?.maxPx) >= 500 && Number(v?.maxPx) <= 4000 ? Math.round(Number(v.maxPx)) : DEFAULT_LIMITS.maxPx,
    }
  } catch {
    cache = { ...DEFAULT_LIMITS }
  }
  return cache
}
export const clearImageLimitsCache = () => { cache = null }
