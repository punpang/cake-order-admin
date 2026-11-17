// ผู้รับที่ส่งจริงได้ในโหมดทดสอบ: เติมรายการจากลูกค้าจริงที่มีอยู่ (ฟังก์ชันล้วน · ทดสอบได้)
// ให้ตรงกับเซิร์ฟเวอร์ (supabase/functions/_shared/mode.ts): SMS เทียบเบอร์หลังตัดช่องว่าง/ขีด · Facebook เทียบ PSID ตรง ๆ
// Telegram ไม่ได้ผูกกับลูกค้า (เป็นกลุ่มทีม) จึงยังให้พิมพ์รหัสเอง
import { phoneDigits, phoneValid } from './format.js'

export const RECIPIENT_CHANNEL_LABEL = { sms: 'SMS', facebook: 'Facebook', telegram: 'Telegram' }
const PSID = /^\d{5,30}$/

// ช่องทางที่ลูกค้าคนนี้ส่งทดสอบได้: เบอร์ที่ใช้ได้ → SMS · PSID ที่เป็นตัวเลข → Facebook (ไม่มีข้อมูลช่องไหนก็ไม่คืนแถวนั้น)
export function recipientsOfCustomer(c) {
  if (!c) return []
  const name = String(c.name ?? '').trim()
  const out = []
  const phone = phoneDigits(c.phone)
  if (phoneValid(phone)) out.push({ channel: 'sms', to: phone, name })
  const psid = String(c.fbPsid ?? '').trim()
  if (PSID.test(psid)) out.push({ channel: 'facebook', to: psid, name })
  return out
}

// กุญแจเทียบซ้ำ: ตรงกับการเทียบของเซิร์ฟเวอร์ (SMS ตัดช่องว่างและขีดก่อนเทียบ)
const keyOf = (r) => {
  const to = String(r?.to ?? '').trim()
  return `${r?.channel}|${r?.channel === 'sms' ? to.replace(/[\s-]/g, '') : to}`
}

// เพิ่มผู้รับลงรายการ โดยไม่ซ้ำช่องทางเดียวกัน · คืนรายการใหม่ (ไม่แก้รายการเดิม) และจำนวนที่เพิ่มจริง
export function addRecipients(list, rows) {
  const seen = new Set(list.map(keyOf))
  const fresh = []
  for (const r of rows) {
    const k = keyOf(r)
    if (seen.has(k)) continue
    seen.add(k)
    fresh.push(r)
  }
  return { list: [...list, ...fresh], added: fresh.length }
}
