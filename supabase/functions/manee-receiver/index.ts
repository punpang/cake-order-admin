import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyGatewaySignature, parseManeeAmount, isManeeApp } from '../_shared/maneeforward.ts'

// รับ notification.forwarded / sms.forwarded จากแอปส่งต่อ → บันทึกยอดรับเงินแม่มณีลงตาราง manee_transfers
// ค่าลับ: MANEE_FORWARD_SECRET (ค่าเดียวกับกฎส่งต่อ) · MANEE_APP_IDS (ไม่บังคับ) · ไม่มีการตอบข้อมูลภายในให้ผู้เรียก
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const secret = Deno.env.get('MANEE_FORWARD_SECRET') || ''
  const raw = await req.text()
  const ok = await verifyGatewaySignature(secret, req.headers.get('X-Gateway-Timestamp') || '', raw, req.headers.get('X-Gateway-Signature') || '', Math.floor(Date.now() / 1000))
  if (!ok) return json({ error: 'signature' }, 401)

  let p: any
  try { p = JSON.parse(raw) } catch { return json({ error: 'json' }, 400) }
  // DEBUG ชั่วคราว: บันทึกโครงสร้างคำขอ (ตัวเลขยาวถูกปิดบัง เพื่อไม่เก็บเลขบัญชี) · ลบออกหลังทดสอบเสร็จ
  console.log('manee-debug', JSON.stringify({ event: p?.event, app: p?.app, app_name: p?.app_name, test: p?.test, keys: Object.keys(p ?? {}), id_len: String(p?.id ?? '').length, amount_ok: parseManeeAmount(String(p?.text ?? '')) != null, text: String(p?.text ?? '').replace(/\d{6,}/g, '#').slice(0, 160) }))
  // ตอบ 2xx กับรายการที่ไม่ใช่แม่มณีด้วย เพื่อให้แอปไม่ส่งซ้ำ
  const isRelevant = p?.event === 'notification.forwarded' && isManeeApp(String(p.app ?? ''), String(p.app_name ?? ''), Deno.env.get('MANEE_APP_IDS') || '')
  if (!isRelevant || p.test === true) return json({ ok: true, stored: false })
  const id = String(p.id ?? '')
  const amount = parseManeeAmount(String(p.text ?? ''))
  if (!/^[0-9a-f-]{36}$/i.test(id) || amount == null) return json({ ok: true, stored: false })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { error } = await sb.from('manee_transfers').upsert({
    id, amount, received_at: new Date(Number(p.received_at)).toISOString(), app: String(p.app ?? ''), text: String(p.text ?? '').slice(0, 300),
  }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) { console.error('manee insert', error.message); return json({ error: 'store' }, 500) }
  return json({ ok: true, stored: true })
})
