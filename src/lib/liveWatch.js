// เริ่มฟังตารางด้วย Realtime จากไคลเอนต์ของ Supabase (รอไคลเอนต์ก่อน) · คืน { stop, isLive }
import { getSupabase } from './supabase'
import { startTableWatch } from './tableWatch'

export async function watchTable(cfg, onChange) {
  let client = null
  try { client = await getSupabase() } catch { client = null }
  return startTableWatch(client, cfg, onChange)
}
