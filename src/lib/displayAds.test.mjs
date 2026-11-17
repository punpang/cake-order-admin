// ทดสอบสื่อโฆษณาบนจอลูกค้า · รัน: node src/lib/displayAds.test.mjs
import assert from 'node:assert/strict'
import { normalizeDisplayAds, adsForDisplay, nextAdIndex, videoFileError, MAX_AD_ITEMS, DEFAULT_AD_SECONDS } from './displayAds.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const IMG = 'https://files.example.com/p/storefront/a.jpg'
const VID = 'https://files.example.com/p/displayAds/b.mp4'

t('ค่าว่าง/ไม่ใช่วัตถุ → ปิดอยู่ ไม่มีสื่อ เวลาเริ่มต้น', () => {
  assert.deepEqual(normalizeDisplayAds(undefined), { enabled: false, seconds: DEFAULT_AD_SECONDS, items: [] })
  assert.deepEqual(normalizeDisplayAds('x'), { enabled: false, seconds: DEFAULT_AD_SECONDS, items: [] })
})
t('เก็บเฉพาะรูป/วิดีโอที่ลิงก์ใช้ได้ · วิดีโอต้องเป็นลิงก์ http(s) · รูปในเครื่อง (data:image) ยังไม่อัปโหลดเก็บได้', () => {
  const a = normalizeDisplayAds({ enabled: true, seconds: 10, items: [
    { type: 'image', url: IMG }, { type: 'video', url: VID }, { type: 'video', url: 'data:video/mp4;base64,AAAA' },
    { type: 'image', url: 'data:image/png;base64,iVBOR' }, { type: 'image', url: 'javascript:alert(1)' }, { type: 'image', url: '' }, null,
  ] })
  assert.equal(a.enabled, true)
  assert.equal(a.seconds, 10)
  assert.deepEqual(a.items.map((x) => x.type + ':' + x.url.slice(0, 10)), ['image:https://fi', 'video:https://fi', 'image:data:image'])
})
t('เวลาที่ไม่อยู่ในตัวเลือก → ใช้ค่าเริ่มต้น · จำนวนสื่อไม่เกินที่กำหนด', () => {
  assert.equal(normalizeDisplayAds({ seconds: 3 }).seconds, DEFAULT_AD_SECONDS)
  const many = Array.from({ length: 15 }, (_, i) => ({ type: 'image', url: `${IMG}?${i}` }))
  assert.equal(normalizeDisplayAds({ items: many }).items.length, MAX_AD_ITEMS)
})
t('ส่งให้จอ: ต้องเปิดใช้และมีสื่อ ไม่อย่างนั้น null', () => {
  assert.equal(adsForDisplay({ enabled: false, items: [{ type: 'image', url: IMG }] }), null)
  assert.equal(adsForDisplay({ enabled: true, items: [] }), null)
  assert.deepEqual(adsForDisplay({ enabled: true, seconds: 5, items: [{ type: 'image', url: IMG }] }), { seconds: 5, items: [{ type: 'image', url: IMG }] })
})
t('ลำดับถัดไป: วนกลับต้น · ข้ามรายการที่โหลดไม่ได้ · เล่นไม่ได้เลย = -1', () => {
  assert.equal(nextAdIndex(0, 3), 1)
  assert.equal(nextAdIndex(2, 3), 0)
  assert.equal(nextAdIndex(0, 3, new Set([1])), 2)
  assert.equal(nextAdIndex(0, 1), 0)
  assert.equal(nextAdIndex(0, 2, new Set([0, 1])), -1)
})
t('ตรวจไฟล์วิดีโอ: ชนิดและขนาด', () => {
  assert.equal(videoFileError({ type: 'video/mp4', size: 1024 }), '')
  assert.match(videoFileError({ type: 'video/quicktime', size: 1024 }), /MP4/)
  assert.match(videoFileError({ type: 'video/webm', size: 31 * 1024 * 1024 }), /30 MB/)
})

process.exitCode = fail ? 1 : 0
