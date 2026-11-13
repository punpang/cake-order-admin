// แผนการส่งข้อความถึงลูกค้า (ฟังก์ชันล้วน ทดสอบได้)
// ส่งทุกช่องทางที่ลูกค้ามี: ต้องถูกอนุญาต (กฎ/ออร์เดอร์/ลูกค้า) + ช่องทางเปิดใช้งาน + มีข้อมูลติดต่อ
// SMS ข้ามได้เมื่อพนักงานเลือกไม่ส่ง SMS (noSms) · ข้อความการตลาดยังส่งช่องแรกช่องเดียว (ตามเดิม)
export function customerTargets({ order = [], allowed = {}, integrations = {}, addressOf = () => '', noSms = false, marketing = false } = {}) {
  const list = order.filter((k) => allowed[k] && integrations[k]?.enabled && addressOf(k) && !(k === 'sms' && noSms))
  return marketing ? list.slice(0, 1) : list
}
