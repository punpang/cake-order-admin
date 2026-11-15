// เรียก Edge Function line-send (ส่งข้อความ LINE ไปหาลูกค้าที่มีแชท LINE) · คืน { error } แทนการ throw
// โทเค็น LINE อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น หน้าเว็บไม่เห็นค่า
export async function lineSendCall(client, to, text) {
  try {
    const r = await client.functions.invoke('line-send', { body: { to, text } })
    if (r.error) {
      let m = ''
      try { m = (await r.error.context?.json?.())?.error || '' } catch { /* ข้าม */ }
      return { error: m || 'ส่ง LINE ไม่สำเร็จ' }
    }
    return r.data?.ok ? { ok: true } : { error: r.data?.error || 'ส่ง LINE ไม่สำเร็จ' }
  } catch {
    return { error: 'เชื่อมต่อ LINE ไม่ได้' }
  }
}
