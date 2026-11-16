// ประชาสัมพันธ์/โปรโมชั่นถึงลูกค้าเว็บ/แอป (ฟังก์ชันล้วน · ใช้ร่วมกับฝั่งเซิร์ฟเวอร์ผ่าน schedlib)
export const CAMPAIGN_TYPES = { announce: 'ประชาสัมพันธ์', promo: 'โปรโมชั่น', ad: 'โฆษณา' }
export const CAMPAIGN_LIMITS = { title: 80, body: 500 }
// บรรทัดท้ายข้อความทุกฉบับ: บอกวิธีปิดรับข่าวสาร (ตามหลัก PDPA)
export const CAMPAIGN_FOOTER = 'ปิดรับข่าวสารได้ที่ บัญชี › รับข่าวสารและโปรโมชัน'

const isHttps = (u) => /^https:\/\/\S+$/i.test(String(u || ''))

// ตรวจข้อมูลแคมเปญ · คืน { ok: true, value } หรือ { ok: false, error }
export function validateCampaign(input = {}) {
  const type = String(input.type || '')
  if (!CAMPAIGN_TYPES[type]) return { ok: false, error: 'เลือกประเภทให้ถูกต้อง' }
  const title = String(input.title ?? '').trim()
  if (!title) return { ok: false, error: 'กรอกหัวข้อ' }
  if (title.length > CAMPAIGN_LIMITS.title) return { ok: false, error: `หัวข้อยาวเกิน ${CAMPAIGN_LIMITS.title} ตัวอักษร` }
  const body = String(input.body ?? '').trim()
  if (!body) return { ok: false, error: 'กรอกข้อความ' }
  if (body.length > CAMPAIGN_LIMITS.body) return { ok: false, error: `ข้อความยาวเกิน ${CAMPAIGN_LIMITS.body} ตัวอักษร` }
  const image = String(input.image ?? '').trim()
  if (image && !isHttps(image)) return { ok: false, error: 'ลิงก์รูปต้องขึ้นต้นด้วย https://' }
  const url = String(input.url ?? '').trim()
  if (url && !isHttps(url)) return { ok: false, error: 'ลิงก์ปุ่มต้องขึ้นต้นด้วย https://' }
  const scheduledAt = input.scheduledAt ? String(input.scheduledAt) : ''
  if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) return { ok: false, error: 'เวลาส่งไม่ถูกต้อง' }
  return { ok: true, value: { type, title, body, image, url, scheduledAt: scheduledAt || null } }
}

// ข้อความที่ลูกค้าเห็นในแชท: เนื้อหา + บรรทัดวิธีปิดรับข่าวสาร
export const campaignMessageText = (c) => `${c.body}\n\n${CAMPAIGN_FOOTER}`

// การ์ดในแชท: ชนิดการ์ด = ประเภทแคมเปญ (ลิงก์รูป/ปุ่มต้องเป็น https · ฝั่งเซิร์ฟเวอร์กรองซ้ำอีกชั้น)
export const campaignCard = (c) => ({ kind: c.type, title: c.title, subtitle: '', image: c.image || '', url: c.url || '' })

// ลูกค้าที่มีสิทธิ์รับ: มีบัญชีเว็บ + เปิดรับเอง (มีเวลายินยอม) + ไม่ถูกปิด/ลบ
export function isCampaignEligible(customer, hasWebAccount) {
  if (!hasWebAccount || !customer) return false
  if (customer.promoOptIn !== true) return false
  if (typeof customer.promoConsentAt !== 'string' || !customer.promoConsentAt) return false
  if (customer.deleted === true || customer.active === false) return false
  return true
}
