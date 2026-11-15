import { rowToQuote } from './chatSync'

// ส่งใบเสนอผ่าน Edge Function quote-create: เซิร์ฟเวอร์คิดราคาจากแคตาล็อกและบันทึกใบเสนอเอง · คืน { quote } | { error } (ไม่ throw)
export async function createQuoteRemote(client, chatId, draft) {
  try {
    const r = await client.functions.invoke('quote-create', { body: { chatId, draft } })
    if (r.error) {
      let m = ''
      try { m = (await r.error.context?.json?.())?.error || '' } catch { /* ข้าม */ }
      return { error: m || 'ส่งใบเสนอไม่สำเร็จ' }
    }
    return r.data?.quote ? { quote: rowToQuote(r.data.quote) } : { error: 'ส่งใบเสนอไม่สำเร็จ' }
  } catch {
    return { error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองส่งใหม่อีกครั้ง' }
  }
}
