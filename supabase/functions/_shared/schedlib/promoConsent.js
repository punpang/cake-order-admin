// ความยินยอมรับข่าวสารโปรโมชันของลูกค้า (ฟังก์ชันล้วน · ใช้ร่วมกับ customer-auth ผ่าน schedlib)
// ลูกค้าต้องกดเปิดรับเองในหน้าบัญชี ระบบจึงบันทึกเวลาที่ยินยอม
// ร้านตั้งค่าให้เอง หรือข้อมูลเดิมที่เปิดอยู่แต่ไม่มีเวลายินยอม = ยังไม่นับ จนกว่าลูกค้าจะปิดแล้วเปิดใหม่เอง
// คืนข้อมูลลูกค้าชุดใหม่ (ไม่แก้ของเดิม) · ฟิลด์อื่นคงเดิม
export function promoConsentPatch(prev, promoOptIn, nowIso) {
  const base = { ...(prev || {}) }
  delete base.promoConsentAt
  if (promoOptIn !== true) return { ...base, promoOptIn: false } // ปิดรับ → ล้างเวลายินยอม
  if (prev?.promoOptIn !== true) return { ...base, promoOptIn: true, promoConsentAt: nowIso } // เพิ่งเปิดเอง
  if (typeof prev.promoConsentAt === 'string' && prev.promoConsentAt) return { ...base, promoOptIn: true, promoConsentAt: prev.promoConsentAt } // เปิดอยู่แล้ว คงเวลาเดิม
  return { ...base, promoOptIn: true } // เปิดอยู่แต่ไม่มีเวลายินยอม (ข้อมูลเดิม)
}
