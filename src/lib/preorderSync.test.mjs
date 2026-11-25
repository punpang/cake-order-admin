// ทดสอบการโหลด/ส่งแคมเปญสั่งล่วงหน้า (ไม่ต่อฐานจริง ใช้ fake client) · รัน: node src/lib/preorderSync.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPreorderCampaigns, loadPreorderCampaignsSince, pushPreorderCampaigns } from './preorderSync.js'

// fake client: จับการเรียก และคืนผลลัพธ์ที่กำหนดเมื่อ await
function fakeClient(result) {
  const calls = []
  const chain = () => {
    const api = {
      select(cols) { calls.push(['select', cols]); return api },
      gte(c, v) { calls.push(['gte', c, v]); return api },
      order(c) { calls.push(['order', c]); return api },
      limit(n) { calls.push(['limit', n]); return api },
      upsert(row) { calls.push(['upsert', row]); return api },
      then(res, rej) { return Promise.resolve(result).then(res, rej) },
    }
    return api
  }
  return { calls, from(table) { calls.push(['from', table]); return chain() } }
}

const row = {
  id: 'pc1', status: 'open', order_from: '2026-12-01', order_to: '2026-12-15',
  pickup_from: '2026-12-24', pickup_to: '2026-12-26', deposit_percent: 50, pay_due_min: 120,
  data: { name: 'คริสต์มาส', dayCap: null, items: [{ retailId: 'A', dayCap: 2 }] },
  updated_at: '2026-11-24T10:00:00Z',
}

test('โหลดแคมเปญ: แปลงแถวเป็นแคมเปญ และคง dayCap ว่างเป็น null', async () => {
  const c = fakeClient({ data: [row], error: null })
  const r = await loadPreorderCampaigns(c)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].id, 'pc1')
  assert.equal(r.items[0].payDueMin, 120)
  assert.equal(r.items[0].dayCap, null)
  assert.deepEqual(r.items[0].items, [{ retailId: 'A', dayCap: 2 }])
  assert.ok(c.calls.some((x) => x[0] === 'from' && x[1] === 'punpang_preorder_campaigns'))
})

test('โหลดเฉพาะที่เปลี่ยนหลังเวลาที่กำหนด ใช้ updated_at', async () => {
  const c = fakeClient({ data: [], error: null })
  await loadPreorderCampaignsSince(c, '2026-11-24T09:00:00Z')
  assert.ok(c.calls.some((x) => x[0] === 'gte' && x[1] === 'updated_at' && x[2] === '2026-11-24T09:00:00Z'))
})

test('ส่งแคมเปญ: upsert ด้วยแถวที่แปลงแล้ว และคืน ok', async () => {
  const c = fakeClient({ data: null, error: null })
  const r = await pushPreorderCampaigns(c, { upserts: [{ id: 'pc2', name: 'ทดสอบ', status: 'draft', orderFrom: '2026-12-01', orderTo: '2026-12-15', pickupFrom: '2026-12-24', pickupTo: '2026-12-26', depositPercent: 50, payDueMin: 60, dayCap: null, items: [] }] })
  assert.equal(r.ok, true)
  const up = c.calls.find((x) => x[0] === 'upsert')
  assert.equal(up[1].id, 'pc2')
  assert.equal(up[1].pay_due_min, 60)
})

test('ส่งแคมเปญล้มเหลว: คืนข้อความจากฐานข้อมูล', async () => {
  const c = fakeClient({ data: null, error: { message: 'row violates check constraint' } })
  const r = await pushPreorderCampaigns(c, { upserts: [{ id: 'pc3', name: 'x', status: 'draft', orderFrom: '2026-12-01', orderTo: '2026-12-15', pickupFrom: '2026-12-24', pickupTo: '2026-12-26', depositPercent: 50, payDueMin: 60, dayCap: null, items: [] }] })
  assert.match(r.error, /check constraint/)
})
