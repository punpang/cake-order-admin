import { getSupabase } from './supabase'
import { toPublicUrl } from './storage'

// เผยแพร่รูปขึ้นหน้าเว็บ: ปิด Supabase = คืนรูปเดิม (ข้อมูลจำลอง) · เปิด = คัดลอกไป bucket สาธารณะแล้วคืนลิงก์ถาวร
export async function toPublicImage(src) {
  const c = await getSupabase()
  return c ? toPublicUrl(c, src) : src
}
