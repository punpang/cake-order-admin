import { createClient } from 'npm:@supabase/supabase-js@2'

// ส่งข้อความ Messenger ไปหาลูกค้า (เฉพาะพนักงานที่มีสิทธิ์ chat) · ต้องอยู่ในหน้าต่าง 24 ชม. หลังลูกค้าทักล่าสุด
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const WINDOW_MS = 24 * 3600e3

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active,perms').eq('user_id', uid).maybeSingle()
  if (!st.data?.active || !(Array.isArray(st.data.perms) && st.data.perms.includes('chat'))) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์ตอบแชท' }, 403)
  let body: { psid?: string; channel?: string; text?: string; quoteId?: string; images?: unknown; card?: { kind?: string; title?: string; subtitle?: string; url?: string; image?: string; pay?: boolean } } = {}
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const psid = String(body.psid ?? '')
  const msg = String(body.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
  if (!/^\d{5,30}$/.test(psid)) return json({ error: 'ผู้รับไม่ถูกต้อง' }, 400)
  const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n)
  const cd = body.card && typeof body.card === 'object' ? body.card : null
  const kind = cd ? String(cd.kind ?? '') : ''
  if (cd && !['quote', 'order', 'link'].includes(kind)) return json({ error: 'ชนิดการ์ดไม่ถูกต้อง' }, 400)
  const cTitle = cd ? clean(cd.title, 80) : ''
  const cSub = cd ? clean(cd.subtitle, 80) : ''
  const httpsOk = (u: string) => u.length <= 500 && /^https:\/\/[^\s]+$/i.test(u)
  const cUrl = cd && (kind === 'link' || kind === 'order') ? String(cd.url ?? '').trim() : ''
  const cImg = cd ? String(cd.image ?? '').trim() : ''
  const cImgOk = !!cImg && httpsOk(cImg) // รูปไม่ถูกต้อง = ข้ามรูป (ไม่ทำให้ส่งไม่ได้)
  const cPay = !!(cd && cd.pay)
  if (cd && !cTitle) return json({ error: 'การ์ดต้องมีหัวข้อ' }, 400)
  if (kind === 'link' && !httpsOk(cUrl)) return json({ error: 'ลิงก์ในการ์ดต้องเป็น https' }, 400)
  // รูปที่พนักงานส่ง: อยู่ในบักเก็ต punpang-chat ใต้ staff/<psid>/ เท่านั้น (กันส่งรูปของลูกค้ารายอื่น)
  const images: string[] = Array.isArray(body.images) ? body.images.map((x) => String(x ?? '')) : []
  if (images.length > 5) return json({ error: 'ส่งรูปได้ครั้งละไม่เกิน 5 รูป' }, 400)
  if (images.some((p) => !new RegExp(`^staff/${psid}/[A-Za-z0-9_-]+\\.jpg$`).test(p))) return json({ error: 'ที่อยู่รูปไม่ถูกต้อง' }, 400)
  if (images.length && (cd || body.quoteId)) return json({ error: 'ส่งรูปพร้อมการ์ดหรือใบเสนอพร้อมกันไม่ได้' }, 400)
  // ช่องทาง: facebook (ค่าเริ่มต้น) | instagram · IG ส่งได้เฉพาะข้อความตัวอักษร (ไม่มีการ์ด ใบเสนอ หรือรูป)
  const chan = body.channel === 'instagram' ? 'instagram' : 'facebook'
  if (chan === 'instagram' && (cd || body.quoteId || images.length)) return json({ error: 'Instagram ส่งได้เฉพาะข้อความตัวอักษร' }, 400)
  if ((!msg && !cd && !images.length) || msg.length > 2000) return json({ error: 'ข้อความต้องยาว 1–2000 ตัวอักษร' }, 400)
  const quoteId = body.quoteId == null ? '' : String(body.quoteId)
  if (kind === 'quote' && !quoteId) return json({ error: 'การ์ดใบเสนอต้องระบุรหัสใบเสนอ' }, 400)
  if (quoteId && !/^[A-Za-z0-9_-]{1,40}$/.test(quoteId)) return json({ error: 'รหัสใบเสนอไม่ถูกต้อง' }, 400)
  const pg = await sb.from('punpang_fb_pages').select('page_id,token').limit(1).maybeSingle()
  if (!pg.data) return json({ error: 'ยังไม่ได้เชื่อมเพจ Facebook' }, 503)
  const chat = await sb.from('punpang_chats').select('id,data').eq('channel', chan).eq('external_id', psid).maybeSingle()
  const last = chat.data?.data?.lastInboundAt ? new Date(chat.data.data.lastInboundAt).getTime() : 0
  if (!chat.data) return json({ error: 'ไม่พบแชทของลูกค้ารายนี้' }, 404)
  if (!last || Date.now() - last > WINDOW_MS) return json({ error: 'เกิน 24 ชั่วโมงหลังลูกค้าทักล่าสุด ส่งผ่าน Messenger ไม่ได้' }, 409)
  // ใบเสนอพร้อมปุ่ม: ปุ่มสร้างจากฝั่งเซิร์ฟเวอร์เอง (postback ต้องเป็นใบเสนอที่รอยืนยันของแชทนี้เท่านั้น)
  let buttons: Record<string, unknown>[] = []
  if (quoteId) {
    const qr = await sb.from('punpang_quotes').select('id,chat_id,status').eq('id', quoteId).maybeSingle()
    if (!qr.data || qr.data.chat_id !== chat.data.id) return json({ error: 'ไม่พบใบเสนอของแชทนี้' }, 404)
    if (qr.data.status !== 'pending') return json({ error: 'ใบเสนอนี้ไม่รอการยืนยันแล้ว' }, 409)
    buttons = [
      { type: 'postback', title: 'ยืนยันสั่ง', payload: `q:ok:${quoteId}` },
      { type: 'postback', title: 'ขอแก้ไข', payload: `q:rev:${quoteId}` },
    ]
  }
  if (kind === 'link') buttons = [{ type: 'web_url', url: cUrl, title: 'ดูออร์เดอร์' }]
  if (kind === 'order' && cUrl && httpsOk(cUrl)) buttons = [{ type: 'web_url', url: cUrl, title: cPay ? 'ดูออร์เดอร์ / โอนเงิน' : 'ดูออร์เดอร์' }]
  const defUrl = (kind === 'link' || kind === 'order') && cUrl && httpsOk(cUrl) ? cUrl : ''
  // การ์ด = ข้อความรายละเอียด (ถ้ามี) แล้วตามด้วย generic template · ไม่มีการ์ด: ข้อความเดียว (ใบเสนอแบบเก่ายังส่งเป็น button template)
  const messages: Record<string, unknown>[] = []
  if (cd) {
    if (msg) messages.push({ text: msg })
    messages.push({ attachment: { type: 'template', payload: { template_type: 'generic', elements: [{ title: cTitle, ...(cImgOk ? { image_url: cImg } : {}), ...(cSub ? { subtitle: cSub } : {}), ...(defUrl ? { default_action: { type: 'web_url', url: defUrl } } : {}), ...(buttons.length ? { buttons } : {}) }] } } })
  } else if (quoteId) {
    const text = msg.length > 640 ? `${msg.slice(0, 636)}…` : msg // button template รับข้อความได้ไม่เกิน 640 ตัวอักษร
    messages.push({ attachment: { type: 'template', payload: { template_type: 'button', text, buttons } } })
  } else if (msg) messages.push({ text: msg })
  // รูป: ส่งหลังข้อความ ทีละรูป · ลิงก์ชั่วคราว 15 นาที (Facebook ดึงไฟล์ตอนส่ง)
  for (const p of images) {
    const s = await sb.storage.from('punpang-chat').createSignedUrl(p, 900)
    if (s.error || !s.data?.signedUrl) return json({ error: 'เปิดไฟล์รูปไม่ได้' }, 502)
    messages.push({ attachment: { type: 'image', payload: { url: s.data.signedUrl } } })
  }
  const ver = (Deno.env.get('FB_GRAPH_VERSION') || 'v24.0').trim()
  try {
    for (const message of messages) {
      const r = await fetch(`${'https://graph.facebook.com'}/${ver}/me/messages?${new URLSearchParams({ access_token: pg.data.token })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message }), signal: AbortSignal.timeout(15000) })
      if (!r.ok) return json({ error: 'Facebook ปฏิเสธการส่ง', status: r.status }, 502)
    }
    return json({ ok: true })
  } catch {
    return json({ error: 'เชื่อมต่อ Facebook ไม่ได้' }, 502)
  }
})
