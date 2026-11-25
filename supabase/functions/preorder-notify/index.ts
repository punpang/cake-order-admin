import { modeOf, refuseInTest } from '../_shared/mode.ts'
// แจ้งลูกค้าสั่งล่วงหน้า: เตือนก่อนหมดเวลา 1 ชม. และแจ้งหมดเวลา · เรียกทุก 5 นาทีจาก pg_cron ด้วยคีย์ x-cron-key
// การกันซ้ำอยู่ในฐานข้อมูล (ส่งครั้งเดียวต่อออเดอร์+เหตุการณ์) · ทำซ้ำได้ปลอดภัย
import { createClient } from 'npm:@supabase/supabase-js@2'
import { notifyOrderEvent } from '../_shared/preorderNotify.ts'
import { planReminders, planExpired, planPickupReminders, inPickupReminderWindow, runWithCap, SEND_CAP_PER_RUN } from '../_shared/preorderNotifyPlan.ts'

const LIMIT = 500
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// เทียบคีย์แบบคงที่เวลา
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// แปลงแถวฐานข้อมูลเป็นรูปแบบที่ใช้คัดรายการ
const shape = (r: any) => ({ id: r.id, status: r.status, payDueAt: r.data?.payDueAt ?? null, total: Number(r.data?.total) || 0, paid: Number(r.data?.paid) || 0, fulfillment: r.data?.fulfillment ?? null, pickupDate: r.pickup_date ?? null })

Deno.serve(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const key = (Deno.env.get('SCHEDULED_KEY') || '').trim()
  if (!key || !sameKey(key, req.headers.get('x-cron-key') || '')) return json({ error: 'forbidden' }, 403)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const nowMs = Date.now()
  const since = new Date(nowMs - 25 * 3600e3).toISOString()
  const waiting = await db.from('punpang_preorder_orders').select('id,status,pickup_date,data').in('status', ['awaiting_payment', 'payment_confirmed']).limit(LIMIT)
  const expired = await db.from('punpang_preorder_orders').select('id,status,data').eq('status', 'expired').gte('updated_at', since).limit(LIMIT)
  if (waiting.error || expired.error) return json({ error: 'load_failed' }, 500)

  const reminderIds = [...new Set(planReminders((waiting.data || []).map(shape), nowMs))]
  const expiredIds = planExpired((expired.data || []).map(shape), nowMs)
  // เพดานรวมต่อรอบ: เตือนก่อนหมดเวลาก่อน แล้วหมดเวลา แล้วแจ้งก่อนวันรับ · รายการที่เกินเพดานจะถูกส่งรอบถัดไป
  const r1 = await runWithCap(reminderIds, SEND_CAP_PER_RUN, (id) => notifyOrderEvent(db, id, 'reminder1h'))
  const r2 = await runWithCap(expiredIds, SEND_CAP_PER_RUN - r1.used, (id) => notifyOrderEvent(db, id, 'expired'))
  // แจ้งยอดคงเหลือก่อนวันรับ (รับที่ร้านเท่านั้น) · ส่งได้ช่วง 09:00–19:59 เวลาไทย · กันซ้ำต่อวันรับด้วยการจองสิทธิ์
  let pickupSent = 0
  if (inPickupReminderWindow(nowMs)) {
    const rows = (waiting.data || []).map(shape)
    const items = planPickupReminders(rows, nowMs).map((id) => ({ id, key: rows.find((r: { id: string; pickupDate: string | null }) => r.id === id)?.pickupDate ?? '' }))
    const left = SEND_CAP_PER_RUN - r1.used - r2.used
    const r3 = await runWithCap(items, left, (it) => notifyOrderEvent(db, it.id, 'pickup_reminder', { key: it.key }))
    pickupSent = r3.sent
  }
  return json({ ok: true, reminders: r1.sent, expired: r2.sent, pickupReminders: pickupSent })
})
