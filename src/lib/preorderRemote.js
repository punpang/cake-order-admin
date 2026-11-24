import { getSupabase } from './supabase'
import { readPreorderToken, savePreorderToken, clearPreorderToken } from './preorderToken.js'

// สั่งล่วงหน้า (ฝั่งลูกค้า): เรียก Edge Function 'preorder' ผ่านไคลเอนต์ supabase เดียวกับบัญชีลูกค้า
// โทเคนเซสชันสั่งล่วงหน้าเก็บแยกจากเซสชันบัญชีเต็ม (ดู preorderToken.js)

export { readPreorderToken, savePreorderToken, clearPreorderToken }

const NET = 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'

// ส่ง action ไปยัง preorder · ตอบ { ...ผลลัพธ์ } หรือ { error, status }
// token ที่เก็บในเครื่องถูกแนบอัตโนมัติ ถ้า action ต้องใช้เซสชันและเซิร์ฟเวอร์ตอบ 401 จะล้างโทเคนทิ้ง
export async function callPreorder(action, body = {}) {
  const c = await getSupabase()
  if (!c) return { error: 'ยังไม่ได้เปิดใช้งานออนไลน์' }
  const token = readPreorderToken()
  try {
    const r = await c.functions.invoke('preorder', { body: { action, ...(token ? { token } : {}), ...body } })
    if (r.error) {
      let d = null
      try { d = await r.error.context?.json() } catch { d = null }
      const status = r.error.context?.status
      if (status === 401) clearPreorderToken()
      return { ...(d || {}), error: d?.error || NET, status }
    }
    if (r.data?.token) savePreorderToken(r.data.token)
    return r.data || { error: NET }
  } catch { return { error: NET } }
}
