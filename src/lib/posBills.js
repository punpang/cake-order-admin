// บิล POS ที่ปิดแล้วย้อนหลัง (หน้า /admin/pos/bills) · ฟังก์ชันล้วน ไม่แตะฐานข้อมูล
// ปิดแล้ว = บิลหน้าร้านที่ไม่ใช่บิลค้างชำระ (pos_pending) · บิลที่ยกเลิกยังแสดง แต่หน้าเรียกไม่นับยอด

export const isClosedPosBill = (o) => !!o && o.channel === 'pos' && o.status !== 'pos_pending'

// วันที่ขายของบิลหน้าร้าน (YYYY-MM-DD) ใช้ pickupAt ก่อน เพราะเป็นเวลาท้องถิ่นและตรงกับตัวกรองฐานข้อมูล
export const posBillDay = (o) => String(o?.pickupAt || o?.createdAt || '').slice(0, 10)

// บิลปิดแล้วในช่วงวันที่ (รวมทั้งสองวัน) · ว่าง = ไม่จำกัด · เรียงจากใหม่สุดไปเก่าสุด
export function closedPosBillsInRange(items, from = '', to = '') {
  return (items || [])
    .filter((o) => isClosedPosBill(o))
    .filter((o) => {
      const d = posBillDay(o)
      return (!from || d >= from) && (!to || d <= to)
    })
    .sort((a, b) => String(b.createdAt || b.pickupAt || '').localeCompare(String(a.createdAt || a.pickupAt || '')))
}
