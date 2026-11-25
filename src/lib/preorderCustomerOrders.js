// ออร์เดอร์สั่งล่วงหน้าที่ยังไม่ปิดของลูกค้า (ฟังก์ชันล้วน) · ใช้ในแชทและ Edge Function customerOrders
// ไม่ถือว่าเป็นออร์เดอร์ค้างเมื่อยกเลิก หมดเวลา หรือส่งมอบแล้ว · เรียงตามกำหนดชำระ (ไม่มีกำหนดอยู่ท้าย)

const CLOSED = ['cancelled', 'expired', 'delivered']

// คืนเฉพาะฟิลด์ที่ใช้แสดง: id รหัส สถานะ วันรับ ยอดค้าง และกำหนดชำระ
export function openPreorders(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r && !CLOSED.includes(r.status))
    .map((r) => ({
      id: String(r.id ?? ''),
      code: String(r.code ?? ''),
      status: String(r.status ?? ''),
      pickupDate: r.pickupDate ?? null,
      due: Math.max(0, (Number(r.total) || 0) - (Number(r.paid) || 0)),
      payDueAt: r.payDueAt ?? null,
    }))
    .sort((a, b) => {
      if (!a.payDueAt && !b.payDueAt) return a.code.localeCompare(b.code)
      if (!a.payDueAt) return 1
      if (!b.payDueAt) return -1
      return a.payDueAt.localeCompare(b.payDueAt) || a.code.localeCompare(b.code)
    })
}
