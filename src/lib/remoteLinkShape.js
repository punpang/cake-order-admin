// ข้อมูลลิงก์ออร์เดอร์จากเซิร์ฟเวอร์ (order-link) ไม่มี tokenHash เพราะเซิร์ฟเวอร์ไม่ส่งให้ผู้เรียก
// → ใส่ hash ของโทเค็นที่ลูกค้าเปิดเอง ให้ openOrderLink หาลิงก์เจอ · ไม่แก้อ็อบเจกต์เดิม
// แยกเป็นไฟล์ของตัวเอง เพราะ orderLink.js ถูกคัดลอกไปฝั่ง Edge Function (schedlib) ต้องคงเดิม
import { hashToken } from './orderLink.js'

export function shapeRemoteLink(data, token) {
  if (!data?.order) return { error: null }
  return { ...data, link: data.link ? { ...data.link, tokenHash: hashToken(token) } : data.link }
}
