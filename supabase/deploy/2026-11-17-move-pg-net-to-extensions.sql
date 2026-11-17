-- S-05: ย้าย pg_net ออกจาก schema public ไป schema extensions (รันแล้วบน production 2026-11-17 โดยผู้ดูแลโปรเจกต์ผ่าน SQL Editor)
-- ALTER EXTENSION ... SET SCHEMA ใช้ไม่ได้ (extrelocatable = false) จึงลบแล้วสร้างใหม่ ฟังก์ชันของ pg_net ยังอยู่ใน schema net
-- หมายเหตุ: ฟังก์ชัน net.* เป็นของ supabase_admin และ PUBLIC ยังมีสิทธิ์ execute อยู่ การ revoke ด้วยบทบาท postgres ไม่มีผล
--   (ไม่มีข้อผิดพลาดแต่ ACL ไม่เปลี่ยน) จึงไม่ได้ใส่คำสั่ง revoke ในไฟล์นี้ ต้องให้ผู้ดูแลระบบ Supabase จัดการ
-- ผู้เรียกจริงของ net.http_post คือ trigger แบบ definer (punpang_push_on_bell / punpang_push_on_chat)

drop extension pg_net;
create schema if not exists extensions;
create extension pg_net with schema extensions;
