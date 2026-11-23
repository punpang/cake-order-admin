// สิทธิวันเกิดสมาชิก (ส่วนลดหมวดเค้ก) — กติกาเดียวกับเซิร์ฟเวอร์ (punpang__member_birth_view)
// LV3 5% (สูงสุด 25 บาท) · LV4 10% (สูงสุด 50 บาท) · ใช้กับหมวดที่ร้านเลือกเองเท่านั้น
// ไม่ซ้อนคูปอง: เลือกส่วนลดที่ได้มากกว่า
const r2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100

// birth = ค่า birth จาก punpang_member_card / staff card · cakeCategories = หมวดที่ร้านนับเป็นเค้ก · cakeItemIds = สินค้าที่ร้านเลือกเอง (นับเพิ่มจากหมวด)
// items: { id (รหัสสินค้า retail), category, unitPrice, qty }
export function birthCakeDiscount({ items = [], cakeCategories = [], cakeItemIds = [], birth = null }) {
  const rate = Number(birth?.rate) || 0
  const cap = Number(birth?.cap) || 0
  if (!birth?.eligible || !birth?.active || rate <= 0 || cap <= 0) return { amount: 0, base: 0 }
  const cats = new Set(cakeCategories)
  const ids = new Set(cakeItemIds)
  const isCake = (i) => cats.has(i.category) || (!!i.id && ids.has(i.id))
  const base = r2(items.reduce((s, i) => (isCake(i) ? s + (Number(i.unitPrice) || 0) * (Number(i.qty) || 0) : s), 0))
  return { amount: Math.min(r2((base * rate) / 100), cap), base }
}

// เลือกระหว่างส่วนลดเดือนเกิดกับคูปองที่ใช้ในบิล (ไม่ซ้อน) · เท่ากันให้คูปองเดิม
export function pickBirthOrCoupons(birthAmount, couponTotal) {
  return birthAmount > (Number(couponTotal) || 0) && birthAmount > 0 ? 'birth' : 'coupons'
}
