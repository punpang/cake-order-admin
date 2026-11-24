import { startSync, withVer, fillArray } from './tableSync.js'
import { campaignToRow, rowToCampaign } from './preorderCampaign.js'

// ซิงก์แคมเปญสั่งล่วงหน้า (db.preorderCampaigns) กับ punpang_preorder_campaigns · แบบเดียวกับกะ POS (shiftsSync.js)
const TABLE = 'punpang_preorder_campaigns'
const COLS = 'id,status,order_from,order_to,pickup_from,pickup_to,deposit_percent,pay_due_min,data,updated_at'
const LIMIT = 500

export const rowToPreorder = (r) => withVer(rowToCampaign(r), r.updated_at)

export async function loadPreorderCampaigns(client) {
  const r = await client.from(TABLE).select(COLS).order('order_from', { ascending: false }).limit(LIMIT)
  if (r.error) return { error: r.error.message }
  return { items: (r.data || []).map(rowToPreorder) }
}

// รอบดึงเฉพาะที่เปลี่ยน (ใช้ updated_at ที่ฐานข้อมูลตั้งให้)
export async function loadPreorderCampaignsSince(client, since) {
  const r = await client.from(TABLE).select(COLS).gte('updated_at', since).order('updated_at').limit(LIMIT)
  if (r.error) return { error: r.error.message }
  return { items: (r.data || []).map(rowToPreorder) }
}

export async function pushPreorderCampaigns(client, { upserts }) {
  for (const c of upserts) {
    const r = await client.from(TABLE).upsert(campaignToRow(c))
    if (r.error) return { error: r.error.message }
  }
  return { ok: true }
}

export function startPreorderSync({ client, db, canWrite, onError, debounceMs }) {
  return startSync({
    list: () => db.preorderCampaigns,
    replace: (items) => fillArray(db.preorderCampaigns, items),
    load: () => loadPreorderCampaigns(client),
    loadSince: (since) => loadPreorderCampaignsSince(client, since),
    push: (c) => pushPreorderCampaigns(client, c),
    canWrite, onError, debounceMs, label: 'แคมเปญสั่งล่วงหน้า', poll: true,
  })
}
