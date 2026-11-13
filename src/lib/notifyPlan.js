// แผนการส่งข้อความถึงลูกค้า (ฟังก์ชันล้วน ทดสอบได้)
// ส่งทุกช่องทางที่ลูกค้ามี: ต้องถูกอนุญาต (กฎ/ออร์เดอร์/ลูกค้า) + ช่องทางเปิดใช้งาน + มีข้อมูลติดต่อ
// SMS ข้ามได้เมื่อพนักงานเลือกไม่ส่ง SMS (noSms) · ข้อความการตลาดยังส่งช่องแรกช่องเดียว (ตามเดิม)
export function customerTargets({ order = [], allowed = {}, integrations = {}, addressOf = () => '', noSms = false, marketing = false } = {}) {
  const list = order.filter((k) => allowed[k] && integrations[k]?.enabled && addressOf(k) && !(k === 'sms' && noSms))
  return marketing ? list.slice(0, 1) : list
}

// กฎของการเปลี่ยนแปลงที่เพิ่มภายหลัง (เปลี่ยนวันนัด/แก้ข้อมูลจัดส่ง/ใช้คูปองในออร์เดอร์ที่มีอยู่)
export const NEW_CUSTOMER_RULES = [
  { event: 'pickup_changed', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} เปลี่ยนวันนัดเป็น {วันนัด} เวลา {เวลานัด} แล้วค่ะ', enabled: true },
  { event: 'delivery_changed', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} มีการแก้ไขข้อมูลจัดส่งแล้วค่ะ\n{บรรทัดที่อยู่}\n{บรรทัดค่าส่ง}', enabled: true },
  { event: 'coupon_applied', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ใช้คูปองแล้วค่ะ ยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  { event: 'payment_request_changed', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} แก้ยอดที่แจ้งชำระเป็น {ยอดที่แจ้ง} แล้วค่ะ ชำระก่อน {ชำระก่อน}', enabled: true },
  { event: 'payment_request_cancelled', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ยกเลิกยอดที่แจ้งชำระ {ยอดที่แจ้ง} แล้วค่ะ', enabled: true },
  { event: 'payment_cancelled', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ยกเลิกยอดที่ชำระ {ยอดที่ชำระ} แล้วค่ะ ยอดคงค้าง {คงค้าง}', enabled: true },
  { event: 'pay_extension_granted', channels: ['line', 'facebook', 'sms'], template: 'ร้านอนุมัติขยายเวลาชำระออร์เดอร์ {เลขออร์เดอร์} ให้ชำระภายใน {ชำระก่อน} ค่ะ', enabled: true },
  { event: 'pay_extension_denied', channels: ['line', 'facebook', 'sms'], template: 'ร้านยังไม่อนุมัติขยายเวลาชำระออร์เดอร์ {เลขออร์เดอร์} กรุณาชำระภายในกำหนดเดิม {ชำระก่อน} ค่ะ', enabled: true },
  { event: 'items_changed', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} มีการแก้ไขรายการสินค้าแล้วค่ะ\n{รายการสินค้า}\nยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  { event: 'adjustment_changed', channels: ['line', 'facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} มีการปรับราคาแล้วค่ะ ยอดรวม {ยอดรวม} คงค้าง {คงค้าง}', enabled: true },
  // ส่งจากเซิร์ฟเวอร์ (customer-order) เฉพาะ Facebook · ข้อความต้องตรงกับ SLIP_RECEIVED_TPL ใน supabase/functions/_shared/slipnotice.ts
  { event: 'slip_received', channels: ['facebook'], template: 'ร้านได้รับสลิปการชำระเงินของออร์เดอร์ {เลขออร์เดอร์} ยอด {ยอดที่แจ้ง} บาทแล้วค่ะ ร้านจะตรวจสอบและยืนยันให้เร็ว ๆ นี้ ขอบคุณค่ะ', enabled: true },
]
// เติมกฎที่ยังไม่มีในรายการ (กฎที่ร้านแก้ไว้แล้วไม่ถูกทับ) · คืนรายการใหม่ ไม่แก้รายการเดิม
export function withNewRules(list) {
  const have = new Set((list || []).map((r) => r.event))
  return [...(list || []), ...NEW_CUSTOMER_RULES.filter((r) => !have.has(r.event)).map((r) => ({ ...r, channels: [...r.channels] }))]
}
