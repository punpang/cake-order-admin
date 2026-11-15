// Edge Function order-audit: ตรวจออร์เดอร์ที่บันทึกแล้ว (บิลหน้าร้าน และออร์เดอร์ตรงที่อัปเดตภายใน 2 วัน) — ไม่บล็อกการขาย/การบันทึก
// pg_cron เรียกทุก 10 นาทีด้วยคีย์ x-cron-key เดียวกับ scheduled · ผลเก็บใน punpang_order_audits (เซิร์ฟเวอร์เขียนเท่านั้น)
// ตรรกะชุดเดียวกับแอป: _shared/schedlib/orderAudit.js (บิลหน้าร้านใช้ posAudit.js) · ราคาที่ใช้เทียบคือราคา ณ เวลาที่สร้าง (ประวัติแคตาล็อก)
// ดู docs/security.md (รอบ 2026-11-15)
import { auditOrder } from '../_shared/schedlib/orderAudit.js'
import { catalogAt } from '../_shared/schedlib/catalogHistory.js'
import { loadCatalog, pages } from '../_shared/catalog.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const SERVICE_HEADERS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }

// เทียบคีย์โดยไม่ออกทันทีเมื่อพบตัวที่ต่าง (กันการเดาทีละตัว)
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const key = (Deno.env.get('SCHEDULED_KEY') || '').trim()
  if (!key || !sameKey(key, req.headers.get('x-cron-key') || '')) return json({ error: 'forbidden' }, 403)
  if (!SUPABASE_URL || !SERVICE) return json({ error: 'config' }, 500)

  try {
    // 1) ออร์เดอร์ที่ยังไม่เคยตรวจ หรือถูกแก้หลังตรวจครั้งก่อน (ฟังก์ชันนี้เรียกได้เฉพาะสิทธิ์เซิร์ฟเวอร์)
    const q = await fetch(`${SUPABASE_URL}/rest/v1/rpc/punpang_orders_unaudited`, {
      method: 'POST',
      headers: { ...SERVICE_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ p_limit: 200 }),
    })
    if (!q.ok) return json({ error: 'load' }, 502)
    const orders: any[] = await q.json()
    if (!orders.length) return json({ checked: 0, flagged: 0 })

    // 2) แคตาล็อกปัจจุบัน และประวัติการเปลี่ยนแปลงตั้งแต่ออร์เดอร์เก่าที่สุดในรอบนี้ (ใช้ย้อนราคาไปเวลาที่สร้าง)
    const catalog = await loadCatalog(SUPABASE_URL, SERVICE_HEADERS)
    if (!catalog) return json({ error: 'catalog' }, 502)
    const created = orders.map((b) => Date.parse((b.data || {}).createdAt)).filter((x) => Number.isFinite(x))
    const since = new Date(created.length ? Math.min(...created) : Date.now() - 2 * 86400000).toISOString()
    const hist = await pages(SUPABASE_URL, SERVICE_HEADERS, `punpang_catalog_history?changed_at=gte.${encodeURIComponent(since)}&select=source,key,old_data,changed_at&order=changed_at.desc`)
    if (!hist) return json({ error: 'history' }, 502)
    const changes = hist.map((h) => ({ source: h.source, key: h.key, old: h.old_data, changedAt: h.changed_at }))

    // 3) ตรวจแต่ละใบด้วยราคา ณ เวลาที่สร้าง แล้วบันทึกผล (ไม่แก้ออร์เดอร์)
    const nowIso = new Date().toISOString()
    const rows = orders.map((b) => {
      const order = { ...(b.data || {}), id: b.id, channel: b.channel, status: b.status, fulfillment: b.fulfillment }
      const createdMs = Date.parse(order.createdAt)
      const at = Number.isFinite(createdMs) ? createdMs : Date.now()
      const res: any = auditOrder(order, catalogAt(catalog, changes, at), { nowMs: at })
      return { order_id: b.id, checked_at: nowIso, ok: res.ok, flags: res.flags }
    })
    const up = await fetch(`${SUPABASE_URL}/rest/v1/punpang_order_audits`, {
      method: 'POST',
      headers: { ...SERVICE_HEADERS, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    })
    if (!up.ok) return json({ error: 'save' }, 502)
    return json({ checked: rows.length, flagged: rows.filter((x) => !x.ok).length })
  } catch {
    return json({ error: 'failed' }, 502)
  }
})
