// การแก้รายการบิลค้าง POS (ใช้ใน Pos.vue และ store · แยกไว้เพื่อทดสอบ)

// ตะกร้าที่ได้จากรายการในบิลค้าง:
// - โปรอาจแยกสินค้าชิ้นเดียวกันเป็นหลายรายการ (คนละราคา) → รวมกลับเป็นบรรทัดเดียวต่อสินค้า+ตัวเลือก
// - ของแถมจากโปรไม่ใส่ในตะกร้า เพราะระบบคิดใหม่เองจากสินค้าที่อยู่ในตะกร้า
// keyOf = ฟังก์ชันสร้างคีย์ของบรรทัดตะกร้า (ตรงกับที่หน้าขายใช้รวมบรรทัด)
export function cartOfBill(items = [], keyOf) {
  const out = []
  for (const it of items) {
    if (!it || it.promoGift) continue
    const qty = Number(it.qty) || 0
    if (!(qty > 0)) continue
    const line = { kind: 'retail', refId: it.retailId, qty, mods: (it.mods || []).map((m) => ({ groupId: m.groupId, optionId: m.optionId })) }
    const hit = out.find((l) => keyOf(l) === keyOf(line))
    if (hit) hit.qty += qty
    else out.push(line)
  }
  return out
}

// ยอดรวมหลังแก้ต้องไม่ต่ำกว่าที่รับไปแล้ว · คืนข้อความผิดพลาด หรือ '' เมื่อผ่าน
export function paidGuard(newTotal, paidNet) {
  if (newTotal + 0.005 >= paidNet) return ''
  return `ยอดรวมหลังแก้ (${newTotal.toFixed(2)} ฿) ต่ำกว่าที่รับไปแล้ว (${paidNet.toFixed(2)} ฿) · แก้ได้ไม่ต่ำกว่านี้`
}
