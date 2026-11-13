// กล่องติ๊ก "แจ้งลูกค้า" / "ส่ง SMS ด้วย" ของยืนยัน (askConfirmEx) สำหรับการเปลี่ยนแปลงที่ส่งข้อความถึงลูกค้า
// ค่าเริ่มต้นติ๊ก · ไม่มีลูกค้า = ไม่มีกล่อง (ฟังก์ชันในสโตร์จะถือว่าแจ้งตามปกติ)
import { smsChoice } from './smsChoice'
import { formatPhone } from './format'

export function notifyBoxOf(customer) {
  if (!customer) return {}
  return {
    checkbox: { label: 'แจ้งลูกค้า', hint: 'ไม่ติ๊ก = ไม่ส่งข้อความถึงลูกค้า', value: true },
    ...(smsChoice(customer) ? { checkbox2: { label: 'ส่ง SMS ด้วย', hint: formatPhone(customer.phone), value: true } } : {}),
  }
}

// ค่าที่ส่งให้ฟังก์ชันในสโตร์จากผลการยืนยัน (ไม่มีกล่อง = แจ้งตามปกติ)
export const notifyOf = (r) => ({ notify: r.checked !== false, sms: r.checked2 !== false })
