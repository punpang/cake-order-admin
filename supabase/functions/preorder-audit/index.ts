// Edge Function preorder-audit: ตรวจค่าส่งและแต้มของออร์เดอร์สั่งล่วงหน้าที่ส่งมอบ/ยกเลิกแล้วและให้แต้มแล้ว
// เรียกด้วย x-cron-key (ตั้ง pg_cron ยังไม่ได้ จนกว่าจะแก้ปัญหา cron ของสั่งล่วงหน้าบน production) · ผลเก็บใน punpang_preorder_audits
// ตรรกะชุดเดียวกับแอป: _shared/schedlib/preorderAudit.js · ไม่แก้ออร์เดอร์
// ค่าส่งใช้ตารางพัสดุ ณ เวลาสร้างออร์เดอร์ (catalogAt) และขั้นส่วนลดค่าส่งปัจจุบันของแคมเปญ (ออร์เดอร์ไม่เก็บ shipDiscount แยก)
import { auditPreorderOrder } from '../_shared/schedlib/preorderAudit.js'
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
    // 1) ออร์เดอร์ที่ต้องตรง (ส่งมอบ/ยกเลิก, มี loyalty, ยังไม่ถูกตรวจหลังแก้ไขล่าสุด)
    const q = await fetch(`${SUPABASE_URL}/rest/v1/rpc/punpang_preorder_orders_unaudited`, {
      method: 'POST',
      headers: { ...SERVICE_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ p_limit: 200 }),
    })
    if (!q.ok) return json({ error: 'load' }, 502)
    const orders: any[] = await q.json()
    if (!orders.length) return json({ checked: 0, flagged: 0 })

    // 2) แคตาล็อกปัจจุบัน ประวัติการเปลี่ยนแปลงตั้งแต่ออร์เดอร์เก่าที่สุด ขั้นส่วนลดค่าส่งของแคมเปญ และค่าแต้มต่อบาท
    const catalog = await loadCatalog(SUPABASE_URL, SERVICE_HEADERS)
    if (!catalog) return json({ error: 'catalog' }, 502)
    const created = orders.map((o) => Date.parse(o.created_at)).filter((x) => Number.isFinite(x))
    const since = new Date(created.length ? Math.min(...created) : Date.now() - 2 * 86400000).toISOString()
    const hist = await pages(SUPABASE_URL, SERVICE_HEADERS, `punpang_catalog_history?changed_at=gte.${encodeURIComponent(since)}&select=source,key,old_data,changed_at&order=changed_at.desc`)
    if (!hist) return json({ error: 'history' }, 502)
    const changes = hist.map((h) => ({ source: h.source, key: h.key, old: h.old_data, changedAt: h.changed_at }))

    const campIds = [...new Set(orders.map((o) => String(o.campaign_id)))]
    const camps = await pages(SUPABASE_URL, SERVICE_HEADERS, `punpang_preorder_campaigns?id=in.(${encodeURIComponent(campIds.map((c) => `"${c}"`).join(','))})&select=id,data`)
    if (!camps) return json({ error: 'campaigns' }, 502)
    const shipOffOf = new Map<string, any>(camps.map((c) => [String(c.id), c.data?.shipOff ?? []]))

    const loyalty = await pages(SUPABASE_URL, SERVICE_HEADERS, 'punpang_kv?collection=eq.config&id=eq.loyalty&select=id,data')
    if (!loyalty) return json({ error: 'loyalty' }, 502)
    const earnPer = loyalty[0]?.data?.v?.earnPer

    // 3) ตรวจแต่ละใบ แล้วบันทึกผล (ไม่แก้ออร์เดอร์)
    const nowIso = new Date().toISOString()
    const rows = orders.map((o) => {
      const d = o.data || {}
      const order = { ...d, id: o.id, status: o.status }
      const at = Date.parse(o.created_at)
      const res: any = auditPreorderOrder(order, {
        catalog: catalogAt(catalog, changes, Number.isFinite(at) ? at : Date.now()),
        shipOff: shipOffOf.get(String(o.campaign_id)) ?? [],
        earnPer,
      })
      return { order_id: o.id, checked_at: nowIso, ok: res.ok, flags: res.flags }
    })
    const up = await fetch(`${SUPABASE_URL}/rest/v1/punpang_preorder_audits`, {
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
