// แปลงราคาของที่แลกเป็นคะแนน: ปัดขึ้นเสมอ (ร้านไม่ให้ของแลกคุ้มกว่าราคา) · ไม่ถูกต้องคืน 0
export function pointsForPrice(price, pointValue) {
  const p = Number(price)
  const v = Number(pointValue)
  if (!(p > 0) || !(v > 0)) return 0
  return Math.ceil(p / v - 1e-9)
}
