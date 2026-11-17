import { modeOf, refuseInTest } from '../_shared/mode.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyGatewaySignature, extractTransferRef, extractAmount } from '../_shared/maneeforward.ts'
import { applyNotifyPayment } from '../_shared/notifyconfirm.ts'
import { autoConfirmOf } from '../_shared/slip.ts'

// รับ notification.forwarded จากแอปส่งต่อ (ถุงเงิน) → บันทึกรหัสธุรกรรม ORD/POS ลงตาราง tungngern_transfers เพื่อจับคู่กับ QR หน้าร้าน
// ทุกคำขอที่ผ่านลายเซ็นจะบันทึกลง tungngern_inbox (แอป · ข้อความ · ผ่าน/ไม่ผ่าน · เหตุผล) เพื่อดูรายงานแอปที่ส่งเข้ามา
// ค่าลับ: TUNGNGERN_FORWARD_SECRET (ค่าเดียวกับกฎส่งต่อ · ถ้าไม่ได้ตั้งจะอ่านชื่อเก่า MANEE_FORWARD_SECRET แทนระหว่างย้ายชื่อ) · MANEE_APP_IDS (ไม่บังคับ) · ไม่มีการตอบข้อมูลภายในให้ผู้เรียก
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused // โหมดทดสอบไม่ทำงานฟังก์ชันนี้ (ข้อมูลลูกค้า/งานตามเวลา/เว็บฮุกเป็นของจริงเท่านั้น)
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const secret = Deno.env.get('TUNGNGERN_FORWARD_SECRET') || Deno.env.get('MANEE_FORWARD_SECRET') || ''
  const raw = await req.text()
  const ok = await verifyGatewaySignature(secret, req.headers.get('X-Gateway-Timestamp') || '', raw, req.headers.get('X-Gateway-Signature') || '', Math.floor(Date.now() / 1000))
  if (!ok) return json({ error: 'signature' }, 401)

  let p: any
  try { p = JSON.parse(raw) } catch { return json({ error: 'json' }, 400) }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const logInbox = async (stored: boolean, reason: string) => {
    const { error } = await sb.from('tungngern_inbox').insert({
      app: String(p?.app ?? '').slice(0, 200), app_name: String(p?.app_name ?? '').slice(0, 200),
      event: String(p?.event ?? '').slice(0, 100), title: String(p?.title ?? '').slice(0, 200), text: String(p?.text ?? '').slice(0, 500), stored, reason,
    })
    if (error) console.error('manee inbox', error.message)
  }

  // ตอบ 2xx กับรายการที่ไม่ใช่ถุงเงินด้วย เพื่อให้แอปไม่ส่งซ้ำ
  if (p?.event !== 'notification.forwarded') { await logInbox(false, 'event ไม่รองรับ'); return json({ ok: true, stored: false }) }
  // รายชื่อแอปที่รับ (ถุงเงิน) ตั้งจากหน้าเว็บ (ตาราง tungngern_app_names · เทียบชื่อแอปที่แสดงบนโทรศัพท์ ไม่สนตัวพิมพ์) + MANEE_APP_IDS (รหัสแอป, ไม่บังคับ)
  const { data: nameRows } = await sb.from('tungngern_app_names').select('name')
  const names = (nameRows ?? []).map((r: { name: string }) => r.name.trim().toLowerCase())
  const appName = String(p.app_name ?? '').trim().toLowerCase()
  const ids = (Deno.env.get('MANEE_APP_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const isMatch = (appName !== '' && names.includes(appName)) || ids.includes(String(p.app ?? ''))
  if (!isMatch) { await logInbox(false, 'ไม่อยู่ในรายชื่อแอปถุงเงิน'); return json({ ok: true, stored: false }) }
  if (p.test === true) { await logInbox(false, 'ข้อความทดสอบ (test=true)'); return json({ ok: true, stored: false }) }
  const id = String(p.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) { await logInbox(false, 'id ไม่ถูกต้อง'); return json({ ok: true, stored: false }) }
  const ref = extractTransferRef(String(p.text ?? ''))
  if (!ref) { await logInbox(false, 'ไม่พบรหัสธุรกรรม (ORD/POS) ในข้อความ'); return json({ ok: true, stored: false }) }

  const amount = extractAmount(String(p.title ?? ''), String(p.text ?? ''))
  // received_at ที่ไม่ใช่เวลาที่ถูกต้อง (ไม่ใช่ตัวเลข หรือเลขใหญ่เกินช่วงวันที่) → toISOString() จะโยนข้อผิดพลาดและทำให้ตอบ 500 · บันทึกด้วยเวลาปัจจุบันแทน และไม่จับคู่งวดชำระ (ให้พนักงานตรวจเอง)
  const receivedMs = Number(p.received_at)
  const timeOk = Number.isFinite(receivedMs) && Number.isFinite(new Date(receivedMs).getTime())
  const { data: inserted, error } = await sb.from('tungngern_transfers').upsert({
    id, ref, amount, received_at: new Date(timeOk ? receivedMs : Date.now()).toISOString(), app: String(p.app ?? ''), text: String(p.text ?? '').slice(0, 300),
  }, { onConflict: 'id', ignoreDuplicates: true }).select('id')
  if (error) { console.error('manee insert', error.message); await logInbox(false, 'บันทึกตารางไม่สำเร็จ'); return json({ error: 'store' }, 500) }
  // รับซ้ำ (แอปส่งซ้ำ) → ไม่จับคู่ซ้ำ
  if (!(inserted ?? []).length) { await logInbox(true, 'รับซ้ำ ไม่ทำซ้ำ'); return json({ ok: true, stored: true }) }
  // จับคู่งวดชำระด้วยรหัส Ref2 + ยอด → ยืนยันอัตโนมัติ หรือทำเครื่องหมายผ่านการตรวจสอบให้พนักงานยืนยัน
  const cfg = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'slipQr').maybeSingle()
  const ac = autoConfirmOf(cfg?.data?.data?.v)
  const res = timeOk
    ? await applyNotifyPayment(sb, { ref, amount, receivedMs, autoOn: ac.enabled, days: ac.days, nowIso: new Date().toISOString() })
    : { done: false, reason: 'เวลารับเงินในแจ้งเตือนไม่ถูกต้อง' }
  await logInbox(true, `บันทึกรหัสธุรกรรมแล้ว · ${res.reason}`)
  return json({ ok: true, stored: true })
})
