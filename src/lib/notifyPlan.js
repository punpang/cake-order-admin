// แผนการส่งข้อความถึงลูกค้า (ฟังก์ชันล้วน ทดสอบได้)
// ส่งทุกช่องทางที่ลูกค้ามี: ต้องถูกอนุญาต (กฎ/ออร์เดอร์/ลูกค้า) + ช่องทางเปิดใช้งาน + มีข้อมูลติดต่อ
// SMS ข้ามได้เมื่อพนักงานเลือกไม่ส่ง SMS (noSms) · ข้อความการตลาดยังส่งช่องแรกช่องเดียว (ตามเดิม)
export function customerTargets({ order = [], allowed = {}, integrations = {}, addressOf = () => '', noSms = false, marketing = false } = {}) {
  const list = order.filter((k) => allowed[k] && integrations[k]?.enabled && addressOf(k) && !(k === 'sms' && noSms))
  return marketing ? list.slice(0, 1) : list
}

// สรุปยอดประจำวันสำหรับทีม (Telegram HTML) · ค่าที่ต้องมี: ร้าน วันที่ บิล ยกเลิก ช่องทาง ยอดสุทธิ เงินสดคาด เงินสดนับได้ ส่วนต่าง ปิดกะโดย
export const DAILY_SUMMARY_TPL = [
  '📊 <b>สรุปยอดประจำวัน {ร้าน}</b>',
  '━━━━━━━━━━━━━━',
  '📅 {วันที่} · ปิดกะโดย {ปิดกะโดย}',
  '🧾 บิล {บิล} ใบ · ยกเลิก {ยกเลิก} ใบ',
  '{ช่องทาง}',
  '💰 ยอดสุทธิ <b>{ยอดสุทธิ}</b>',
  '💵 เงินสดควรมี {เงินสดคาด} · นับได้ {เงินสดนับได้} · ส่วนต่าง {ส่วนต่าง}',
].join('\n')

// กฎของการเปลี่ยนแปลงที่เพิ่มภายหลัง (เปลี่ยนวันนัด/แก้ข้อมูลจัดส่ง/ใช้คูปองในออร์เดอร์ที่มีอยู่)
export const NEW_CUSTOMER_RULES = [
  { event: 'pickup_changed', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} เปลี่ยนวันนัดเป็น {วันนัด} เวลา {เวลานัด} แล้วค่ะ', enabled: true },
  { event: 'delivery_changed', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} มีการแก้ไขข้อมูลจัดส่งแล้วค่ะ\n{บรรทัดที่อยู่}\n{บรรทัดค่าส่ง}', enabled: true },
  { event: 'coupon_applied', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ใช้คูปองแล้วค่ะ ยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  { event: 'payment_request_changed', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} แก้ยอดที่แจ้งชำระเป็น {ยอดที่แจ้ง} แล้วค่ะ ชำระก่อน {ชำระก่อน}', enabled: true },
  { event: 'payment_request_cancelled', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ยกเลิกยอดที่แจ้งชำระ {ยอดที่แจ้ง} แล้วค่ะ\nเหตุผล: {เหตุผล}\nกรุณาแจ้งชำระยอดใหม่ค่ะ', enabled: true },
  { event: 'payment_cancelled', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ยกเลิกยอดที่ชำระ {ยอดที่ชำระ} แล้วค่ะ ยอดคงค้าง {คงค้าง}', enabled: true },
  { event: 'pay_extension_granted', channels: ['web', 'sms'], template: 'ร้านอนุมัติขยายเวลาชำระออร์เดอร์ {เลขออร์เดอร์} ให้ชำระภายใน {ชำระก่อน} ค่ะ', enabled: true },
  { event: 'pay_extension_denied', channels: ['web', 'sms'], template: 'ร้านยังไม่อนุมัติขยายเวลาชำระออร์เดอร์ {เลขออร์เดอร์} กรุณาชำระภายในกำหนดเดิม {ชำระก่อน} ค่ะ', enabled: true },
  { event: 'items_changed', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} มีการแก้ไขรายการสินค้าแล้วค่ะ\n{รายการสินค้า}\nยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  { event: 'adjustment_changed', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} มีการปรับราคาแล้วค่ะ ยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  { event: 'preparing', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} เริ่มเตรียมสินค้าแล้วค่ะ', enabled: true },
  { event: 'ready_to_ship', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} พร้อมจัดส่งแล้วค่ะ', enabled: true },
  { event: 'points_applied', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ใช้คะแนนสะสม {คะแนน} คะแนนเป็นส่วนลด {ส่วนลดคะแนน} แล้วค่ะ ยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  { event: 'points_removed', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ยกเลิกการใช้คะแนนสะสม {คะแนน} คะแนนแล้วค่ะ ยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  // ส่งจากเซิร์ฟเวอร์ (customer-order) เฉพาะ Facebook · ข้อความต้องตรงกับ SLIP_RECEIVED_TPL ใน supabase/functions/_shared/slipnotice.ts
  { event: 'slip_received', channels: ['facebook'], template: 'ร้านได้รับสลิปการชำระเงินของออร์เดอร์ {เลขออร์เดอร์} ยอด {ยอดที่แจ้ง} บาทแล้วค่ะ ร้านจะตรวจสอบและยืนยันให้เร็ว ๆ นี้ ขอบคุณค่ะ', enabled: true },
  { event: 'slip_cancelled', channels: ['web', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ร้านยกเลิกสลิปที่ส่งมาแล้วค่ะ\nเหตุผล: {เหตุผล}\nกรุณาส่งสลิปใหม่หรือแจ้งชำระใหม่ค่ะ', enabled: true },
]
// เติมกฎที่ยังไม่มีในรายการ (กฎที่ร้านแก้ไว้แล้วไม่ถูกทับ) · คืนรายการใหม่ ไม่แก้รายการเดิม
// กฎของทีมที่เพิ่มภายหลัง (ส่งเข้ากลุ่มทีม ไม่ใช่ลูกค้า) · สรุปยอดหลังปิดกะ POS · ตัวแปรมาจาก src/lib/dailySummary.js
export const NEW_TEAM_RULES = [
  { event: 'team_daily_summary', channels: ['telegram'], template: DAILY_SUMMARY_TPL, enabled: true },
]

export function withNewRules(list) {
  const have = new Set((list || []).map((r) => r.event))
  return [...(list || []), ...[...NEW_CUSTOMER_RULES, ...NEW_TEAM_RULES].filter((r) => !have.has(r.event)).map((r) => ({ ...r, channels: [...r.channels] }))]
}
// รุ่นกติกาช่องทางลูกค้า 2: เว็บ/แอปเป็นช่องทางหลักของทุกออเดอร์ · Facebook ไม่อยู่ในค่าเริ่มต้นแล้ว (ร้านเปิดเลือกเองได้)
export const CHANNEL_RULE_VERSION = 2
// กฎที่ยังคง Facebook ไว้ (slip_received ตอบกลับสลิปใน Messenger)
const KEEP_FACEBOOK_EVENTS = ['slip_received']
// กฎที่ยังไม่เป็นรุ่นปัจจุบัน → Facebook เปลี่ยนเป็นเว็บ/แอป (ช่องอื่นคงเดิม) · กฎรุ่นปัจจุบันไม่ถูกแก้
export function upgradeRules(list) {
  return (list || []).map((r) => {
    if (!r || r.chv === CHANNEL_RULE_VERSION) return r
    const channels = Array.isArray(r.channels) ? r.channels : []
    const next = KEEP_FACEBOOK_EVENTS.includes(r.event) ? channels : [...new Set(channels.map((c) => (c === 'facebook' ? 'web' : c)))]
    return { ...r, channels: next, chv: CHANNEL_RULE_VERSION }
  })
}
// เติมกฎที่ขาด + ปรับเป็นรุ่นปัจจุบัน · ใช้ทุกครั้งที่อ่านกติกาจากฐานข้อมูล (แอปและเซิร์ฟเวอร์)
export const prepareRules = (list) => upgradeRules(withNewRules(list))
