// จับคู่การโอนเข้า QR ของหน้า POS · ฟังก์ชันล้วน (ไม่แตะหน้าจอหรือฐานข้อมูล) เพื่อทดสอบได้
// - รหัส QR ของรายการ = รหัสปัจจุบัน + รหัสเดิมที่เคยออก (ลูกค้าอาจจ่ายด้วย QR เดิมหลังยกเลิกหรือสร้างใหม่แล้ว)
// - QR ที่ยกเลิกแล้วไม่กันยอดในบิล (รับด้วยวิธีอื่นได้) แต่ยังเฝ้าการโอนเข้ารหัสเดิมจนปิดหน้าชำระ
// - ผูกเข้าบิลได้เฉพาะเมื่อยอดไม่เกินยอดคงเหลือ · ถ้าบิลรับครบแล้วจากวิธีอื่น ไม่ผูกเอง ให้พนักงานตัดสิน

// รหัส QR ทั้งหมดของรายการ (ไม่ซ้ำ ไม่เอาค่าว่าง)
export const watchRefs = (l) => [...new Set([l.qrRef, ...(l.prevRefs || [])].filter(Boolean))]

// ยอดที่รายการนี้กันไว้ในบิล: QR ที่ยกเลิกแล้วไม่กัน
export const reservedOf = (l, amount) => (l.status === 'cancelled' ? 0 : amount)

// ต้องเฝ้าการโอนของรายการนี้หรือไม่
// - QR ที่ยกเลิกแล้วเฝ้าต่อ (ไม่สนหมดอายุ) จนปิดหน้าชำระ
// - QR ที่ยังใช้งานได้เฝ้าตามปกติ · หมดอายุแล้วไม่เฝ้า · ยืนยันหรือพบการโอนแล้วไม่เฝ้า
export const isWatched = (l, expired) =>
  l.method === 'transfer' && !l.confirmed && !l.detectedAt && (l.status === 'cancelled' || (!!l.qrRef && !expired))

// ผูกยอดนี้เข้าบิลได้ไหม: ยอดต้องไม่เกินยอดคงเหลือ (remaining ไม่รวมยอดที่รายการนี้กันไว้เอง)
export const canBindLine = (amount, remaining, reserved) => amount <= remaining + reserved + 0.005

// ข้อมูลที่ผูกเข้ารายการเมื่อพบการโอนของรหัส ref · รหัสนี้คือรหัสที่ลูกค้าจ่ายจริง จึงใช้บันทึกการชำระ
export const adoptPatch = (l, ref, row, now = Date.now()) => ({
  prevRefs: watchRefs(l).filter((r) => r !== ref),
  qrRef: ref,
  status: 'waiting',
  detectedAt: now,
  maneeId: row.id,
  candidates: [],
  lateNotice: [],
  searched: false,
})

// ตัดรายการที่พนักงานเคยปิดการแจ้งเตือนหรือยกเลิกไปแล้ว ไม่ให้กลับมาพบซ้ำ
export const notDismissed = (rows, dismissed = []) => rows.filter((r) => !dismissed.includes(r.id))
