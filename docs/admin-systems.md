# ระบบหลังบ้าน 4 ระบบ (รอบ AM)

แอปเดียว แยกเมนู+ลิงก์เป็น 4 ระบบ · ตาราง/ตัวตรวจอยู่ที่ `src/lib/adminSystems.js` (ฟังก์ชันล้วน) · ไม่เพิ่มสิทธิ์ใหม่ (ใช้สิทธิ์เดิมกำหนดว่าเห็นระบบ/เมนูไหน)

| ระบบ | หน้า | เห็นเมื่อมีสิทธิ์ |
|---|---|---|
| ออร์เดอร์ | `/admin/orders` · `/orders/new` · `/orders/:id` · `/payments` · `/chat` · `/materials` (ครัว) · `/production` | ข้อใดข้อหนึ่งของเมนูย่อย (viewAllOrders/viewPrepOrders/viewDeliveryOrders/createOrder/chat/reportPayment/confirmPayment/viewMaterials) |
| POS | `/admin/pos` | `pos` |
| บัญชี | `/admin/accounting` | `acctView` |
| ตั้งค่า | `/admin/settings` และ `/admin/settings/*` | `manage` หรือ `manageUsers` |

- ลิงก์เก่า `/admin/manage*` และ `/manage*` redirect ไป `/admin/settings*` · `/admin` ไปหน้าแรกของระบบแรกที่มีสิทธิ์ (`firstHome`)
- แถบบน (สูง 56px แถวเดียว): โลโก้ · ตัวสลับระบบ (`components/SystemSwitcher.vue`: ≥ xl เป็นป้ายครบทุกระบบ, ต่ำกว่านั้นเป็นปุ่มเดียว+เมนูเลือก, ซ่อนถ้าเห็นระบบเดียว) · เมนูย่อยของระบบปัจจุบัน (md+, เมื่อมี ≥ 2 รายการ) · หน้าร้าน · กระดิ่ง · ผู้ใช้ (ชื่อแสดงเมื่อ ≥ lg)
- เมนูล่างมือถือ: เฉพาะระบบออร์เดอร์ (ออร์เดอร์/แชท/ชำระเงิน/ครัว) · POS/บัญชี/ตั้งค่ามีหน้าเดียว จึงไม่มีเมนูล่าง
- หน้าตั้งค่าไม่มีการ์ด "บัญชี" แล้ว (ย้ายเป็นระบบของตัวเอง)
