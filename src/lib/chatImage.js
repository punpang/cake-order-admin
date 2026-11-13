// รูปที่พนักงานส่งในแชท: ย่อด้วย resizeImage (JPEG) → อัปโหลดไป R2 ผ่าน Worker ใต้ staff/<externalId>/ (fb-send ตรวจว่ารูปอยู่ในโฟลเดอร์ของผู้รับเท่านั้น)
// ไฟล์ใหม่ไม่เก็บที่ Supabase Storage แล้ว · โหมดจำลอง (ไม่มี Supabase) ไม่มีการอัปโหลด → ใช้ blob ในเครื่องแสดงผลแทน
import { resizeImage } from './imageResize'
import { getSupabase } from './supabase'
import { filesEnabled, uploadPrivateBlob } from './storage'

export const MAX_CHAT_IMAGES = 5
const MAX_SIDE = 1600
const MAX_BYTES = 4 * 1024 * 1024

// ย่อรูปที่เลือก (ยังไม่อัปโหลด) → { blob, url (พรีวิว), width, height }
export async function prepareChatImage(file) {
  const r = await resizeImage(file, { maxSide: MAX_SIDE, maxBytes: MAX_BYTES })
  return { blob: r.blob, url: URL.createObjectURL(r.blob), width: r.width, height: r.height }
}

// คืน attachment ของข้อความ: path = อ้างอิง R2 (r2://private/staff/<ผู้รับ>/<ไฟล์>) หรือ localUrl (โหมดจำลองเท่านั้น)
export async function uploadChatImage(chat, blob, { width, height } = {}) {
  const base = { type: 'image', mime: 'image/jpeg', name: 'รูปภาพ.jpg', size: blob.size, ...(width ? { width, height } : {}) }
  const client = await getSupabase()
  if (!client) return { ...base, localUrl: URL.createObjectURL(blob) }
  if (!filesEnabled()) throw new Error('อัปโหลดรูปไม่ได้: ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์ไฟล์ (VITE_FILES_URL)')
  const path = await uploadPrivateBlob(client, blob, 'image/jpeg', `staff/${chat.externalId || chat.id}`)
  return { ...base, path }
}
