// แอปร้าน (Android) ติดตั้งเฉพาะบนเครื่อง POS → ล็อกแนวนอนเท่านั้น (ขนาดจอขั้นต่ำที่ออกแบบ 1280×800)
// เว็บ /admin บนมือถือยังใช้งานได้ตามเดิม (ไม่ลบเลย์เอาต์มือถือ) · แอปลูกค้า (customer) แยกต่างหาก ไม่เกี่ยว
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = readFileSync(join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

// ตัด tag ของ MainActivity ทั้งก้อนมาตรวจ
const activity = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/s.exec(manifest)?.[0] || ''

t('พบ MainActivity ใน AndroidManifest', () => assert.ok(activity, 'ไม่พบ MainActivity'))

t('MainActivity ล็อกแนวนอน (sensorLandscape: กลับหัวได้ ไม่หมุนเป็นแนวตั้ง)', () => {
  assert.match(activity, /android:screenOrientation="sensorLandscape"/)
})

t('ไม่มีแอตทริบิวต์ที่เปิดแนวตั้งกลับมา', () => {
  assert.doesNotMatch(activity, /screenOrientation="(?:portrait|sensorPortrait|reversePortrait|userPortrait|unspecified|fullSensor|sensor|user|fullUser|behind|nosensor)"/)
})

console.log(`ผ่าน ${pass} การทดสอบ`)
