// แถวของตัวเลือกช่องทางแจ้งเตือนรายออร์เดอร์/รายลูกค้า (ฟังก์ชันล้วน · ทดสอบได้)
// เว็บ/แอป: แสดงเสมอเมื่อมีลูกค้า (ส่งจริงเฉพาะลูกค้าที่มีบัญชีเว็บ/แอป)
// Facebook/SMS: แสดงเฉพาะเมื่อลูกค้ามีข้อมูลติดต่อช่องนั้น
import { channelLabel } from './constants.js'

export const PICKER_CHANNELS = ['web', 'facebook', 'sms']

const hasAddress = (k, customer) => {
  if (k === 'web') return true
  if (k === 'facebook') return !!String(customer.fbPsid || '').trim()
  if (k === 'sms') return !!String(customer.phone || '').trim()
  return false
}

// model = notifyChannels { web?, facebook?, sms? } · คืนแถว { k, label, v (true/false/null = ตามเดิม), hint }
export function pickerRows(model = {}, customer = null) {
  if (!customer) return []
  return PICKER_CHANNELS.filter((k) => hasAddress(k, customer)).map((k) => ({
    k,
    label: channelLabel(k),
    v: typeof model?.[k] === 'boolean' ? model[k] : null,
    hint: k === 'web' ? 'ใช้เมื่อลูกค้ามีบัญชีเว็บ/แอป' : '',
  }))
}
