-- ลบตาราง punpang_points (ตารางแต้มขนานจากขั้นที่ 1 ที่แอปไม่ได้ใช้แล้ว · แต้มจริงอยู่ใน punpang_customers.data.ledger)
-- ฟังก์ชัน punpang_points_* ที่อ้างตารางนี้ถูกปิดสิทธิ์เรียกแล้ว (migration 20261110171801) และไม่มีโค้ดแอปเรียกใช้
drop table if exists public.punpang_points cascade;
