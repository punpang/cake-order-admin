import { modeOf, refuseInTest } from '../_shared/mode.ts'
import { corsWrap } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { priceCampaignOrder } from '../_shared/schedlib/preorderPrice.js'

// สั่งล่วงหน้า (ลูกค้า): ฟังก์ชันสาธารณะ (--no-verify-jwt) · ขั้นนี้มี 2 action: campaigns (ดูแคมเปญที่เปิดรับ) และ quote (คิดราคาให้ดู)
// ข้อมูลที่ส่งกลับไม่มีตารางอัตราค่าส่ง · ราคาทั้งหมดคิดที่เซิร์ฟเวอร์ · ค่าที่ผู้ใช้ส่งมาเรื่องราคา/ค่าส่ง/แต้มไม่ถูกใช้
// ยังไม่มีการสร้างออร์เดอร์ (เฟส 2D ถัดไป) และยังไม่มีการจ่ายเงิน (เฟส 3)
const CORS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const bangkokToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// แคตาล็อกที่ใช้คิดราคา (ชุดย่อยของ loadCatalog: ร้าน สินค้าหน้าร้าน แต้ม)
async function catalogOf(sb: any) {
  const [shopRow, loyRow, items] = await Promise.all([
    sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle(),
    sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'loyalty').maybeSingle(),
    sb.from('punpang_items').select('id,kind,name,price,active,data').eq('kind', 'retail'),
  ])
  const shop = shopRow.data?.data?.v ?? {}
  const pointValue = Number(loyRow.data?.data?.v?.pointValue ?? 1)
  const retailItems = (items.data || []).map((x: any) => ({ ...(x.data || {}), id: x.id, name: x.name, price: Number(x.price) || 0, active: x.active !== false, kind: 'retail' }))
  return { catalog: { shop, retailItems, priceLists: [], optionGroups: [], bundles: [], posDiscounts: [], posBundles: [], posDeals: [] }, pointValue }
}

// แคมเปญที่เปิดรับตอนนี้ (สถานะ open และอยู่ในช่วงรับสั่ง)
async function openCampaign(sb: any, id: string) {
  const r = await sb.from('punpang_preorder_campaigns').select('*').eq('id', id).maybeSingle()
  const c = r.data
  if (!c || c.status !== 'open') return null
  const today = bangkokToday()
  if (today < c.order_from || today > c.order_to) return null
  return c
}

Deno.serve(corsWrap(async (req) => {
  const refused = refuseInTest(modeOf(req))
  if (refused) return refused
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const action = String(b.action || '')

  // ===== แคมเปญที่เปิดรับ (ไม่มีข้อมูลส่วนตัว ไม่มีอัตราค่าส่ง) =====
  if (action === 'campaigns') {
    const r = await sb.from('punpang_preorder_campaigns').select('*').eq('status', 'open')
    const today = bangkokToday()
    const open = (r.data || []).filter((c: any) => today >= c.order_from && today <= c.order_to)
    const { catalog } = await catalogOf(sb)
    const campaigns = open.map((c: any) => ({
      id: c.id,
      name: c.data?.name ?? '',
      orderFrom: c.order_from,
      orderTo: c.order_to,
      pickupFrom: c.pickup_from,
      pickupTo: c.pickup_to,
      depositPercent: c.deposit_percent,
      payDueMin: c.pay_due_min,
      parcelEnabled: c.data?.parcel?.enabled === true,
      deals: (c.data?.deals ?? []).map((d: any) => ({ kind: d.kind, name: d.name, tiers: d.tiers })),
      items: (c.data?.items ?? []).map((i: any) => {
        const p = catalog.retailItems.find((x: any) => x.id === i.retailId)
        return { retailId: i.retailId, name: p?.name ?? '', price: p?.price ?? 0, dayCap: i.dayCap ?? null }
      }),
    }))
    return json({ campaigns })
  }

  // ===== คิดราคาให้ดู (ไม่จองโควตา ไม่สร้างออร์เดอร์) =====
  if (action === 'quote') {
    const c = await openCampaign(sb, String(b.campaignId || ''))
    if (!c) return json({ error: 'แคมเปญนี้ไม่เปิดรับสั่งในขณะนี้' }, 409)
    if (!isDay(b.pickupDate) || b.pickupDate < c.pickup_from || b.pickupDate > c.pickup_to) return json({ error: 'วันรับสินค้าไม่อยู่ในช่วงที่กำหนด' }, 400)
    if (b.fulfillment !== 'pickup' && b.fulfillment !== 'delivery') return json({ error: 'เลือกรับที่ร้านหรือส่งพัสดุ' }, 400)
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 30) return json({ error: 'เลือกสินค้า 1–30 รายการ' }, 400)
    const lines = b.lines.map((l: any) => ({ retailId: String(l?.retailId ?? ''), qty: l?.qty }))
    const { catalog, pointValue } = await catalogOf(sb)
    const campaign = { id: c.id, items: (c.data?.items ?? []), deals: c.data?.deals ?? [], parcel: c.data?.parcel ?? { enabled: false } }
    const q: any = priceCampaignOrder({ campaign, catalog, lines, pickupDate: b.pickupDate, fulfillment: b.fulfillment, points: 0, pointValue, nowMs: Date.now() })
    if (!q.ok) return json({ error: q.error, itemId: q.itemId ?? null }, 400)
    return json({ ok: true, total: q.totals.total, vat: q.totals.vat, shippingFee: q.order.shippingFee, goods: q.totals.beforeVat ?? null, parcel: q.snapshot.parcel ? { chargeableG: q.snapshot.parcel.chargeableG } : null })
  }

  return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)
}))
