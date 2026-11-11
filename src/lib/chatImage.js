// รูปที่พนักงานส่งในแชท: ย่อด้วย resizeImage (JPEG พื้นขาว) → อัปโหลดขึ้น bucket ส่วนตัว punpang-chat ใต้โฟลเดอร์ staff/<ผู้รับ>/
// โหมดจำลอง (ไม่มี Supabase) ไม่มีการอัปโหลด → ใช้ blob ในเครื่องแสดงผลแทน
import { resizeImage } from './imageResize'
import { getSupabase } from './supabase'

export const CHAT_BUCKET = 'punpang-chat'
export const MAX_CHAT_IMAGES = 5
const MAX_SIDE = 1600
const MAX_BYTES = 4 * 1024 * 1024

// ย่อรูปที่เลือก (ยังไม่อัปโหลด) → { blob, url (พรีวิว), width, height }
export async function prepareChatImage(file) {
  const r = await resizeImage(file, { maxSide: MAX_SIDE, maxBytes: MAX_BYTES })
  return { blob: r.blob, url: URL.createObjectURL(r.blob), width: r.width, height: r.height }
}

// ที่อยู่ไฟล์ในบักเก็ต: staff/<externalId ของลูกค้า>/<รหัสสุ่ม>.jpg (fb-send ตรวจว่ารูปอยู่ในโฟลเดอร์ของผู้รับเท่านั้น)
export function stagePath(externalId, rnd = Math.random().toString(36).slice(2, 10)) {
  return `staff/${externalId}/${Date.now().toString(36)}-${rnd}.jpg`
}

// คืน attachment ของข้อความ: path (อัปโหลดแล้ว) หรือ localUrl (โหมดจำลองเท่านั้น)
export async function uploadChatImage(chat, blob, { width, height } = {}) {
  const base = { type: 'image', mime: 'image/jpeg', name: 'รูปภาพ.jpg', size: blob.size, ...(width ? { width, height } : {}) }
  const client = await getSupabase()
  if (!client) return { ...base, localUrl: URL.createObjectURL(blob) }
  const path = stagePath(chat.externalId || chat.id)
  const up = await client.storage.from(CHAT_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (up.error) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${up.error.message || 'ไม่ทราบสาเหตุ'}`)
  return { ...base, path }
}
