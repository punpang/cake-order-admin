// ความสดของข้อมูลที่ใช้ตอนยืนยันรับชำระอัตโนมัติ (POS)
// ระหว่างรอการโอน POS รีเฟรชสต็อก/กะล่วงหน้าทุก LABEL_REFRESH_EVERY_S วินาที · ตอนยืนยันอัตโนมัติ ถ้าโหลดไว้ไม่เกิน LABEL_MAX_AGE_MS ใช้ได้เลย ไม่ต้องโหลดก่อนบันทึก
export const LABEL_MAX_AGE_MS = 5000
export const LABEL_REFRESH_EVERY_S = 3 // ทุก 3 วินาที: อายุข้อมูลสูงสุดคือ 3 วินาทีบวกเวลาโหลด ซึ่งต้องไม่เกินเพดาน 5 วินาที
// ฟลาชรับชำระบนจอลูกค้า (มิลลิวินาที)
export const PAID_FLASH_MS = 2600

// at = เวลาที่โหลดล่าสุด (ms) · 0 = ยังไม่เคยโหลด · now < at (นาฬิกาไม่ตรง) ถือว่าไม่สด
export const labelsFresh = (at, now = Date.now(), maxAgeMs = LABEL_MAX_AGE_MS) => at > 0 && now >= at && now - at <= maxAgeMs
