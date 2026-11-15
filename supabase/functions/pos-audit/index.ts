// Edge Function pos-audit: ตรวจบิลหน้าร้านที่ซิงก์แล้วและยังไม่เคยตรวจ (pg_cron เรียกทุก 10 นาทีด้วยคีย์ x-cron-key เดียวกับ scheduled)
// ไม่บล็อกการขาย: ผลเก็บใน punpang_order_audits · ใช้ตรรกะชุดเดียวกับแอป (_shared/schedlib/posAudit.js ที่ซิงก์จาก src/lib/posAudit.js)
// ดู docs/security.md (รอบ 2026-11-15) และ migration 20261115090000
import { auditPosOrder } from '../_shared/schedlib/posAudit.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const SERVICE_HEADERS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }

// เทียบคีย์แบบไม่ดูจากจุดที่ต่างกันเร็วกว่า (กันการเดาทีละตัว)
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// อ่านทั้งชุดแบบแบ่งหน้า (API ส่งทีละไม่เกิน 1000 แถว) · path ต้องมีเครื่องหมาย ? แล้ว
async function restAll(path: string): Promise<any[]> {
  const out: any[] = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${off}`, { headers: SERVICE_HEADERS })
    if (!r.ok) throw new Error(`rest ${r.status}`)
    const rows = await r.json()
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const key = (Deno.env.get('SCHEDULED_KEY') || '').trim()
  if (!key || !sameKey(key, req.headers.get('x-cron-key') || '')) return json({ error: 'forbidden' }, 403)
  if (!SUPABASE_URL || !SERVICE) return json({ error: 'config' }, 500)

  try {
    // 1) บิลที่ยังไม่เคยตรวจ (ฟังก์ชันนี้เรียกได้เฉพาะสิทธิ์เซิร์ฟเวอร์)
    const q = await fetch(`${SUPABASE_URL}/rest/v1/rpc/punpang_pos_unaudited`, {
      method: 'POST',
      headers: { ...SERVICE_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ p_limit: 200 }),
    })
    if (!q.ok) return json({ error: 'load' }, 502)
    const bills: any[] = await q.json()
    if (!bills.length) return json({ checked: 0, flagged: 0 })

    // 2) แคตาล็อกที่ใช้ตรวจ: สินค้าหน้าร้าน + ตัวเลือกหน้าร้าน
    const retailItems = await restAll('punpang_items?kind=eq.retail&select=id,name,price,active')
    const kv = await (await fetch(`${SUPABASE_URL}/rest/v1/punpang_kv?collection=eq.config&id=eq.posModifiers&select=data`, { headers: SERVICE_HEADERS })).json()
    const cat = { retailItems, posModifiers: Array.isArray(kv) ? (kv[0]?.data?.v ?? []) : [] }

    // 3) ตรวจแต่ละใบ แล้วบันทึกผล (ไม่แก้บิล)
    const now = new Date().toISOString()
    const rows = bills.map((b) => {
      const order = { ...(b.data || {}), id: b.id, channel: b.channel, status: b.status, fulfillment: b.fulfillment }
      const res = auditPosOrder(order, cat)
      return { order_id: b.id, checked_at: now, ok: res.ok, flags: res.flags }
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
