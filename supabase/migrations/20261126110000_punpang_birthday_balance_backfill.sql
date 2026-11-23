-- คำนวณยอดค้างของออร์เดอร์ที่มีส่วนลดเดือนเกิดใหม่ (ยอดบิลก่อนไฟล์นี้ไม่หักส่วนลดนี้ · ดู 20261126100000_punpang_hold_money.sql)
-- เฉพาะแถวที่ยอดค้างที่เก็บไว้ไม่ตรงสูตรปัจจุบัน · set data = data ให้ทริกเกอร์ zz_punpang_orders_balance คำนวณ balance ใหม่โดยไม่เปลี่ยนข้อมูลอื่น
-- ด่านที่ทำงานตอนแก้ไขไม่บล็อกการคำนวณนี้: ด่านรับเข้าวันเกิด (punpang_orders_insert_guard) ทำงานเฉพาะตอน insert · ด่านอื่นข้ามเมื่อ data และสถานะไม่เปลี่ยน
update public.punpang_orders set data = data
 where jsonb_typeof(data->'birthdayDiscount') = 'object'
   and balance is distinct from public.punpang__balance_of(data, fulfillment);
