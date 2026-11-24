// ทดสอบโมดูลข้อมูลแคมเปญสั่งล่วงหน้า (ระดับ store จริง ผ่าน Vite SSR) · รัน: node src/data/preorder.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
const cases = []
const t = (name, fn) => cases.push([name, fn])

try {
  const S = await server.ssrLoadModule('/src/data/store.js')
  const P = await server.ssrLoadModule('/src/data/preorder.js')
  const C = await server.ssrLoadModule('/src/lib/preorderCampaign.js')
  const { db, session } = S
  session.role = 'admin'
  db.retailItems.push(
    { id: 'A', name: 'เค้ก A', active: true, price: 100 },
    { id: 'B', name: 'เค้ก B', active: true, price: 80 },
    { id: 'O', name: 'กำหนดราคาเอง', active: true, price: 0, openPrice: true },
  )
  const base = () => ({
    ...C.blankCampaign(), name: 'คริสต์มาส', orderFrom: '2026-12-01', orderTo: '2026-12-15',
    pickupFrom: '2026-12-24', pickupTo: '2026-12-26', payDueMin: 120,
    items: [{ retailId: 'A', dayCap: 2 }],
  })
  const before = () => db.preorderCampaigns.length

  t('บันทึกแคมเปญใหม่ได้ มีรหัสและอยู่ในรายการ', () => {
    const n = before()
    const r = P.savePreorderCampaign(base())
    assert.equal(r.ok, true, r.error)
    assert.ok(r.campaign.id)
    assert.equal(before(), n + 1)
    assert.ok(P.preorderCampaigns().some((c) => c.id === r.campaign.id))
  })
  t('เวลาจ่ายมัดจำว่าง → บันทึกไม่ได้', () => {
    const n = before()
    assert.ok(P.savePreorderCampaign({ ...base(), payDueMin: null }).error)
    assert.equal(before(), n)
  })
  t('สินค้าที่กำหนดราคาเอง / ไม่มีในคลัง → บันทึกไม่ได้', () => {
    assert.ok(P.savePreorderCampaign({ ...base(), items: [{ retailId: 'O', dayCap: null }] }).error)
    assert.ok(P.savePreorderCampaign({ ...base(), items: [{ retailId: 'ไม่มี', dayCap: null }] }).error)
  })
  t('แก้แคมเปญเดิมไม่เพิ่มแถว', () => {
    const r = P.savePreorderCampaign(base())
    const n = before()
    const r2 = P.savePreorderCampaign({ ...r.campaign, name: 'คริสต์มาส (แก้)' })
    assert.equal(r2.ok, true, r2.error)
    assert.equal(before(), n)
    assert.equal(db.preorderCampaigns.find((c) => c.id === r.campaign.id).name, 'คริสต์มาส (แก้)')
  })
  t('แคมเปญที่เปิดรับ: แก้ชื่อได้ แก้โครงสร้าง (เพดาน/วัน/มัดจำ) ไม่ได้', () => {
    const r = P.savePreorderCampaign(base())
    assert.equal(P.setPreorderCampaignStatus(r.campaign.id, 'open').ok, true)
    assert.equal(P.savePreorderCampaign({ ...r.campaign, name: 'เปิดรับ (ชื่อใหม่)' }).ok, true)
    assert.match(P.savePreorderCampaign({ ...r.campaign, dayCap: 9 }).error, /ปิดรับก่อน/)
    assert.match(P.savePreorderCampaign({ ...r.campaign, items: [{ retailId: 'B', dayCap: null }] }).error, /ปิดรับก่อน/)
    assert.equal(db.preorderCampaigns.find((c) => c.id === r.campaign.id).dayCap ?? null, null)
    assert.equal(P.setPreorderCampaignStatus(r.campaign.id, 'closed').ok, true)
    assert.equal(P.savePreorderCampaign({ ...r.campaign, dayCap: 9 }).ok, true)
  })
  t('2B: เปิดส่งพัสดุแต่สินค้าไม่มีน้ำหนัก/ขนาด → บันทึกไม่ได้ · ครบแล้วบันทึกได้', () => {
    const noDims = P.savePreorderCampaign({ ...base(), parcel: { enabled: true }, shipFrom: '2026-12-22', shipTo: '2026-12-23' })
    assert.match(noDims.error, /ไม่มีน้ำหนักหรือขนาด/)
    const a = db.retailItems.find((x) => x.id === 'A')
    Object.assign(a, { weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } })
    assert.equal(P.savePreorderCampaign({ ...base(), parcel: { enabled: true }, shipFrom: '2026-12-22', shipTo: '2026-12-23' }).ok, true)
  })
  t('shipping: เปิดส่งพัสดุแล้วไม่ระบุช่วงวันจัดส่ง → บันทึกไม่ได้ · เก็บช่วงวันจัดส่งที่แคมเปญ', () => {
    const a = db.retailItems.find((x) => x.id === 'A')
    Object.assign(a, { weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } })
    assert.match(P.savePreorderCampaign({ ...base(), parcel: { enabled: true } }).error, /ช่วงวันจัดส่งพัสดุ/)
    const ok = P.savePreorderCampaign({ ...base(), parcel: { enabled: true }, shipFrom: '2026-12-22', shipTo: '2026-12-23' })
    assert.equal(ok.ok, true)
    assert.equal(db.preorderCampaigns.find((c) => c.id === ok.campaign.id).shipTo, '2026-12-23')
  })
  t('2B: แคมเปญที่เปิดรับแล้ว เปลี่ยนโปรส่วนลดไม่ได้ แต่เปลี่ยนชื่อได้', () => {
    const r = P.savePreorderCampaign({ ...base(), name: 'โปร', deals: [] })
    assert.equal(P.setPreorderCampaignStatus(r.campaign.id, 'open').ok, true)
    const deal = { kind: 'spend_off', name: 'ลด', tiers: [{ min: 500, type: 'amount', value: 50 }] }
    assert.match(P.savePreorderCampaign({ ...r.campaign, deals: [deal] }).error, /ปิดรับก่อน/)
    assert.equal(P.savePreorderCampaign({ ...r.campaign, name: 'โปร (ชื่อใหม่)' }).ok, true)
    assert.equal(P.setPreorderCampaignStatus(r.campaign.id, 'closed').ok, true)
  })
  t('ผู้ใช้ที่ไม่มีสิทธิ์ บันทึก/เปลี่ยนสถานะไม่ได้ และข้อมูลไม่เปลี่ยน', () => {
    const n = before()
    session.role = 'sales'
    try {
      assert.match(P.savePreorderCampaign(base()).error, /ไม่มีสิทธิ์/)
    } finally { session.role = 'admin' }
    assert.equal(before(), n)
  })
  t('เปิดรับต้องผ่านการตรวจ และเปลี่ยนสถานะได้', () => {
    const r = P.savePreorderCampaign({ ...base(), name: 'เปิดได้' })
    assert.equal(P.setPreorderCampaignStatus(r.campaign.id, 'open').ok, true)
    assert.equal(db.preorderCampaigns.find((c) => c.id === r.campaign.id).status, 'open')
    assert.equal(P.setPreorderCampaignStatus(r.campaign.id, 'closed').ok, true)
    assert.equal(P.setPreorderCampaignStatus('ไม่มีรหัสนี้', 'open').error, 'ไม่พบแคมเปญ')
  })
  for (const [name, fn] of cases) {
    try { fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
} catch (e) {
  fails++
  console.log('FAIL โหลดโมดูลไม่สำเร็จ:', e.message)
} finally {
  await server.close()
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
