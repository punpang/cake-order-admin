// เรียก Edge Function ของ Facebook (fb-connect / fb-send) · คืน { error } แทนการ throw
async function invoke(client, name, body) {
  try {
    const r = await client.functions.invoke(name, { body })
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
export const fbConnectCall = (client, action, body = {}) => invoke(client, 'fb-connect', { action, ...body })
export const fbSendCall = (client, psid, text, { quoteId = '', card = null } = {}) => invoke(client, 'fb-send', { psid, text, ...(quoteId ? { quoteId } : {}), ...(card ? { card } : {}) })

// ข้อความ error จากหน้า callback ของ Facebook (?fb=error&m=…)
export const FB_ERRORS = {
  config: 'ยังไม่ได้ตั้งค่า Facebook ฝั่งเซิร์ฟเวอร์',
  denied: 'ยกเลิกหรือไม่ได้อนุญาตสิทธิ์',
  expired: 'หมดอายุหรือใช้ซ้ำ กรุณากดเชื่อมใหม่',
  token: 'แลกสิทธิ์กับ Facebook ไม่สำเร็จ (ตรวจ App ID/Secret และ Redirect URI)',
  pages: 'ดึงรายชื่อเพจไม่สำเร็จ (ตรวจสิทธิ์ pages_show_list)',
  nopage: 'ไม่พบเพจที่บัญชีนี้จัดการได้',
  network: 'เชื่อมต่อ Facebook ไม่ได้ กรุณาลองใหม่',
}
