// เรียกฟังก์ชัน campaign (ผู้ดูแลระบบเท่านั้น) และอัปโหลดรูปประชาสัมพันธ์ · คืน { error } แทนการ throw
import { getSupabase, supabaseEnabled } from './supabase'
import { uploadPublicImage } from './storage'

const OFFLINE_MSG = 'ต้องเชื่อมต่อฐานข้อมูลออนไลน์ก่อน จึงจะส่งข้อความถึงลูกค้าได้'

export async function campaignCall(action, payload = {}) {
  if (!supabaseEnabled) return { error: OFFLINE_MSG }
  try {
    const client = await getSupabase()
    if (!client) return { error: OFFLINE_MSG }
    const r = await client.functions.invoke('campaign', { body: { action, ...payload } })
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

// อัปโหลดรูปประชาสัมพันธ์ (ไฟล์ภาพ ไม่เกิน 2 MB) → คืน { url } ที่เป็น https
export async function uploadCampaignImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return { error: 'เลือกไฟล์รูปภาพ' }
  if (file.size > 2 * 1024 * 1024) return { error: 'รูปใหญ่เกิน 2 MB' }
  if (!supabaseEnabled) return { error: OFFLINE_MSG }
  const src = URL.createObjectURL(file)
  try {
    const client = await getSupabase()
    return { url: await uploadPublicImage(client, src, 'campaign') }
  } catch {
    return { error: 'อัปโหลดรูปไม่สำเร็จ' }
  } finally {
    URL.revokeObjectURL(src)
  }
}
