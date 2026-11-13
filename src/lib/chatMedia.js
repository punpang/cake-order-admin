// ไฟล์แนบในแชท: ขอลิงก์ชั่วคราวตอนแสดง · เก็บ cache ในหน่วยความจำ ~50 นาที
// อ้างอิง r2://… → Worker (R2) · path เดิม (ไม่มี scheme) → Supabase Storage (ไฟล์เก่า อ่านอย่างเดียว)
import { signedUrlFor } from './storage'

const TTL_S = 3600
const KEEP_MS = 50 * 60 * 1000
const cache = new Map() // path -> { url, exp }
let signer = null // async (path) => url | null

export function setChatMediaSigner(fn) {
  signer = fn
  cache.clear()
}

export async function chatMediaUrl(path, now = Date.now()) {
  if (!path || !signer) return null
  const hit = cache.get(path)
  if (hit && hit.exp > now) return hit.url
  const url = await signer(path)
  if (url) cache.set(path, { url, exp: now + KEEP_MS })
  return url || null
}

export function makeSigner(client) {
  return async (path) => {
    if (String(path).startsWith('r2://')) return signedUrlFor(client, path, TTL_S)
    const r = await client.storage.from('punpang-chat').createSignedUrl(path, TTL_S)
    return r.error ? null : r.data?.signedUrl || null
  }
}

const KIND_LABEL = { image: 'รูปภาพ', video: 'วิดีโอ', audio: 'เสียง', file: 'ไฟล์', sticker: 'สติกเกอร์' }
export const attachLabel = (a) => (a?.sticker ? KIND_LABEL.sticker : KIND_LABEL[a?.type] || 'ไฟล์')
// ข้อความสรุปสำหรับรายการแชท/อ้างอิง: คำบรรยาย หรือ "[รูปภาพ]"
export function messagePreview(m) {
  const t = String(m?.text || '').trim()
  if (t) return t
  const a = m?.attachments?.[0]
  return a ? `[${attachLabel(a)}]${m.attachments.length > 1 ? ` +${m.attachments.length - 1}` : ''}` : ''
}
