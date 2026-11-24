// แจ้งทีม "งานใกล้เวลาต้องเสร็จ" เฉพาะออร์เดอร์ที่ร้านยืนยันการสั่งซื้อแล้ว (ฟังก์ชันล้วน · ใช้ร่วมกับเซิร์ฟเวอร์)
// ไม่แจ้งออร์เดอร์ที่ยังรอชำระ แจ้งยอด ยืนยันชำระ ร่าง ส่งมอบแล้ว หรือยกเลิก
export const DUE_SOON_STATUSES = ['order_confirmed', 'preparing', 'prepared', 'ready_to_ship', 'shipping']
export const isDueSoonEligible = (o) => DUE_SOON_STATUSES.includes(o?.status)
